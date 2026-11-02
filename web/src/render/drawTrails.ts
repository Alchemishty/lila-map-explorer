import type { TrailHeadState } from "../domain/trailHeadState";
import type { CanvasPoint } from "../domain/types";
import type { DrawingContext } from "./canvasOverlay";

// Trail language (docs/domain.md): players get a solid line in their palette color with a round
// head; bots get a dashed grey line with a square head. The head also shows what Replay knows about
// the actor now: moving, waiting, dead or last seen (drawTrailHead).

export interface TrailStyle {
  readonly color: string;
  readonly isDashed: boolean;
  readonly isHighlighted: boolean;
  readonly isDimmed: boolean;
  readonly headShape: "round" | "square";
}

/** Half the head's width, in CSS pixels. */
export const trailHeadRadiusPixels = 5;
const trailWidthPixels = 2;
const highlightedTrailWidthPixels = 4;
const dimmedOpacity = 0.25;
const dashedTrailSegmentsPixels = [6, 4];
const headOutlineColor = "#0f172a";
const headOutlineWidthPixels = 1.5;
/** The ring around a waiting head, in CSS pixels from its center. */
const waitingRingRadiusPixels = trailHeadRadiusPixels + 3;
const headHaloWidthPixels = 4;
const headMarkWidthPixels = 2;
const lastSeenDashPixels = [2, 2];

/** A head to draw: where the actor is now and what Replay knows about it there. */
export interface DrawnTrailHead {
  readonly at: CanvasPoint;
  readonly state: TrailHeadState;
}

function traceHeadShape(
  context: DrawingContext,
  at: CanvasPoint,
  headShape: TrailStyle["headShape"],
  radiusPixels: number,
): void {
  context.beginPath();
  if (headShape === "round") {
    context.arc(at.canvasX, at.canvasY, radiusPixels, 0, 2 * Math.PI);
  } else {
    context.rect(
      at.canvasX - radiusPixels,
      at.canvasY - radiusPixels,
      2 * radiusPixels,
      2 * radiusPixels,
    );
  }
}

/** Strokes the current path twice: a dark halo, then the actor's color on top. */
function strokeWithHalo(context: DrawingContext, color: string, lineDash: number[]): void {
  context.setLineDash(lineDash);
  context.strokeStyle = headOutlineColor;
  context.lineWidth = headHaloWidthPixels;
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = headMarkWidthPixels;
  context.stroke();
}

function drawFilledHead(context: DrawingContext, at: CanvasPoint, style: TrailStyle): void {
  traceHeadShape(context, at, style.headShape, trailHeadRadiusPixels);
  context.fillStyle = style.color;
  context.fill();
  context.strokeStyle = headOutlineColor;
  context.lineWidth = headOutlineWidthPixels;
  context.stroke();
}

/**
 * Draws a trail head in its state (telemetry audit issue 9). Moving: a filled head. Waiting: a
 * filled head inside a ring. Dead: a cross in the actor's color, no fill. Last seen: a hollow,
 * dashed outline, so it never looks like a live actor.
 */
export function drawTrailHead(
  context: DrawingContext,
  head: DrawnTrailHead,
  style: TrailStyle,
): void {
  context.setLineDash([]);
  const { at, state } = head;
  if (state === "moving") {
    drawFilledHead(context, at, style);
  } else if (state === "waiting") {
    drawFilledHead(context, at, style);
    traceHeadShape(context, at, style.headShape, waitingRingRadiusPixels);
    strokeWithHalo(context, style.color, []);
  } else if (state === "dead") {
    context.beginPath();
    context.moveTo(at.canvasX - trailHeadRadiusPixels, at.canvasY - trailHeadRadiusPixels);
    context.lineTo(at.canvasX + trailHeadRadiusPixels, at.canvasY + trailHeadRadiusPixels);
    context.moveTo(at.canvasX + trailHeadRadiusPixels, at.canvasY - trailHeadRadiusPixels);
    context.lineTo(at.canvasX - trailHeadRadiusPixels, at.canvasY + trailHeadRadiusPixels);
    strokeWithHalo(context, style.color, []);
  } else {
    traceHeadShape(context, at, style.headShape, trailHeadRadiusPixels);
    strokeWithHalo(context, style.color, lastSeenDashPixels);
  }
  context.setLineDash([]);
}

/**
 * Draws the line through points (none when there are fewer than two: an actor with 0 or 1 samples
 * is valid) and the head, if any. The head is where the actor is now; points are where it has been.
 */
export function drawTrail(
  context: DrawingContext,
  points: readonly CanvasPoint[],
  head: DrawnTrailHead | null,
  style: TrailStyle,
): void {
  context.save();
  context.globalAlpha = style.isDimmed ? dimmedOpacity : 1;
  const [firstPoint, ...laterPoints] = points;
  if (firstPoint !== undefined && laterPoints.length > 0) {
    context.beginPath();
    context.moveTo(firstPoint.canvasX, firstPoint.canvasY);
    for (const point of laterPoints) {
      context.lineTo(point.canvasX, point.canvasY);
    }
    context.setLineDash(style.isDashed ? dashedTrailSegmentsPixels : []);
    context.strokeStyle = style.color;
    context.lineWidth = style.isHighlighted ? highlightedTrailWidthPixels : trailWidthPixels;
    context.stroke();
  }
  if (head !== null) {
    drawTrailHead(context, head, style);
  }
  context.restore();
}
