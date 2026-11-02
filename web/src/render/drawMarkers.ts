import type { CanvasPoint, MarkerStyle } from "../domain/types";
import type { DrawingContext } from "./canvasOverlay";

// Marker language (docs/domain.md): shape and fill come from eventConfig.markers; a cross when
// cross !== ""; a dashed grey outline for any event performed by a bot.

/** Half the marker's width, in CSS pixels. */
export const markerRadiusPixels = 7;
/**
 * The dashed grey outline of bot-performed events: dashed and grey like bot trails (docs/domain.md),
 * in a darker grey than the trail colour #cbd5e1.
 */
export const botOutlineColor = "#94a3b8";
const solidOutlineColor = "#ffffff";
const solidOutlineWidthPixels = 1.5;
const dashedOutlineWidthPixels = 2;
const dashedOutlineSegmentsPixels = [3, 2];
const crossWidthPixels = 2;
/** The cross reaches this share of the radius from the center. */
const crossReachFraction = 0.55;

/**
 * How big and how opaque a marker draws. Outline, dash and cross widths scale with the radius, so a
 * smaller marker keeps the same look. Only the drawing changes: the marker stays at its exact spot.
 */
export interface MarkerAppearance {
  /** Half the marker's width, in CSS pixels. */
  readonly radiusPixels: number;
  /** 0 to 1. */
  readonly opacity: number;
}

/** Markers on their own: full size and fully opaque. */
export const fullMarkerAppearance: MarkerAppearance = {
  radiusPixels: markerRadiusPixels,
  opacity: 1,
};

/**
 * Markers over a heatmap (user decision 2026-11-02): smaller and faded, so the heatmap reads first
 * and the exact spots stay visible.
 */
export const markerUnderHeatmapAppearance: MarkerAppearance = {
  radiusPixels: 4,
  opacity: 0.6,
};

function traceMarkerShape(
  context: DrawingContext,
  at: CanvasPoint,
  style: MarkerStyle,
  radiusPixels: number,
): void {
  context.beginPath();
  switch (style.shape) {
    case "circle":
      context.arc(at.canvasX, at.canvasY, radiusPixels, 0, 2 * Math.PI);
      break;
    case "square":
      context.rect(
        at.canvasX - radiusPixels,
        at.canvasY - radiusPixels,
        2 * radiusPixels,
        2 * radiusPixels,
      );
      break;
    case "triangle":
      context.moveTo(at.canvasX, at.canvasY - radiusPixels);
      context.lineTo(at.canvasX + radiusPixels, at.canvasY + radiusPixels);
      context.lineTo(at.canvasX - radiusPixels, at.canvasY + radiusPixels);
      context.closePath();
      break;
    case "diamond":
      context.moveTo(at.canvasX, at.canvasY - radiusPixels);
      context.lineTo(at.canvasX + radiusPixels, at.canvasY);
      context.lineTo(at.canvasX, at.canvasY + radiusPixels);
      context.lineTo(at.canvasX - radiusPixels, at.canvasY);
      context.closePath();
      break;
  }
}

function drawCross(
  context: DrawingContext,
  at: CanvasPoint,
  crossColor: string,
  radiusPixels: number,
  widthScale: number,
): void {
  const reachPixels = radiusPixels * crossReachFraction;
  context.beginPath();
  context.moveTo(at.canvasX - reachPixels, at.canvasY - reachPixels);
  context.lineTo(at.canvasX + reachPixels, at.canvasY + reachPixels);
  context.moveTo(at.canvasX + reachPixels, at.canvasY - reachPixels);
  context.lineTo(at.canvasX - reachPixels, at.canvasY + reachPixels);
  context.strokeStyle = crossColor;
  context.lineWidth = crossWidthPixels * widthScale;
  context.stroke();
}

function requireMarkerAppearance(appearance: MarkerAppearance): void {
  if (!(Number.isFinite(appearance.radiusPixels) && appearance.radiusPixels > 0)) {
    throw new Error(
      `A marker radius must be above zero CSS pixels, got ${appearance.radiusPixels}`,
    );
  }
  if (!(appearance.opacity >= 0 && appearance.opacity <= 1)) {
    throw new Error(`A marker opacity must be between 0 and 1, got ${appearance.opacity}`);
  }
}

export function drawMarker(
  context: DrawingContext,
  at: CanvasPoint,
  style: MarkerStyle,
  appearance: MarkerAppearance,
): void {
  requireMarkerAppearance(appearance);
  const { radiusPixels } = appearance;
  const widthScale = radiusPixels / markerRadiusPixels;
  context.save();
  context.globalAlpha = appearance.opacity;
  traceMarkerShape(context, at, style, radiusPixels);
  context.fillStyle = style.fill;
  context.fill();
  if (style.outline === "dashed") {
    context.setLineDash(
      dashedOutlineSegmentsPixels.map((lengthPixels) => lengthPixels * widthScale),
    );
    context.strokeStyle = botOutlineColor;
    context.lineWidth = dashedOutlineWidthPixels * widthScale;
  } else {
    context.setLineDash([]);
    context.strokeStyle = solidOutlineColor;
    context.lineWidth = solidOutlineWidthPixels * widthScale;
  }
  context.stroke();
  context.setLineDash([]);
  if (style.cross !== "") {
    drawCross(context, at, style.cross, radiusPixels, widthScale);
  }
  context.restore();
}
