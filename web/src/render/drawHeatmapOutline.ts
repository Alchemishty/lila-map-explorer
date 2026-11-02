import type { WorldLineSegment } from "../domain/heatmapContour";
import type { CanvasPoint, WorldPoint } from "../domain/types";
import type { DrawingContext } from "./canvasOverlay";

// The outline around a heatmap's busiest zones (docs/domain.md, "How heatmaps are drawn"): a white
// line on a dark halo, so it shows on dark terrain and over the heatmap's own dark red.

export const busiestZoneOutlineColor = "#ffffff";
export const busiestZoneOutlineHaloColor = "rgba(15, 23, 42, 0.75)";
export const busiestZoneOutlineWidthPixels = 1.5;
export const busiestZoneOutlineHaloWidthPixels = 3.5;

/**
 * Strokes the segments, converted to canvas points with toCanvas (a converter for the current view),
 * first as a wide dark halo, then as the white line. No segments draws nothing.
 */
export function drawHeatmapOutline(
  context: DrawingContext,
  segments: readonly WorldLineSegment[],
  toCanvas: (point: WorldPoint) => CanvasPoint,
): void {
  if (segments.length === 0) {
    return; // valid path: no zone reaches the busiest share, so there is nothing to outline
  }
  context.save();
  context.setLineDash([]);
  context.beginPath();
  for (const segment of segments) {
    const startCanvasPoint = toCanvas(segment.start);
    const endCanvasPoint = toCanvas(segment.end);
    context.moveTo(startCanvasPoint.canvasX, startCanvasPoint.canvasY);
    context.lineTo(endCanvasPoint.canvasX, endCanvasPoint.canvasY);
  }
  context.strokeStyle = busiestZoneOutlineHaloColor;
  context.lineWidth = busiestZoneOutlineHaloWidthPixels;
  context.stroke();
  context.strokeStyle = busiestZoneOutlineColor;
  context.lineWidth = busiestZoneOutlineWidthPixels;
  context.stroke();
  context.restore();
}
