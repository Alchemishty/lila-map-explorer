import { cloneHeatGrid, type HeatGrid, type HeatmapKind } from "./heatmap";

// Heatmaps are drawn smoothed so clusters stand out (docs/domain.md, "How heatmaps are drawn"). Smoothing makes
// a separate grid for drawing only: the exact grid, and every count read from it, never changes.

/** The Gaussian standard deviation each heatmap is smoothed with, in world units. */
export const heatmapSpreadWorldUnitsByKind: Readonly<Record<HeatmapKind, number>> = {
  kills: 12,
  combatDeaths: 12,
  stormDeaths: 12,
  traffic: 8,
};

/** Normalized Gaussian weights for offsets -reach..reach cells, truncated at 3 standard deviations. */
function gaussianWeights(standardDeviationCells: number): number[] {
  const reachCells = Math.ceil(3 * standardDeviationCells);
  const weights: number[] = [];
  for (let offsetCells = -reachCells; offsetCells <= reachCells; offsetCells += 1) {
    weights.push(
      Math.exp(
        -(offsetCells * offsetCells) / (2 * standardDeviationCells * standardDeviationCells),
      ),
    );
  }
  const weightTotal = weights.reduce((runningTotal, weight) => runningTotal + weight, 0);
  return weights.map((weight) => weight / weightTotal);
}

/**
 * One blur pass along one axis. Cells beyond the grid count as zero, so mass near an edge is lost
 * rather than wrapped or reflected.
 */
function blurAlongAxis(
  sourceValues: Float64Array,
  grid: HeatGrid,
  weights: readonly number[],
  isAlongColumns: boolean,
): Float64Array {
  const reachCells = (weights.length - 1) / 2;
  const blurredValues = new Float64Array(sourceValues.length);
  for (let row = 0; row < grid.rowCount; row += 1) {
    for (let column = 0; column < grid.columnCount; column += 1) {
      let weightedTotal = 0;
      for (let offsetCells = -reachCells; offsetCells <= reachCells; offsetCells += 1) {
        const sourceColumn = isAlongColumns ? column + offsetCells : column;
        const sourceRow = isAlongColumns ? row : row + offsetCells;
        if (
          sourceColumn < 0 ||
          sourceColumn >= grid.columnCount ||
          sourceRow < 0 ||
          sourceRow >= grid.rowCount
        ) {
          continue; // valid path: beyond the grid edge counts as zero
        }
        const sourceValue = sourceValues[sourceRow * grid.columnCount + sourceColumn];
        const weight = weights[offsetCells + reachCells];
        if (sourceValue === undefined || weight === undefined) {
          throw new Error(
            `Smoothing read past the grid at column ${sourceColumn}, row ${sourceRow}`,
          );
        }
        weightedTotal += sourceValue * weight;
      }
      blurredValues[row * grid.columnCount + column] = weightedTotal;
    }
  }
  return blurredValues;
}

/**
 * A new grid: the input blurred with a Gaussian whose standard deviation is spreadWorldUnits. The
 * input is never changed. Use the result for drawing only; counts come from the exact grid.
 */
export function smoothHeatGrid(grid: HeatGrid, spreadWorldUnits: number): HeatGrid {
  if (!(Number.isFinite(spreadWorldUnits) && spreadWorldUnits > 0)) {
    throw new Error(
      `Heatmap smoothing needs a positive number of world units, got ${spreadWorldUnits}`,
    );
  }
  const weights = gaussianWeights(spreadWorldUnits / grid.cellWorldSize);
  const blurredAlongColumns = blurAlongAxis(grid.values, grid, weights, true);
  const smoothedGrid = cloneHeatGrid(grid);
  smoothedGrid.values.set(blurAlongAxis(blurredAlongColumns, grid, weights, false));
  return smoothedGrid;
}

/**
 * The smoothed value at the cell of one lone event (value 1) after smoothHeatGrid with the same
 * spread: the centre weight of each of the two blur passes, multiplied. It is the same wherever
 * the event sits, because cells beyond the grid only ever add zero.
 */
export function smoothedPeakOfOneEvent(spreadWorldUnits: number, cellWorldSize: number): number {
  if (!(Number.isFinite(spreadWorldUnits) && spreadWorldUnits > 0)) {
    throw new Error(
      `Heatmap smoothing needs a positive number of world units, got ${spreadWorldUnits}`,
    );
  }
  const weights = gaussianWeights(spreadWorldUnits / cellWorldSize);
  const centreWeight = weights[(weights.length - 1) / 2];
  if (centreWeight === undefined) {
    throw new Error(`The smoothing kernel for ${spreadWorldUnits} world units has no centre`);
  }
  return centreWeight * centreWeight;
}

/** The sum of every cell: an event count or traffic seconds, exactly as the grid holds them. */
export function heatGridTotal(grid: HeatGrid): number {
  let total = 0;
  for (const cellValue of grid.values) {
    total += cellValue;
  }
  return total;
}
