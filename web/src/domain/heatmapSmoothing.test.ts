import { describe, expect, it } from "vitest";
import { addToCell, cellIndexFor, createHeatGrid, type HeatGrid } from "./heatmap";
import { heatGridTotal, heatmapSpreadWorldUnitsByKind, smoothHeatGrid } from "./heatmapSmoothing";
import type { MapConfig } from "./types";

// With cellWorldSize 4 and a spread of 4 world units the standard deviation is 1 cell and the
// kernel reaches 3 cells. These are exp(-i²/2) for i = 0..3, divided by their sum over i = -3..3.
const weightAtZeroCells = 0.39905;
const weightAtOneCell = 0.242036;
const weightAtTwoCells = 0.054006;
const weightAtThreeCells = 0.004433;
const toleranceDigits = 5;

function handBuiltGrid(columnCount: number, rowCount: number): HeatGrid {
  return {
    cellWorldSize: 4,
    worldScale: 4 * Math.max(columnCount, rowCount),
    columnCount,
    rowCount,
    worldOriginX: 0,
    worldOriginZ: 0,
    values: new Float64Array(columnCount * rowCount),
  };
}

function valueAt(grid: HeatGrid, column: number, row: number): number {
  const cellValue = grid.values[row * grid.columnCount + column];
  if (cellValue === undefined) {
    throw new Error(`Test grid has no cell at column ${column}, row ${row}`);
  }
  return cellValue;
}

function gridWithOneEvent(columnCount: number, rowCount: number, column: number, row: number) {
  const grid = handBuiltGrid(columnCount, rowCount);
  addToCell(grid, row * columnCount + column, 1);
  return grid;
}

const grandRiftMap: MapConfig = {
  mapId: "GrandRift",
  imageUrl: "data/minimaps/GrandRift.jpg",
  imageWidthPixels: 2160,
  imageHeightPixels: 2158,
  worldScale: 581,
  worldOriginX: -290,
  worldOriginZ: -290,
};

describe("smoothHeatGrid", () => {
  it("spreads one central event symmetrically with normalized Gaussian weights", () => {
    const smoothedGrid = smoothHeatGrid(gridWithOneEvent(21, 21, 10, 10), 4);

    expect(valueAt(smoothedGrid, 10, 10)).toBeCloseTo(weightAtZeroCells ** 2, toleranceDigits);
    const neighbourWeight = weightAtZeroCells * weightAtOneCell;
    expect(valueAt(smoothedGrid, 11, 10)).toBeCloseTo(neighbourWeight, toleranceDigits);
    expect(valueAt(smoothedGrid, 9, 10)).toBeCloseTo(neighbourWeight, toleranceDigits);
    expect(valueAt(smoothedGrid, 10, 11)).toBeCloseTo(neighbourWeight, toleranceDigits);
    expect(valueAt(smoothedGrid, 10, 8)).toBeCloseTo(
      weightAtZeroCells * weightAtTwoCells,
      toleranceDigits,
    );
    expect(valueAt(smoothedGrid, 13, 13)).toBeCloseTo(weightAtThreeCells ** 2, toleranceDigits);
    expect(valueAt(smoothedGrid, 14, 10)).toBe(0);
    expect(heatGridTotal(smoothedGrid)).toBeCloseTo(1, 10);
  });

  it("loses the mass that falls off the grid edge", () => {
    const smoothedGrid = smoothHeatGrid(gridWithOneEvent(21, 21, 0, 0), 4);
    const keptAlongOneAxis =
      weightAtZeroCells + weightAtOneCell + weightAtTwoCells + weightAtThreeCells;

    expect(heatGridTotal(smoothedGrid)).toBeCloseTo(keptAlongOneAxis ** 2, toleranceDigits);
  });

  it("handles a grid with different column and row counts", () => {
    const smoothedGrid = smoothHeatGrid(gridWithOneEvent(5, 3, 4, 2), 4);

    expect(smoothedGrid.columnCount).toBe(5);
    expect(smoothedGrid.rowCount).toBe(3);
    expect(smoothedGrid.values.length).toBe(15);
    expect(valueAt(smoothedGrid, 4, 2)).toBeCloseTo(weightAtZeroCells ** 2, toleranceDigits);
    // Column 0 is 4 cells away, past the kernel's 3-cell reach; column 1 is 3 cells, row 0 is 2.
    expect(valueAt(smoothedGrid, 0, 0)).toBe(0);
    expect(valueAt(smoothedGrid, 1, 0)).toBeCloseTo(
      weightAtThreeCells * weightAtTwoCells,
      toleranceDigits,
    );
  });

  it("leaves the input grid unchanged and returns a new values array", () => {
    const exactGrid = gridWithOneEvent(21, 21, 10, 10);
    const smoothedGrid = smoothHeatGrid(exactGrid, 4);

    expect(smoothedGrid.values).not.toBe(exactGrid.values);
    expect(valueAt(exactGrid, 10, 10)).toBe(1);
    expect(heatGridTotal(exactGrid)).toBe(1);
  });

  it("keeps an all-zero grid all zero", () => {
    expect(heatGridTotal(smoothHeatGrid(handBuiltGrid(7, 7), 12))).toBe(0);
  });

  it("smooths GrandRift's real 146×146 grid and keeps its shape", () => {
    const grandRiftGrid = createHeatGrid(grandRiftMap);
    const upperEdgeCellIndex = cellIndexFor(grandRiftGrid, { worldX: 291, worldZ: 291 });
    if (upperEdgeCellIndex === null) {
      throw new Error("The upper edge point should be on the GrandRift grid");
    }
    addToCell(grandRiftGrid, upperEdgeCellIndex, 1);

    const smoothedGrid = smoothHeatGrid(grandRiftGrid, 12);

    expect(smoothedGrid.columnCount).toBe(146);
    expect(smoothedGrid.rowCount).toBe(146);
    expect(smoothedGrid.worldScale).toBe(581);
    expect(smoothedGrid.values[upperEdgeCellIndex]).toBeGreaterThan(0);
    expect(heatGridTotal(smoothedGrid)).toBeLessThan(1);
  });

  it("throws for a spread that is not a positive finite number", () => {
    const grid = handBuiltGrid(3, 3);
    for (const badSpread of [0, -4, Number.NaN, Infinity]) {
      expect(() => smoothHeatGrid(grid, badSpread)).toThrow("positive number of world units");
    }
  });
});

describe("heatGridTotal", () => {
  it("totals a grid exactly", () => {
    const grid = handBuiltGrid(3, 1);
    grid.values.set([1, 2, 0.5]);
    expect(heatGridTotal(grid)).toBe(3.5);
  });
});

describe("heatmapSpreadWorldUnitsByKind", () => {
  it("uses 12 world units for event heatmaps and 8 for traffic", () => {
    expect(heatmapSpreadWorldUnitsByKind).toEqual({
      kills: 12,
      combatDeaths: 12,
      stormDeaths: 12,
      traffic: 8,
    });
  });
});
