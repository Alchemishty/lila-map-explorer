import { describe, expect, it } from "vitest";
import type { CanvasPoint, MarkerStyle } from "../domain/types";
import {
  botOutlineColor,
  drawMarker,
  fullMarkerAppearance,
  markerRadiusPixels,
} from "./drawMarkers";
import { drawSelectionArea } from "./drawSelection";
import {
  drawTrail,
  drawTrailHead,
  trailHeadRadiusPixels,
  type DrawnTrailHead,
  type TrailStyle,
} from "./drawTrails";
import { callsNamed, createRecordingContext } from "./recordingContextTestFixtures";

const killBotMarker: MarkerStyle = {
  label: "Kill of a bot",
  shape: "square",
  fill: "#ef4444",
  cross: "#ffffff",
  outline: "solid",
};
const lootMarker: MarkerStyle = {
  label: "Loot",
  shape: "diamond",
  fill: "#facc15",
  cross: "",
  outline: "solid",
};
const botKillMarker: MarkerStyle = {
  ...killBotMarker,
  label: "Bot made a kill",
  outline: "dashed",
};
const markerCenter: CanvasPoint = { canvasX: 100, canvasY: 50 };

function movingHeadAt(canvasX: number, canvasY: number): DrawnTrailHead {
  return { at: { canvasX, canvasY }, state: "moving" };
}

describe("drawMarker", () => {
  it("draws a circle of the marker radius at the canvas point, filled with the marker color", () => {
    const recordingContext = createRecordingContext();
    drawMarker(
      recordingContext,
      markerCenter,
      { ...killBotMarker, shape: "circle" },
      fullMarkerAppearance,
    );
    expect(callsNamed(recordingContext, "arc")[0]?.argumentValues).toEqual([
      100,
      50,
      markerRadiusPixels,
    ]);
    expect(callsNamed(recordingContext, "fill")[0]?.fillStyle).toBe("#ef4444");
  });

  it("draws a square centered on the canvas point", () => {
    const recordingContext = createRecordingContext();
    drawMarker(recordingContext, markerCenter, killBotMarker, fullMarkerAppearance);
    expect(callsNamed(recordingContext, "rect")[0]?.argumentValues).toEqual([
      100 - markerRadiusPixels,
      50 - markerRadiusPixels,
      2 * markerRadiusPixels,
      2 * markerRadiusPixels,
    ]);
  });

  it("draws a diamond and a triangle as closed paths through points around the center", () => {
    const recordingContext = createRecordingContext();
    drawMarker(recordingContext, markerCenter, lootMarker, fullMarkerAppearance);
    expect(callsNamed(recordingContext, "moveTo")[0]?.argumentValues).toEqual([
      100,
      50 - markerRadiusPixels,
    ]);
    expect(callsNamed(recordingContext, "lineTo").map((call) => call.argumentValues)).toEqual([
      [100 + markerRadiusPixels, 50],
      [100, 50 + markerRadiusPixels],
      [100 - markerRadiusPixels, 50],
    ]);
    const triangleContext = createRecordingContext();
    drawMarker(
      triangleContext,
      markerCenter,
      { ...lootMarker, shape: "triangle" },
      fullMarkerAppearance,
    );
    expect(callsNamed(triangleContext, "lineTo")).toHaveLength(2);
    expect(callsNamed(triangleContext, "closePath")).toHaveLength(1);
  });

  it("draws the cross in the cross color only when cross is not empty", () => {
    const crossedContext = createRecordingContext();
    const deathByBotMarker: MarkerStyle = { ...killBotMarker, fill: "#111111", cross: "#ef4444" };
    drawMarker(crossedContext, markerCenter, deathByBotMarker, fullMarkerAppearance);
    const crossStrokes = callsNamed(crossedContext, "stroke").filter(
      (call) => call.strokeStyle === "#ef4444",
    );
    expect(crossStrokes).toHaveLength(1);
    expect(callsNamed(crossedContext, "moveTo")).toHaveLength(2);

    const plainContext = createRecordingContext();
    drawMarker(plainContext, markerCenter, lootMarker, fullMarkerAppearance);
    const strokeColors = callsNamed(plainContext, "stroke").map((call) => call.strokeStyle);
    expect(strokeColors).not.toContain("");
    expect(callsNamed(plainContext, "moveTo")).toHaveLength(1);
  });

  it("draws a dashed grey outline only for markers of events performed by a bot", () => {
    const dashedContext = createRecordingContext();
    drawMarker(dashedContext, markerCenter, botKillMarker, fullMarkerAppearance);
    const dashedStrokes = callsNamed(dashedContext, "stroke").filter(
      (call) => call.lineDash.length > 0,
    );
    expect(dashedStrokes.map((call) => call.strokeStyle)).toEqual([botOutlineColor]);
    expect(botOutlineColor).toBe("#94a3b8");

    const solidContext = createRecordingContext();
    drawMarker(solidContext, markerCenter, killBotMarker, fullMarkerAppearance);
    const solidStrokeDashes = callsNamed(solidContext, "stroke").map((call) => call.lineDash);
    expect(solidStrokeDashes.every((lineDash) => lineDash.length === 0)).toBe(true);
  });
});

const playerTrailStyle: TrailStyle = {
  color: "#22d3ee",
  isDashed: false,
  isHighlighted: false,
  isDimmed: false,
  headShape: "round",
};
const botTrailStyle: TrailStyle = {
  color: "#cbd5e1",
  isDashed: true,
  isHighlighted: false,
  isDimmed: false,
  headShape: "square",
};
const trailPoints: CanvasPoint[] = [
  { canvasX: 10, canvasY: 10 },
  { canvasX: 20, canvasY: 15 },
  { canvasX: 30, canvasY: 40 },
];

describe("drawTrail", () => {
  it("draws a solid line through every point and a round head for a player", () => {
    const recordingContext = createRecordingContext();
    drawTrail(recordingContext, trailPoints, movingHeadAt(35, 45), playerTrailStyle);
    expect(callsNamed(recordingContext, "moveTo")[0]?.argumentValues).toEqual([10, 10]);
    expect(callsNamed(recordingContext, "lineTo").map((call) => call.argumentValues)).toEqual([
      [20, 15],
      [30, 40],
    ]);
    const lineStroke = callsNamed(recordingContext, "stroke")[0];
    expect(lineStroke?.strokeStyle).toBe("#22d3ee");
    expect(lineStroke?.lineDash).toEqual([]);
    expect(callsNamed(recordingContext, "arc")[0]?.argumentValues).toEqual([
      35,
      45,
      trailHeadRadiusPixels,
    ]);
    expect(callsNamed(recordingContext, "rect")).toHaveLength(0);
  });

  it("draws a dashed line and a square head for a bot", () => {
    const recordingContext = createRecordingContext();
    drawTrail(recordingContext, trailPoints, movingHeadAt(35, 45), botTrailStyle);
    expect(callsNamed(recordingContext, "stroke")[0]?.lineDash.length).toBeGreaterThan(0);
    expect(callsNamed(recordingContext, "rect")[0]?.argumentValues).toEqual([
      35 - trailHeadRadiusPixels,
      45 - trailHeadRadiusPixels,
      2 * trailHeadRadiusPixels,
      2 * trailHeadRadiusPixels,
    ]);
    expect(callsNamed(recordingContext, "arc")).toHaveLength(0);
  });

  it("draws a head with no line for a single point, and nothing for no points and no head", () => {
    const singlePointContext = createRecordingContext();
    drawTrail(singlePointContext, [], movingHeadAt(5, 6), playerTrailStyle);
    expect(callsNamed(singlePointContext, "lineTo")).toHaveLength(0);
    expect(callsNamed(singlePointContext, "arc")).toHaveLength(1);

    const emptyContext = createRecordingContext();
    drawTrail(emptyContext, [], null, playerTrailStyle);
    expect(callsNamed(emptyContext, "stroke")).toHaveLength(0);
    expect(callsNamed(emptyContext, "fill")).toHaveLength(0);
  });

  it("draws a highlighted trail wider and a dimmed trail faded", () => {
    const normalContext = createRecordingContext();
    drawTrail(normalContext, trailPoints, null, playerTrailStyle);
    const highlightedContext = createRecordingContext();
    drawTrail(highlightedContext, trailPoints, null, { ...playerTrailStyle, isHighlighted: true });
    const dimmedContext = createRecordingContext();
    drawTrail(dimmedContext, trailPoints, null, { ...playerTrailStyle, isDimmed: true });

    const normalStroke = callsNamed(normalContext, "stroke")[0];
    const highlightedStroke = callsNamed(highlightedContext, "stroke")[0];
    const dimmedStroke = callsNamed(dimmedContext, "stroke")[0];
    expect(highlightedStroke?.lineWidth).toBeGreaterThan(normalStroke?.lineWidth ?? Infinity);
    expect(normalStroke?.globalAlpha).toBe(1);
    expect(dimmedStroke?.globalAlpha).toBeLessThan(1);
  });
});

describe("drawTrailHead", () => {
  const headCenter: CanvasPoint = { canvasX: 50, canvasY: 60 };

  it("fills a moving head in the actor's color with no ring", () => {
    const recordingContext = createRecordingContext();
    drawTrailHead(recordingContext, { at: headCenter, state: "moving" }, playerTrailStyle);
    expect(callsNamed(recordingContext, "fill")).toHaveLength(1);
    expect(callsNamed(recordingContext, "fill")[0]?.fillStyle).toBe("#22d3ee");
    expect(callsNamed(recordingContext, "arc").map((call) => call.argumentValues[2])).toEqual([
      trailHeadRadiusPixels,
    ]);
  });

  it("fills a waiting head and rings it, with a halo under the ring in the actor's color", () => {
    const recordingContext = createRecordingContext();
    drawTrailHead(recordingContext, { at: headCenter, state: "waiting" }, playerTrailStyle);
    expect(callsNamed(recordingContext, "fill")).toHaveLength(1);
    const ringRadii = callsNamed(recordingContext, "arc").map((call) => call.argumentValues[2]);
    expect(ringRadii).toHaveLength(2);
    expect(ringRadii[1]).toBeGreaterThan(trailHeadRadiusPixels);
    const ringStrokes = callsNamed(recordingContext, "stroke").slice(1);
    expect(ringStrokes.map((call) => call.strokeStyle)).toEqual(["#0f172a", "#22d3ee"]);
  });

  it("draws a dead head as a cross in the actor's color, with no fill", () => {
    const recordingContext = createRecordingContext();
    drawTrailHead(recordingContext, { at: headCenter, state: "dead" }, playerTrailStyle);
    expect(callsNamed(recordingContext, "fill")).toHaveLength(0);
    expect(callsNamed(recordingContext, "arc")).toHaveLength(0);
    expect(callsNamed(recordingContext, "lineTo").map((call) => call.argumentValues)).toEqual([
      [55, 65],
      [45, 65],
    ]);
    expect(callsNamed(recordingContext, "stroke").at(-1)?.strokeStyle).toBe("#22d3ee");
  });

  it("draws a last-seen head hollow and dashed, so it never looks like a live actor", () => {
    for (const style of [playerTrailStyle, botTrailStyle]) {
      const recordingContext = createRecordingContext();
      drawTrailHead(recordingContext, { at: headCenter, state: "last_seen" }, style);
      expect(callsNamed(recordingContext, "fill")).toHaveLength(0);
      const strokes = callsNamed(recordingContext, "stroke");
      expect(strokes).toHaveLength(2);
      for (const stroke of strokes) {
        expect(stroke.lineDash.length).toBeGreaterThan(0);
      }
      expect(strokes.at(-1)?.strokeStyle).toBe(style.color);
    }
  });

  it("keeps the bot's square shape for waiting and last-seen heads", () => {
    const waitingContext = createRecordingContext();
    drawTrailHead(waitingContext, { at: headCenter, state: "waiting" }, botTrailStyle);
    expect(callsNamed(waitingContext, "rect")).toHaveLength(2);
    expect(callsNamed(waitingContext, "arc")).toHaveLength(0);
    const lastSeenContext = createRecordingContext();
    drawTrailHead(lastSeenContext, { at: headCenter, state: "last_seen" }, botTrailStyle);
    expect(callsNamed(lastSeenContext, "rect")).toHaveLength(1);
  });

  it("leaves the line dash cleared after drawing, so later drawing starts solid", () => {
    const recordingContext = createRecordingContext();
    drawTrailHead(recordingContext, { at: headCenter, state: "last_seen" }, playerTrailStyle);
    expect(callsNamed(recordingContext, "setLineDash").at(-1)?.argumentValues).toEqual([[]]);
  });
});

describe("drawSelectionArea", () => {
  it("strokes and fills the rectangle between two corners given in any order", () => {
    const recordingContext = createRecordingContext();
    drawSelectionArea(recordingContext, { canvasX: 50, canvasY: 10 }, { canvasX: 20, canvasY: 70 });
    expect(callsNamed(recordingContext, "rect")[0]?.argumentValues).toEqual([20, 10, 30, 60]);
    expect(callsNamed(recordingContext, "fill")).toHaveLength(1);
  });

  it("strokes a wide solid dark halo under the white dashes, so it shows over white-edged markers", () => {
    const recordingContext = createRecordingContext();
    drawSelectionArea(recordingContext, { canvasX: 50, canvasY: 10 }, { canvasX: 20, canvasY: 70 });
    expect(
      callsNamed(recordingContext, "stroke").map((strokeCall) => [
        strokeCall.strokeStyle,
        strokeCall.lineWidth,
        strokeCall.lineDash,
      ]),
    ).toEqual([
      ["#0f172a", 5, []],
      ["#f8fafc", 2, [8, 4]],
    ]);
  });
});
