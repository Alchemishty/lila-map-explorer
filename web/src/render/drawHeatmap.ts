import type { HeatGrid } from "../domain/heatmap";
import type { DrawingContext } from "./canvasOverlay";
import { heatRampColorForFraction, heatmapFaintCutoffFraction } from "./heatRamp";
import type { MapView } from "./mapView";

// Heatmaps are drawn as a cell raster (enforcement/coordinate-spaces.md, "Heatmap cells"): a small
// image with one texel per grid cell, scaled up by the browser with smoothing. Only the grid's
// world-space corners cross into canvas space, through MapView.worldToCanvasPoint.

/** A grid's raster, built once and drawn on every redraw until the grid or its colour top changes. */
export interface HeatRaster {
  readonly grid: HeatGrid;
  /** The value drawn in the darkest colour (domain/heatmapColorTop.ts). */
  readonly colorTopValue: number;
  readonly image: CanvasImageSource;
}

const channelsPerTexel = 4;

function largestValue(values: Float64Array): number {
  let largest = 0;
  for (const cellValue of values) {
    if (cellValue > largest) {
      largest = cellValue;
    }
  }
  return largest;
}

/**
 * RGBA texels, raster row 0 first. Grid rows grow with worldZ and raster rows grow downward, so
 * raster row r holds grid row rowCount - 1 - r. Each cell takes the ramp colour for its share of
 * colorTopValue; cells below the faint cut-off, and every cell of an all-zero grid, stay clear. A
 * colour top below the busiest cell, or not finite, throws: no cell may go past the darkest colour.
 */
export function buildHeatRasterTexels(
  grid: HeatGrid,
  colorTopValue: number,
): Uint8ClampedArray<ArrayBuffer> {
  const texels = new Uint8ClampedArray(grid.columnCount * grid.rowCount * channelsPerTexel);
  const busiestCellValue = largestValue(grid.values);
  if (!(Number.isFinite(colorTopValue) && colorTopValue >= busiestCellValue)) {
    throw new Error(
      `Heatmap colour top ${colorTopValue} is below the busiest cell (${busiestCellValue}) or ` +
        "not a finite number",
    );
  }
  if (busiestCellValue === 0) {
    return texels; // valid path: nothing counted, so an empty heatmap
  }
  const topValue = colorTopValue;
  for (let gridRow = 0; gridRow < grid.rowCount; gridRow += 1) {
    const rasterRow = grid.rowCount - 1 - gridRow;
    for (let column = 0; column < grid.columnCount; column += 1) {
      const cellValue = grid.values[gridRow * grid.columnCount + column];
      if (cellValue === undefined) {
        throw new Error(`Heat grid has no cell at column ${column}, row ${gridRow}`);
      }
      const fraction = cellValue / topValue;
      if (fraction < heatmapFaintCutoffFraction) {
        continue; // valid path: faint cells are left clear on purpose
      }
      const color = heatRampColorForFraction(fraction);
      const texelStart = (rasterRow * grid.columnCount + column) * channelsPerTexel;
      texels[texelStart] = color.red;
      texels[texelStart + 1] = color.green;
      texels[texelStart + 2] = color.blue;
      texels[texelStart + 3] = Math.round(color.alpha * 255);
    }
  }
  return texels;
}

/** A canvas holding the grid's raster texels, one texel per cell. */
export function createHeatRaster(grid: HeatGrid, colorTopValue: number): HeatRaster {
  const rasterCanvas = document.createElement("canvas");
  rasterCanvas.width = grid.columnCount;
  rasterCanvas.height = grid.rowCount;
  const rasterContext = rasterCanvas.getContext("2d");
  if (rasterContext === null) {
    throw new Error("This browser cannot draw on a 2D canvas, so the heatmap cannot be shown");
  }
  rasterContext.putImageData(
    new ImageData(buildHeatRasterTexels(grid, colorTopValue), grid.columnCount, grid.rowCount),
    0,
    0,
  );
  return { grid, colorTopValue, image: rasterCanvas };
}

/**
 * Draws the raster over the grid's own extent (columnCount and rowCount cells, which may reach
 * past worldScale: GrandRift's grid covers 584 world units), smoothed so the cells do not show.
 */
export function drawHeatRaster(
  context: DrawingContext,
  raster: HeatRaster,
  mapView: Pick<MapView, "worldToCanvasPoint">,
): void {
  const { grid } = raster;
  const topLeftCanvasPoint = mapView.worldToCanvasPoint({
    worldX: grid.worldOriginX,
    worldZ: grid.worldOriginZ + grid.rowCount * grid.cellWorldSize,
  });
  const bottomRightCanvasPoint = mapView.worldToCanvasPoint({
    worldX: grid.worldOriginX + grid.columnCount * grid.cellWorldSize,
    worldZ: grid.worldOriginZ,
  });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    raster.image,
    topLeftCanvasPoint.canvasX,
    topLeftCanvasPoint.canvasY,
    bottomRightCanvasPoint.canvasX - topLeftCanvasPoint.canvasX,
    bottomRightCanvasPoint.canvasY - topLeftCanvasPoint.canvasY,
  );
}
