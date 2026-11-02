import { describe, expect, it } from "vitest";
import type { CanvasPoint, WorldPoint } from "../domain/types";
import {
  busiestZoneOutlineColor,
  busiestZoneOutlineHaloColor,
  drawHeatmapOutline,
} from "./drawHeatmapOutline";
import { callsNamed, createRecordingContext } from "./recordingContextTestFixtures";

/** canvasX = 2·worldX + 10, canvasY = 100 - 3·worldZ: unequal scales, like a non-square image. */
const toCanvas = (point: WorldPoint): CanvasPoint => ({
  canvasX: 2 * point.worldX + 10,
  canvasY: 100 - 3 * point.worldZ,
});

describe("drawHeatmapOutline", () => {
  it("strokes every segment at its canvas points, first as a dark halo, then as a white line", () => {
    const recordingContext = createRecordingContext();
    drawHeatmapOutline(
      recordingContext,
      [
        { start: { worldX: 0, worldZ: 0 }, end: { worldX: 4, worldZ: 2 } },
        { start: { worldX: 4, worldZ: 2 }, end: { worldX: 1, worldZ: 5 } },
      ],
      toCanvas,
    );
    expect(callsNamed(recordingContext, "moveTo").map((call) => call.argumentValues)).toEqual([
      [10, 100],
      [18, 94],
    ]);
    expect(callsNamed(recordingContext, "lineTo").map((call) => call.argumentValues)).toEqual([
      [18, 94],
      [12, 85],
    ]);
    const strokes = callsNamed(recordingContext, "stroke");
    expect(strokes.map((call) => [call.strokeStyle, call.lineWidth])).toEqual([
      [busiestZoneOutlineHaloColor, 3.5],
      [busiestZoneOutlineColor, 1.5],
    ]);
    expect(strokes.every((call) => call.lineDash.length === 0)).toBe(true);
    expect(recordingContext.lineWidth).toBe(1); // restored afterwards
  });

  it("draws nothing for no segments", () => {
    const recordingContext = createRecordingContext();
    drawHeatmapOutline(recordingContext, [], toCanvas);
    expect(recordingContext.recordedCalls).toEqual([]);
  });
});
