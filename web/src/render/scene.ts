import { orderLootFirst, type MapEvent } from "../domain/events";
import { selectEventsAtWorldPosition } from "../domain/eventStacks";
import type { HeatGrid } from "../domain/heatmap";
import { traceHeatContour, type WorldLineSegment } from "../domain/heatmapContour";
import type { TrailHeadState } from "../domain/trailHeadState";
import type { CanvasPoint, MarkerStyle, WorldPoint, WorldRect } from "../domain/types";
import type { CanvasArea, DrawingContext } from "./canvasOverlay";
import { createHeatRaster, drawHeatRaster, type HeatRaster } from "./drawHeatmap";
import { drawHeatmapOutline } from "./drawHeatmapOutline";
import {
  drawMarker,
  fullMarkerAppearance,
  markerUnderHeatmapAppearance,
  type MarkerAppearance,
} from "./drawMarkers";
import { drawSelectionArea } from "./drawSelection";
import { drawTrail, type DrawnTrailHead, type TrailStyle } from "./drawTrails";
import { heatmapBusiestZoneFraction } from "./heatRamp";
import type { MapView } from "./mapView";
import { markerSwatchSizePixels } from "./markerSwatch";

// The only owner of the canvas (docs/architecture.md, "Settled design rules"). Layers are kept in world space and converted to canvas
// points on every redraw and every hit test, so nothing drawn or hit-tested goes stale after a pan.

export interface SceneTrail {
  readonly actorKey: string;
  readonly points: readonly WorldPoint[];
  /** Where the actor is now, or null when it has no position yet (for example a late joiner). */
  readonly headPosition: WorldPoint | null;
  /** What is known about the actor now; null exactly when headPosition is null. */
  readonly headState: TrailHeadState | null;
  readonly style: TrailStyle;
}

export interface SceneMarker {
  readonly event: MapEvent;
  readonly style: MarkerStyle;
}

export interface SceneLayers {
  readonly heatGrid: HeatGrid | null;
  /** The value heatGrid draws in its darkest colour; null exactly when heatGrid is null. */
  readonly heatColorTopValue: number | null;
  readonly trails: readonly SceneTrail[];
  readonly markers: readonly SceneMarker[];
  readonly selectionArea: WorldRect | null;
}

export interface Scene {
  /** Replaces every layer and redraws. Pass empty layers to show nothing. */
  setLayers(layers: SceneLayers): void;
  /**
   * Every marker at the exact world position of the nearest marker within radiusPixels (CSS px) of
   * the point, in time order; empty when no marker is that close.
   */
  findMarkersNear(point: CanvasPoint, radiusPixels: number): MapEvent[];
  /** The actorKey of the nearest trail head within radiusPixels (CSS px) of the point, or null. */
  findTrailHeadNear(point: CanvasPoint, radiusPixels: number): string | null;
}

/** The parts of the map view and the overlay the scene uses; MapView and CanvasOverlay fit them. */
export type SceneMapView = Pick<
  MapView,
  "worldToCanvasPoint" | "worldToCanvasConverter" | "onRedraw"
>;
export interface SceneOverlay {
  readonly context: DrawingContext;
  clear(): CanvasArea;
}

/** No heatmap, trails, markers or selection: what a mode with nothing to show passes. */
export const emptySceneLayers: SceneLayers = {
  heatGrid: null,
  heatColorTopValue: null,
  trails: [],
  markers: [],
  selectionArea: null,
};

function requireHitRadius(radiusPixels: number): void {
  if (!(Number.isFinite(radiusPixels) && radiusPixels >= 0)) {
    throw new Error(`A hit-test radius must be zero or more CSS pixels, got ${radiusPixels}`);
  }
}

function distancePixels(firstPoint: CanvasPoint, secondPoint: CanvasPoint): number {
  return Math.hypot(
    firstPoint.canvasX - secondPoint.canvasX,
    firstPoint.canvasY - secondPoint.canvasY,
  );
}

/** The candidate nearest to point within radiusPixels; on equal distance the earlier one wins. */
function findNearest<Candidate>(
  candidates: readonly Candidate[],
  canvasPointOf: (candidate: Candidate) => CanvasPoint | null,
  point: CanvasPoint,
  radiusPixels: number,
): Candidate | null {
  requireHitRadius(radiusPixels);
  let nearestCandidate: Candidate | null = null;
  let nearestDistancePixels = Infinity;
  for (const candidate of candidates) {
    const candidateCanvasPoint = canvasPointOf(candidate);
    if (candidateCanvasPoint === null) {
      continue; // a trail with no head has nothing to tap
    }
    const candidateDistancePixels = distancePixels(candidateCanvasPoint, point);
    if (
      candidateDistancePixels <= radiusPixels &&
      candidateDistancePixels < nearestDistancePixels
    ) {
      nearestCandidate = candidate;
      nearestDistancePixels = candidateDistancePixels;
    }
  }
  return nearestCandidate;
}

/** The trail's head on the canvas, or null when it has none. A head without a state throws. */
function requireDrawnHead(
  trail: SceneTrail,
  toCanvas: (point: WorldPoint) => CanvasPoint,
): DrawnTrailHead | null {
  if (trail.headPosition === null && trail.headState === null) {
    return null; // valid path: the actor has no row yet
  }
  if (trail.headPosition === null || trail.headState === null) {
    throw new Error(
      `Trail of actor "${trail.actorKey}" has a head position or a head state but not both`,
    );
  }
  return { at: toCanvas(trail.headPosition), state: trail.headState };
}

/** Markers draw smaller and faded over a heatmap, and at full size without one. */
export function markerAppearanceFor(layers: SceneLayers): MarkerAppearance {
  return layers.heatGrid === null ? fullMarkerAppearance : markerUnderHeatmapAppearance;
}

export function createScene(mapView: SceneMapView, overlay: SceneOverlay): Scene {
  let currentLayers = emptySceneLayers;
  let markersInDrawOrder: readonly SceneMarker[] = [];
  const toCanvas = (point: WorldPoint): CanvasPoint => mapView.worldToCanvasPoint(point);
  // Built once per grid and colour top and reused on every redraw (pan and zoom).
  let heatRaster: HeatRaster | null = null;
  function heatRasterFor(heatGrid: HeatGrid, colorTopValue: number): HeatRaster {
    if (
      heatRaster === null ||
      heatRaster.grid !== heatGrid ||
      heatRaster.colorTopValue !== colorTopValue
    ) {
      heatRaster = createHeatRaster(heatGrid, colorTopValue);
    }
    return heatRaster;
  }
  // The busiest zones' outline, in world units, traced once per grid and colour top.
  let heatOutline: {
    readonly grid: HeatGrid;
    readonly colorTopValue: number;
    readonly segments: readonly WorldLineSegment[];
  } | null = null;
  function heatOutlineFor(heatGrid: HeatGrid, colorTopValue: number): readonly WorldLineSegment[] {
    if (colorTopValue === 0) {
      return []; // valid path: an empty Traffic grid has no busiest zone
    }
    if (
      heatOutline === null ||
      heatOutline.grid !== heatGrid ||
      heatOutline.colorTopValue !== colorTopValue
    ) {
      heatOutline = {
        grid: heatGrid,
        colorTopValue,
        segments: traceHeatContour(heatGrid, colorTopValue * heatmapBusiestZoneFraction),
      };
    }
    return heatOutline.segments;
  }

  /**
   * True when a marker centered here would cover none of the overlay's area. A marker and its
   * outline fit inside its legend swatch, so half the swatch is how far it can reach.
   */
  function isMarkerOffCanvas(at: CanvasPoint, canvasArea: CanvasArea): boolean {
    const markerReachPixels = markerSwatchSizePixels / 2;
    return (
      at.canvasX < canvasArea.leftCanvasX - markerReachPixels ||
      at.canvasX > canvasArea.rightCanvasX + markerReachPixels ||
      at.canvasY < canvasArea.topCanvasY - markerReachPixels ||
      at.canvasY > canvasArea.bottomCanvasY + markerReachPixels
    );
  }

  const drawnHeadOf = (trail: SceneTrail): DrawnTrailHead | null =>
    requireDrawnHead(trail, toCanvas);

  function redraw(): void {
    const canvasArea = overlay.clear();
    const context = overlay.context;
    const { heatGrid, heatColorTopValue } = currentLayers;
    if ((heatGrid === null) !== (heatColorTopValue === null)) {
      throw new Error("Scene layers have a heat grid or a heat colour top, but not both");
    }
    if (heatGrid !== null && heatColorTopValue !== null) {
      drawHeatRaster(context, heatRasterFor(heatGrid, heatColorTopValue), mapView);
    }
    for (const trail of currentLayers.trails) {
      drawTrail(context, trail.points.map(toCanvas), drawnHeadOf(trail), trail.style);
    }
    // No markers, no converter: it needs a shown map, and a redraw with nothing to place needs none.
    if (markersInDrawOrder.length > 0) {
      const markerToCanvas = mapView.worldToCanvasConverter();
      const markerAppearance = markerAppearanceFor(currentLayers);
      for (const marker of markersInDrawOrder) {
        const markerCanvasPoint = markerToCanvas(marker.event.position);
        if (isMarkerOffCanvas(markerCanvasPoint, canvasArea)) {
          continue; // valid path: off-screen markers have nothing to show until the view moves
        }
        drawMarker(context, markerCanvasPoint, marker.style, markerAppearance);
      }
    }
    // Over the markers, so switched-on markers never hide where the busiest zones are.
    if (heatGrid !== null && heatColorTopValue !== null) {
      const outlineSegments = heatOutlineFor(heatGrid, heatColorTopValue);
      if (outlineSegments.length > 0) {
        drawHeatmapOutline(context, outlineSegments, mapView.worldToCanvasConverter());
      }
    }
    const selectionArea = currentLayers.selectionArea;
    if (selectionArea !== null) {
      drawSelectionArea(
        context,
        toCanvas({ worldX: selectionArea.minWorldX, worldZ: selectionArea.minWorldZ }),
        toCanvas({ worldX: selectionArea.maxWorldX, worldZ: selectionArea.maxWorldZ }),
      );
    }
  }

  mapView.onRedraw(redraw);

  return {
    setLayers: (layers) => {
      currentLayers = layers;
      markersInDrawOrder = orderLootFirst(layers.markers, (marker) => marker.event);
      redraw();
    },
    findMarkersNear: (point, radiusPixels) => {
      const nearestMarker = findNearest(
        currentLayers.markers,
        (marker) => toCanvas(marker.event.position),
        point,
        radiusPixels,
      );
      if (nearestMarker === null) {
        return []; // valid path: the tap was on empty map
      }
      return selectEventsAtWorldPosition(
        currentLayers.markers.map((marker) => marker.event),
        nearestMarker.event.position,
      );
    },
    findTrailHeadNear: (point, radiusPixels) => {
      const nearestTrail = findNearest(
        currentLayers.trails,
        (trail) => (trail.headPosition === null ? null : toCanvas(trail.headPosition)),
        point,
        radiusPixels,
      );
      return nearestTrail === null ? null : nearestTrail.actorKey;
    },
  };
}
