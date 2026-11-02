import { describe, expect, it } from "vitest";
import { addToCell, type HeatGrid } from "./heatmap";
import { darkestColorMinimumEventCount, heatmapColorTop } from "./heatmapColorTop";
import {
  heatmapSpreadWorldUnitsByKind,
  smoothHeatGrid,
  smoothedPeakOfOneEvent,
} from "./heatmapSmoothing";

// Colours are a share of the colour top. On event heatmaps the top is never below the smoothed
// peak of darkestColorMinimumEventCount events in one cell, so a lone event is not dark red.

function emptyGrid(): HeatGrid {
  const sideCells = 41;
  return {
    cellWorldSize: 4,
    worldScale: 4 * sideCells,
    columnCount: sideCells,
    rowCount: sideCells,
    worldOriginX: 0,
    worldOriginZ: 0,
    values: new Float64Array(sideCells * sideCells),
  };
}

/** Events at (column, row) cells, smoothed as the storm death heatmap is. */
function smoothedStormGrid(eventCells: readonly (readonly [number, number])[]): HeatGrid {
  const grid = emptyGrid();
  for (const [column, row] of eventCells) {
    addToCell(grid, row * grid.columnCount + column, 1);
  }
  return smoothHeatGrid(grid, heatmapSpreadWorldUnitsByKind.stormDeaths);
}

const onePeak = smoothedPeakOfOneEvent(heatmapSpreadWorldUnitsByKind.stormDeaths, 4);

describe("smoothedPeakOfOneEvent", () => {
  it("equals the smoothed value at a lone event's cell, wherever the event is", () => {
    for (const [column, row] of [
      [20, 20],
      [0, 0],
      [40, 3],
    ] as const) {
      const smoothedGrid = smoothedStormGrid([[column, row]]);
      expect(smoothedGrid.values[row * smoothedGrid.columnCount + column]).toBeCloseTo(onePeak, 12);
    }
  });

  it("throws for a spread that is not a positive number of world units", () => {
    expect(() => smoothedPeakOfOneEvent(0, 4)).toThrowError(/positive number of world units/);
  });
});

describe("heatmapColorTop", () => {
  it("raises a lone event's top to the minimum, so it shows at a fifth of the darkest colour", () => {
    const colorTop = heatmapColorTop(smoothedStormGrid([[20, 20]]), "stormDeaths");
    expect(darkestColorMinimumEventCount).toBe(5);
    expect(colorTop.topValue).toBeCloseTo(5 * onePeak, 12);
    expect(colorTop.isRaisedToMinimum).toBe(true);
  });

  it("uses the busiest cell once it passes the minimum", () => {
    const sixStacked = Array.from({ length: 6 }, () => [20, 20] as const);
    const colorTop = heatmapColorTop(smoothedStormGrid(sixStacked), "kills");
    expect(colorTop.topValue).toBeCloseTo(6 * onePeak, 12);
    expect(colorTop.isRaisedToMinimum).toBe(false);
  });

  it("is not raised at exactly the minimum, at the centre, a corner or an edge", () => {
    for (const [column, row] of [
      [20, 20],
      [0, 0],
      [40, 3],
      [7, 40],
    ] as const) {
      const fiveStacked = Array.from({ length: 5 }, () => [column, row] as const);
      expect(
        heatmapColorTop(smoothedStormGrid(fiveStacked), "combatDeaths").isRaisedToMinimum,
      ).toBe(false);
    }
  });

  it("is raised just below the minimum: four stacked events", () => {
    const fourStacked = Array.from({ length: 4 }, () => [7, 40] as const);
    expect(heatmapColorTop(smoothedStormGrid(fourStacked), "kills").isRaisedToMinimum).toBe(true);
  });

  it("does not report a raise for an empty event grid, which draws nothing", () => {
    const colorTop = heatmapColorTop(smoothedStormGrid([]), "stormDeaths");
    expect(colorTop.isRaisedToMinimum).toBe(false);
    expect(colorTop.topValue).toBeCloseTo(5 * onePeak, 12);
  });

  it("leaves Traffic at its busiest cell, however small, and 0 when empty", () => {
    const lightTraffic = emptyGrid();
    addToCell(lightTraffic, 5, 0.5);
    expect(heatmapColorTop(lightTraffic, "traffic")).toEqual({
      topValue: 0.5,
      isRaisedToMinimum: false,
    });
    expect(heatmapColorTop(emptyGrid(), "traffic")).toEqual({
      topValue: 0,
      isRaisedToMinimum: false,
    });
  });
});
