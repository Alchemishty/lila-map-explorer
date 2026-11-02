import "leaflet/dist/leaflet.css";
import { CRS, DomUtil, imageOverlay, latLngBounds, map as createLeafletMap, point } from "leaflet";
import type { ImageOverlay, LatLng } from "leaflet";
import { pixelToWorld, worldToPixel } from "../domain/coordinates";
import type { CanvasPoint, MapConfig, WorldPoint } from "../domain/types";
import { fitBoundsInsideInsets } from "./fitBoundsInsideInsets";
import { imageBoundsFor, imageLatLngToPixel, pixelToImageLatLng } from "./imageLatLng";
import type { MapView } from "./mapViewContract";
import { restoreLeafletView, saveLeafletView } from "./mapViewMemory";
import { moveContentUpPastImage, releaseRoomBelowImage } from "./roomBelowImage";

export type { MapView, SavedMapView } from "./mapViewContract";

/** The furthest out any image may be zoomed; each image's own zoom-out limit is set in showMap. */
const lowestZoomLevel = -8;

export function createMapView(container: HTMLElement): MapView {
  const leafletMap = createLeafletMap(container, {
    crs: CRS.Simple,
    // Fractional zoom so fitBounds fills the screen exactly; minZoom is reset per image in showMap.
    zoomSnap: 0,
    zoomDelta: 0.5,
    minZoom: lowestZoomLevel,
    maxZoom: 4,
    // Zoom steps jump instead of animating. Pinch frames still fire "zoom", which scales the
    // anchored overlay about its map spot, so phones get smooth pinch-zoom without the animation.
    zoomAnimation: false,
    maxBoundsViscosity: 1,
    attributionControl: false,
  });
  const redrawCallbacks: (() => void)[] = [];
  const viewMoveCallbacks: (() => void)[] = [];
  const imageLoadFailureCallbacks: ((message: string) => void)[] = [];
  let shownMap: MapConfig | null = null;
  let shownImageLayer: ImageOverlay | null = null;
  // A pane of the map pane, so it moves with every pan; above Leaflet's overlay pane (z-index 400,
  // the minimap) and below its controls.
  const overlayPane = leafletMap.createPane("telemetryOverlay");
  overlayPane.style.zIndex = "450";
  overlayPane.style.pointerEvents = "none";
  interface OverlayAnchor {
    readonly anchorLatLng: LatLng;
    readonly anchorZoom: number;
  }
  /** Each attached element, with where it was last anchored (null until it is anchored). */
  const overlayAnchorsByElement = new Map<HTMLElement, OverlayAnchor | null>();

  function notifyRedraw(): void {
    for (const callback of redrawCallbacks) {
      callback();
    }
  }

  function requireShownMap(): MapConfig {
    if (shownMap === null) {
      throw new Error("The map view has no minimap shown yet, so it cannot place points on it");
    }
    return shownMap;
  }

  /** Lets the user zoom out only until the whole image fits; keeps the current pan and zoom. */
  function limitZoomOutToShownMap(): void {
    const imageBounds = latLngBounds(imageBoundsFor(requireShownMap()));
    // getBoundsZoom never answers below the current minZoom, so drop the old limit first. Otherwise
    // the limit could only rise: a bigger image, or a smaller container, would stay locked zoomed in.
    leafletMap.options.minZoom = lowestZoomLevel;
    leafletMap.setMinZoom(leafletMap.getBoundsZoom(imageBounds));
  }

  // Redraw once when the view settles: "moveend" ends every drag (after any inertia), pinch, pan
  // animation, zoom step and view reset. During a gesture the anchored overlay follows the map
  // instead. A resize may redraw twice (the resize handler below, then Leaflet's moveend), which is
  // harmless.
  leafletMap.on("moveend", notifyRedraw);
  leafletMap.on("move", () => {
    for (const callback of viewMoveCallbacks) {
      callback();
    }
  });
  // On every zoom change (a zoom step, or each frame of a pinch), scale each anchored element about
  // its map spot. Not latLngToLayerPoint: it rounds to whole pixels.
  leafletMap.on("zoom", () => {
    const zoomNow = leafletMap.getZoom();
    for (const [element, anchor] of overlayAnchorsByElement) {
      if (anchor === null) {
        continue; // valid path: attached but not yet anchored, so there is nothing drawn to follow
      }
      const anchorLayerPoint = leafletMap
        .project(anchor.anchorLatLng, zoomNow)
        .subtract(leafletMap.getPixelOrigin());
      DomUtil.setTransform(
        element,
        anchorLayerPoint,
        leafletMap.getZoomScale(zoomNow, anchor.anchorZoom),
      );
    }
  });
  // A resize (a phone's address bar hiding, a rotation) keeps the user's pan and zoom and only moves the
  // zoom-out limit. A view already at that limit is raised to the new one (Leaflet setMinZoom).
  leafletMap.on("resize", () => {
    if (shownMap !== null) {
      limitZoomOutToShownMap();
    }
    notifyRedraw();
  });

  function worldToCanvasPoint(point: WorldPoint): CanvasPoint {
    const map = requireShownMap();
    // Not latLngToContainerPoint: it rounds to whole pixels, which would move every drawn point by
    // up to half a CSS pixel and break the round trip with canvasPointToWorld (full precision).
    const projectedPoint = leafletMap.project(
      pixelToImageLatLng(worldToPixel(point, map), map),
      leafletMap.getZoom(),
    );
    const containerPoint = leafletMap.layerPointToContainerPoint(
      projectedPoint.subtract(leafletMap.getPixelOrigin()),
    );
    return { canvasX: containerPoint.x, canvasY: containerPoint.y };
  }

  return {
    container,
    showMap: (map) => {
      if (shownImageLayer !== null) {
        shownImageLayer.remove();
      }
      const imageBounds = latLngBounds(imageBoundsFor(map));
      const imageLayer = imageOverlay(map.imageUrl, imageBounds);
      imageLayer.on("error", () => {
        const failureMessage = `The minimap image ${map.imageUrl} for map "${map.mapId}" could not be loaded`;
        if (imageLoadFailureCallbacks.length === 0) {
          throw new Error(failureMessage);
        }
        for (const callback of imageLoadFailureCallbacks) {
          callback(failureMessage);
        }
      });
      imageLayer.addTo(leafletMap);
      shownImageLayer = imageLayer;
      shownMap = map;
      leafletMap.setMaxBounds(imageBounds);
      limitZoomOutToShownMap();
      leafletMap.fitBounds(imageBounds);
      notifyRedraw();
    },
    worldToCanvasPoint,
    worldToCanvasConverter: () => {
      const map = requireShownMap();
      // Every step from world to canvas (minimap fraction, image pixel, CRS.Simple projection, map
      // pane offset) scales and shifts each axis on its own, with no rotation. So two reference
      // points, the minimap's opposite corners, pin down each axis's scale and offset exactly.
      const firstCornerWorld: WorldPoint = { worldX: map.worldOriginX, worldZ: map.worldOriginZ };
      const oppositeCornerWorld: WorldPoint = {
        worldX: map.worldOriginX + map.worldScale,
        worldZ: map.worldOriginZ + map.worldScale,
      };
      const firstCornerCanvas = worldToCanvasPoint(firstCornerWorld);
      const oppositeCornerCanvas = worldToCanvasPoint(oppositeCornerWorld);
      const canvasXPerWorldX =
        (oppositeCornerCanvas.canvasX - firstCornerCanvas.canvasX) / map.worldScale;
      const canvasYPerWorldZ =
        (oppositeCornerCanvas.canvasY - firstCornerCanvas.canvasY) / map.worldScale;
      return (point) => ({
        canvasX:
          firstCornerCanvas.canvasX + (point.worldX - firstCornerWorld.worldX) * canvasXPerWorldX,
        canvasY:
          firstCornerCanvas.canvasY + (point.worldZ - firstCornerWorld.worldZ) * canvasYPerWorldZ,
      });
    },
    canvasPointToWorld: (point) => {
      const map = requireShownMap();
      const latLng = leafletMap.containerPointToLatLng([point.canvasX, point.canvasY]);
      return pixelToWorld(imageLatLngToPixel(latLng.lat, latLng.lng, map), map);
    },
    pointerEventToCanvasPoint: (event) => {
      const containerPoint = leafletMap.mouseEventToContainerPoint(event);
      return { canvasX: containerPoint.x, canvasY: containerPoint.y };
    },
    onRedraw: (callback) => {
      redrawCallbacks.push(callback);
    },
    onViewMove: (callback) => {
      viewMoveCallbacks.push(callback);
    },
    attachOverlayElement: (element) => {
      Object.assign(element.style, {
        position: "absolute",
        left: "0",
        top: "0",
        transformOrigin: "0 0",
      });
      overlayPane.appendChild(element);
      overlayAnchorsByElement.set(element, null);
    },
    anchorOverlayElement: (element, topLeft) => {
      if (!overlayAnchorsByElement.has(element)) {
        throw new Error(
          "This element is not attached to the map view's overlay layer, so it cannot be anchored " +
            "(call attachOverlayElement first)",
        );
      }
      const topLeftContainerPoint = point(topLeft.canvasX, topLeft.canvasY);
      // setPosition replaces any scale left by an earlier zoom with a plain translation.
      DomUtil.setPosition(element, leafletMap.containerPointToLayerPoint(topLeftContainerPoint));
      overlayAnchorsByElement.set(element, {
        anchorLatLng: leafletMap.containerPointToLatLng(topLeftContainerPoint),
        anchorZoom: leafletMap.getZoom(),
      });
    },
    onImageLoadFailure: (callback) => {
      imageLoadFailureCallbacks.push(callback);
    },
    setPanEnabled: (isEnabled) => {
      if (isEnabled) {
        leafletMap.dragging.enable();
      } else {
        leafletMap.dragging.disable();
      }
    },
    moveContentUp: (distanceCssPixels, isAnimated) =>
      moveContentUpPastImage(leafletMap, distanceCssPixels, isAnimated),
    releaseRoomBelowImage: (isAnimated) => {
      if (shownMap === null) {
        return; // valid path: with no minimap shown there is no room to give back
      }
      releaseRoomBelowImage(leafletMap, latLngBounds(imageBoundsFor(shownMap)), isAnimated);
    },
    fitWorldRect: (worldRect, insets) => {
      const map = requireShownMap();
      const toImageLatLng = (worldX: number, worldZ: number) =>
        pixelToImageLatLng(worldToPixel({ worldX, worldZ }, map), map);
      const contentBounds = latLngBounds(
        toImageLatLng(worldRect.minWorldX, worldRect.minWorldZ),
        toImageLatLng(worldRect.maxWorldX, worldRect.maxWorldZ),
      );
      fitBoundsInsideInsets(leafletMap, contentBounds, latLngBounds(imageBoundsFor(map)), insets);
    },
    saveView: () => saveLeafletView(leafletMap, requireShownMap()),
    restoreView: (view) => restoreLeafletView(leafletMap, requireShownMap(), view),
    showWholeMap: () => {
      const imageBounds = latLngBounds(imageBoundsFor(requireShownMap()));
      // Leaflet only re-measures its container on a window resize; the layout may have changed.
      leafletMap.invalidateSize({ pan: false });
      leafletMap.fitBounds(imageBounds);
    },
  };
}
