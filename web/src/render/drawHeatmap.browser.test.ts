import { describe, expect, it } from "vitest";
import type { HeatGrid } from "../domain/heatmap";
import { buildHeatRasterTexels, createHeatRaster } from "./drawHeatmap";

// createHeatRaster needs a real canvas, so it runs in headless Chromium.

describe("createHeatRaster", () => {
  it("makes a canvas with one texel per cell holding the raster texels", () => {
    const grid: HeatGrid = {
      cellWorldSize: 4,
      worldScale: 12,
      columnCount: 3,
      rowCount: 2,
      worldOriginX: 0,
      worldOriginZ: 0,
      values: Float64Array.from([0, 0, 0, 0, 5, 10]),
    };
    const raster = createHeatRaster(grid, 10);
    if (!(raster.image instanceof HTMLCanvasElement)) {
      throw new Error("The heat raster should be a canvas");
    }
    expect(raster.grid).toBe(grid);
    expect(raster.colorTopValue).toBe(10);
    expect([raster.image.width, raster.image.height]).toEqual([3, 2]);
    const rasterContext = raster.image.getContext("2d");
    if (rasterContext === null) {
      throw new Error("The heat raster canvas has no 2D context");
    }
    const readBack = rasterContext.getImageData(0, 0, 3, 2).data;
    const expectedTexels = buildHeatRasterTexels(grid, 10);
    // The darkest texel (row 0, column 2) reads back exactly; canvas storage premultiplies alpha,
    // so partly transparent texels may differ by rounding and are checked by alpha only.
    expect([...readBack.slice(8, 12)]).toEqual([...expectedTexels.slice(8, 12)]);
    expect(readBack[7]).toBe(expectedTexels[7]);
    expect(readBack[23]).toBe(0);
  });
});
