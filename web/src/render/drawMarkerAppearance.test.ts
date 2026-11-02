import { describe, expect, it } from "vitest";
import type { CanvasPoint, MarkerStyle } from "../domain/types";
import {
  drawMarker,
  fullMarkerAppearance,
  markerRadiusPixels,
  markerUnderHeatmapAppearance,
} from "./drawMarkers";
import { callsNamed, createRecordingContext } from "./recordingContextTestFixtures";

const deathByBotMarker: MarkerStyle = {
  label: "Player killed by a bot",
  shape: "square",
  fill: "#111111",
  cross: "#ef4444",
  outline: "solid",
};
const botKillMarker: MarkerStyle = {
  label: "Bot made a kill",
  shape: "circle",
  fill: "#ef4444",
  cross: "",
  outline: "dashed",
};
const markerCenter: CanvasPoint = { canvasX: 100, canvasY: 50 };

describe("marker appearances", () => {
  it("are full size and opaque on their own, and smaller and faded over a heatmap", () => {
    expect(fullMarkerAppearance).toEqual({ radiusPixels: markerRadiusPixels, opacity: 1 });
    expect(markerUnderHeatmapAppearance).toEqual({ radiusPixels: 4, opacity: 0.6 });
  });
});

describe("drawMarker with an appearance", () => {
  it("draws at the full radius and opacity with the full appearance", () => {
    const recordingContext = createRecordingContext();
    drawMarker(recordingContext, markerCenter, botKillMarker, fullMarkerAppearance);
    expect(callsNamed(recordingContext, "arc")[0]?.argumentValues).toEqual([100, 50, 7]);
    expect(callsNamed(recordingContext, "fill")[0]?.globalAlpha).toBe(1);
  });

  it("draws smaller and faded at the same centre, scaling outline and cross widths with the radius", () => {
    const recordingContext = createRecordingContext();
    drawMarker(recordingContext, markerCenter, deathByBotMarker, markerUnderHeatmapAppearance);
    // A square of radius 4 around (100, 50).
    expect(callsNamed(recordingContext, "rect")[0]?.argumentValues).toEqual([96, 46, 8, 8]);
    const [outlineStroke, crossStroke] = callsNamed(recordingContext, "stroke");
    expect(outlineStroke?.lineWidth).toBeCloseTo(1.5 * (4 / 7), 12);
    expect(crossStroke?.lineWidth).toBeCloseTo(2 * (4 / 7), 12);
    // The cross reaches 0.55 of the radius from the centre.
    expect(callsNamed(recordingContext, "moveTo")[0]?.argumentValues).toEqual([97.8, 47.8]);
    for (const drawCall of [...callsNamed(recordingContext, "fill"), outlineStroke, crossStroke]) {
      expect(drawCall?.globalAlpha).toBe(0.6);
    }
  });

  it("scales a bot event's dashes with the radius and keeps its grey outline", () => {
    const recordingContext = createRecordingContext();
    drawMarker(recordingContext, markerCenter, botKillMarker, markerUnderHeatmapAppearance);
    const dashedStroke = callsNamed(recordingContext, "stroke")[0];
    expect(dashedStroke?.lineDash).toEqual([3 * (4 / 7), 2 * (4 / 7)]);
    expect(dashedStroke?.lineWidth).toBeCloseTo(2 * (4 / 7), 12);
    expect(dashedStroke?.strokeStyle).toBe("#94a3b8");
  });

  it("restores the context's opacity afterwards, so later drawing is not faded", () => {
    const recordingContext = createRecordingContext();
    drawMarker(recordingContext, markerCenter, botKillMarker, markerUnderHeatmapAppearance);
    expect(recordingContext.globalAlpha).toBe(1);
  });

  it("throws in plain words for a radius not above zero or an opacity outside 0 to 1", () => {
    const recordingContext = createRecordingContext();
    expect(() =>
      drawMarker(recordingContext, markerCenter, botKillMarker, { radiusPixels: 0, opacity: 1 }),
    ).toThrow("A marker radius must be above zero CSS pixels, got 0");
    expect(() =>
      drawMarker(recordingContext, markerCenter, botKillMarker, { radiusPixels: 4, opacity: 1.2 }),
    ).toThrow("A marker opacity must be between 0 and 1, got 1.2");
  });
});
