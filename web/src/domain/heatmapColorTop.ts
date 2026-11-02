import type { HeatGrid, HeatmapKind } from "./heatmap";
import { heatmapSpreadWorldUnitsByKind, smoothedPeakOfOneEvent } from "./heatmapSmoothing";

// The value a heatmap's darkest colour stands for (user decision 2026-11-02). Colours are a share
// of this top. Normally it is the busiest smoothed cell, but on the event heatmaps (kills, combat
// deaths, storm deaths) it is never below the smoothed peak of this many events stacked in one
// cell. So with few events, a lone event shows pale instead of dark red. Traffic is left as it is:
// it is time, not events, and is never that sparse.

/** Event heatmaps keep dark red for at least this many events stacked in one cell. */
export const darkestColorMinimumEventCount = 5;

/** Busiest cells within this share of the minimum count as reaching it (float rounding only). */
const minimumComparisonRelativeTolerance = 1e-9;

export interface HeatmapColorTop {
  /** The smoothed value drawn in the darkest colour. 0 only for an empty Traffic grid. */
  readonly topValue: number;
  /** True when the busiest cell is below the minimum, so nothing reaches the darkest colour. */
  readonly isRaisedToMinimum: boolean;
}

function largestCellValue(grid: HeatGrid): number {
  let largestValue = 0;
  for (const cellValue of grid.values) {
    if (cellValue > largestValue) {
      largestValue = cellValue;
    }
  }
  return largestValue;
}

/** The colour top for a grid smoothed with heatmapSpreadWorldUnitsByKind[heatmapKind]. */
export function heatmapColorTop(smoothedGrid: HeatGrid, heatmapKind: HeatmapKind): HeatmapColorTop {
  const busiestCellValue = largestCellValue(smoothedGrid);
  if (heatmapKind === "traffic") {
    return { topValue: busiestCellValue, isRaisedToMinimum: false };
  }
  const minimumTopValue =
    darkestColorMinimumEventCount *
    smoothedPeakOfOneEvent(heatmapSpreadWorldUnitsByKind[heatmapKind], smoothedGrid.cellWorldSize);
  return {
    topValue: Math.max(busiestCellValue, minimumTopValue),
    // An empty grid draws nothing, so there is no darkest colour to explain. The tolerance keeps
    // exactly the minimum (summed in another order, so it may differ in the last bits) unraised.
    isRaisedToMinimum:
      busiestCellValue > 0 &&
      busiestCellValue < minimumTopValue * (1 - minimumComparisonRelativeTolerance),
  };
}
