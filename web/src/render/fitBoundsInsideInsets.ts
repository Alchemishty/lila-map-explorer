import { point, type LatLng, type LatLngBounds, type Map as LeafletMap } from "leaflet";
import { moveContentUpPastImage, releaseRoomBelowImage } from "./roomBelowImage";

// Fits content (a Replay match) into the part of the map container left free by insets: a margin on
// every edge, plus whatever covers the map (a phone's bottom sheet). Only the view changes. The
// zoom-out limit stays the image's (set by MapView.showMap), so the designer can still zoom out.

/** How far (CSS px) fitted content is kept inside each edge of the map container. */
export interface ContainerInsetsCssPixels {
  readonly topCssPixels: number;
  readonly rightCssPixels: number;
  readonly bottomCssPixels: number;
  readonly leftCssPixels: number;
}

/** The container y (CSS px) of a latLng at the current view, unrounded. */
function containerYOf(leafletMap: LeafletMap, latLng: LatLng): number {
  // Not latLngToContainerPoint: it rounds to whole pixels.
  const layerPoint = leafletMap
    .project(latLng, leafletMap.getZoom())
    .subtract(leafletMap.getPixelOrigin());
  return leafletMap.layerPointToContainerPoint(layerPoint).y;
}

function requireValidInsets(insets: ContainerInsetsCssPixels): void {
  for (const [insetName, insetCssPixels] of Object.entries(insets)) {
    if (!(Number.isFinite(insetCssPixels) && insetCssPixels >= 0)) {
      throw new Error(
        `A fit inset must be 0 or more CSS pixels, but ${insetName} is ${insetCssPixels}`,
      );
    }
  }
}

export function fitBoundsInsideInsets(
  leafletMap: LeafletMap,
  contentBounds: LatLngBounds,
  imageBounds: LatLngBounds,
  insets: ContainerInsetsCssPixels,
): void {
  requireValidInsets(insets);
  // Leaflet measures its container again only on a window resize, but the container can change
  // size without one: Replay's timeline docks under the map when Replay opens. Measure it now.
  leafletMap.invalidateSize({ pan: false });
  const containerSize = leafletMap.getSize();
  const freeWidthCssPixels = containerSize.x - insets.leftCssPixels - insets.rightCssPixels;
  const freeHeightCssPixels = containerSize.y - insets.topCssPixels - insets.bottomCssPixels;
  if (!(freeWidthCssPixels > 0 && freeHeightCssPixels > 0)) {
    throw new Error(
      `The map has no free room to frame the match in: the container is ${containerSize.x} × ` +
        `${containerSize.y} CSS px and the insets leave ${freeWidthCssPixels} × ` +
        `${freeHeightCssPixels}`,
    );
  }
  // Any room an earlier marker tap or fit made below the image goes first, so it never adds up.
  releaseRoomBelowImage(leafletMap, imageBounds, false);
  leafletMap.fitBounds(contentBounds, {
    paddingTopLeft: point(insets.leftCssPixels, insets.topCssPixels),
    paddingBottomRight: point(insets.rightCssPixels, insets.bottomCssPixels),
    animate: false,
  });
  // fitBounds never zooms out past the image's zoom-out limit. A match spanning nearly the whole
  // image may then not fit inside the insets: its edges come closer than the margin, or (on a phone
  // with the sheet open) its lower part stays under the sheet, because the lift below keeps its top
  // in view first. Zooming out further would only show empty space past the image.
  // The image is the pan limit, so content near the image's bottom edge can be held low, under the
  // cover. Move it up past the image's edge, but never so far that its top leaves the free part.
  const contentTopCanvasY = containerYOf(leafletMap, contentBounds.getNorthWest());
  const contentBottomCanvasY = containerYOf(leafletMap, contentBounds.getSouthWest());
  const freeBottomCanvasY = containerSize.y - insets.bottomCssPixels;
  const liftCssPixels = Math.min(
    contentBottomCanvasY - freeBottomCanvasY,
    contentTopCanvasY - insets.topCssPixels,
  );
  // Under half a pixel is rounding, not content held under the cover.
  if (liftCssPixels > 0.5) {
    moveContentUpPastImage(leafletMap, liftCssPixels, false);
  }
}
