import type { CanvasPoint } from "../domain/types";
import type { DrawingContext } from "./canvasOverlay";

const selectionStrokeColor = "#f8fafc";
const selectionFillColor = "rgba(248, 250, 252, 0.12)";
const selectionStrokeWidthPixels = 2;
const selectionDashSegmentsPixels = [8, 4];
/** A solid dark band under the white dashes, so the rectangle shows over white-edged markers. */
const selectionHaloColor = "#0f172a";
const selectionHaloWidthPixels = 5;

/**
 * Draws the inspected area as a lightly filled rectangle between two opposite corners, outlined by
 * white dashes over a dark halo.
 */
export function drawSelectionArea(
  context: DrawingContext,
  firstCorner: CanvasPoint,
  oppositeCorner: CanvasPoint,
): void {
  const leftCanvasX = Math.min(firstCorner.canvasX, oppositeCorner.canvasX);
  const topCanvasY = Math.min(firstCorner.canvasY, oppositeCorner.canvasY);
  const widthPixels = Math.abs(oppositeCorner.canvasX - firstCorner.canvasX);
  const heightPixels = Math.abs(oppositeCorner.canvasY - firstCorner.canvasY);
  context.save();
  context.beginPath();
  context.rect(leftCanvasX, topCanvasY, widthPixels, heightPixels);
  context.fillStyle = selectionFillColor;
  context.fill();
  context.setLineDash([]);
  context.strokeStyle = selectionHaloColor;
  context.lineWidth = selectionHaloWidthPixels;
  context.stroke();
  context.setLineDash(selectionDashSegmentsPixels);
  context.strokeStyle = selectionStrokeColor;
  context.lineWidth = selectionStrokeWidthPixels;
  context.stroke();
  context.restore();
}
