import { describe, expect, it } from "vitest";
import { createHeatGrid, type HeatGrid } from "../domain/heatmap";
import type { CanvasPoint, MapConfig, WorldPoint } from "../domain/types";
import { buildHeatRasterTexels, drawHeatRaster } from "./drawHeatmap";
import { heatRampColorForFraction } from "./heatRamp";
import { callsNamed, createRecordingContext } from "./recordingContextTestFixtures";

const grandRiftMap: MapConfig = {
  mapId: "GrandRift",
  imageUrl: "data/minimaps/GrandRift.jpg",
  imageWidthPixels: 2160,
  imageHeightPixels: 2158,
  worldScale: 581,
  worldOriginX: -290,
  worldOriginZ: -290,
};

// A known linear view: 10 canvas px per world unit, canvas y grows as worldZ shrinks.
const linearMapView = {
  worldToCanvasPoint: (point: WorldPoint): CanvasPoint => ({
    canvasX: point.worldX * 10,
    canvasY: 80 - point.worldZ * 10,
  }),
};

describe("buildHeatRasterTexels", () => {
  // Grid of 3 columns × 2 rows; the raster's first row is the grid's top row (largest worldZ).
  function threeByTwoGrid(values: readonly number[]): HeatGrid {
    return {
      cellWorldSize: 4,
      worldScale: 12,
      columnCount: 3,
      rowCount: 2,
      worldOriginX: 0,
      worldOriginZ: 0,
      values: Float64Array.from(values),
    };
  }
  function texelAt(texels: Uint8ClampedArray, rasterColumn: number, rasterRow: number): number[] {
    const start = (rasterRow * 3 + rasterColumn) * 4;
    return [...texels.slice(start, start + 4)];
  }
  const darkestTexel = [110, 0, 30, Math.round(0.92 * 255)];

  it("has 4 channels per cell and puts the grid's top row first", () => {
    // grid row 0 = [0, 0, 0], row 1 = [0, 0, 10]: the busiest cell is column 2 of grid row 1.
    const texels = buildHeatRasterTexels(threeByTwoGrid([0, 0, 0, 0, 0, 10]), 10);
    expect(texels.length).toBe(3 * 2 * 4);
    expect(texelAt(texels, 2, 0)).toEqual(darkestTexel);
    expect(texelAt(texels, 2, 1)).toEqual([0, 0, 0, 0]);
  });

  it("colours each cell by its share of the top value, and leaves faint cells clear", () => {
    const texels = buildHeatRasterTexels(threeByTwoGrid([0.3, 3.5, 0, 0, 0, 10]), 10);
    const color = heatRampColorForFraction(0.35);
    expect(texelAt(texels, 1, 1)).toEqual([
      color.red,
      color.green,
      color.blue,
      Math.round(color.alpha * 255),
    ]);
    expect(texelAt(texels, 0, 1)).toEqual([0, 0, 0, 0]); // 3% of the top, below the 4% cut-off
  });

  it("gives the busiest cell the darkest colour when the colour top is that cell", () => {
    const texels = buildHeatRasterTexels(threeByTwoGrid([0, 0.2, 0, 0, 0, 0]), 0.2);
    expect(texelAt(texels, 1, 1)).toEqual(darkestTexel);
  });

  it("colours against a raised colour top, so a lone cell at a fifth of it is pale", () => {
    const texels = buildHeatRasterTexels(threeByTwoGrid([0, 0.2, 0, 0, 0, 0]), 1);
    const color = heatRampColorForFraction(0.2);
    // Texel channels are whole bytes, so the ramp's in-between colour is rounded.
    expect(texelAt(texels, 1, 1)).toEqual([
      Math.round(color.red),
      Math.round(color.green),
      Math.round(color.blue),
      Math.round(color.alpha * 255),
    ]);
    expect(texelAt(texels, 1, 1)).not.toEqual(darkestTexel);
  });

  it("throws for a colour top below the busiest cell or not finite", () => {
    expect(() => buildHeatRasterTexels(threeByTwoGrid([0, 0, 0, 0, 0, 10]), 9)).toThrowError(
      /colour top 9 is below the busiest cell \(10\)/,
    );
    expect(() =>
      buildHeatRasterTexels(threeByTwoGrid([0, 0, 0, 0, 0, 10]), Number.POSITIVE_INFINITY),
    ).toThrowError(/not a finite number/);
  });

  it("is all clear for an all-zero grid", () => {
    expect(
      [...buildHeatRasterTexels(threeByTwoGrid([0, 0, 0, 0, 0, 0]), 0)].every(
        (channel) => channel === 0,
      ),
    ).toBe(true);
  });
});

describe("drawHeatRaster", () => {
  const fakeImage = { width: 146, height: 146 } as unknown as CanvasImageSource;

  it("places the raster by the grid's own extent, so GrandRift's 584-unit grid is not squeezed into 581", () => {
    const grandRiftGrid = createHeatGrid(grandRiftMap);
    const recordingContext = createRecordingContext();
    drawHeatRaster(
      recordingContext,
      { grid: grandRiftGrid, colorTopValue: 0, image: fakeImage },
      linearMapView,
    );
    const leftCanvasX = -290 * 10;
    const topCanvasY = 80 - (-290 + 584) * 10;
    expect(callsNamed(recordingContext, "drawImage")[0]?.argumentValues).toEqual([
      fakeImage,
      leftCanvasX,
      topCanvasY,
      584 * 10,
      584 * 10,
    ]);
    expect(recordingContext.imageSmoothingEnabled).toBe(true);
    expect(recordingContext.imageSmoothingQuality).toBe("high");
  });
});
