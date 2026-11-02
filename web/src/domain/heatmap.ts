import { DataContractError } from "./contract";
import type { MapEvent } from "./events";
import type { MapConfig, WorldPoint } from "./types";

// Heatmap grids live in world units (enforcement/coordinate-spaces.md): cells are square,
// cellWorldSize units on a side, and are converted to the screen only when drawn.

/**
 * A square grid over one map's minimap area. Column grows with worldX and row grows with worldZ,
 * both from the map origin. values[row * columnCount + column] is the cell's value: an event count
 * or traffic seconds. The last column and row may reach past origin + worldScale when worldScale is
 * not a multiple of cellWorldSize (GrandRift: 581 / 4 gives 146 cells covering 584 units), but only
 * points within [origin, origin + worldScale] are on the grid.
 */
export interface HeatGrid {
  readonly cellWorldSize: number;
  /** The minimap's side length in world units (MapConfig.worldScale). */
  readonly worldScale: number;
  readonly columnCount: number;
  readonly rowCount: number;
  readonly worldOriginX: number;
  readonly worldOriginZ: number;
  readonly values: Float64Array;
}

export type HeatmapKind = "kills" | "combatDeaths" | "stormDeaths" | "traffic";
/** The heatmap kinds built by counting events. Traffic is built from tracks instead. */
export type EventHeatmapKind = Exclude<HeatmapKind, "traffic">;

const categoryByEventHeatmapKind: Readonly<Record<EventHeatmapKind, string>> = {
  kills: "kill",
  combatDeaths: "combat_death",
  stormDeaths: "storm_death",
};

/** An all-zero grid covering the map's minimap area. Cells are at most 4 world units. */
export function createHeatGrid(map: MapConfig, cellWorldSize = 4): HeatGrid {
  if (!(Number.isFinite(cellWorldSize) && cellWorldSize > 0)) {
    throw new Error(
      `Heatmap cell size must be a positive number of world units, got ${cellWorldSize}`,
    );
  }
  const cellsPerSide = Math.ceil(map.worldScale / cellWorldSize);
  return {
    cellWorldSize,
    worldScale: map.worldScale,
    columnCount: cellsPerSide,
    rowCount: cellsPerSide,
    worldOriginX: map.worldOriginX,
    worldOriginZ: map.worldOriginZ,
    values: new Float64Array(cellsPerSide * cellsPerSide),
  };
}

function cellIndexAlongAxis(
  offsetWorldUnits: number,
  cellWorldSize: number,
  cellCount: number,
): number {
  // The upper edge (u or v exactly 1) belongs to the last cell.
  return Math.min(Math.floor(offsetWorldUnits / cellWorldSize), cellCount - 1);
}

/**
 * The index into grid.values of the cell holding the point, or null when the point lies outside
 * [origin, origin + worldScale] on either axis (or is NaN). Edges are inside.
 */
export function cellIndexFor(grid: HeatGrid, point: WorldPoint): number | null {
  const offsetWorldX = point.worldX - grid.worldOriginX;
  const offsetWorldZ = point.worldZ - grid.worldOriginZ;
  const isInside =
    offsetWorldX >= 0 &&
    offsetWorldX <= grid.worldScale &&
    offsetWorldZ >= 0 &&
    offsetWorldZ <= grid.worldScale;
  if (!isInside) {
    return null;
  }
  const column = cellIndexAlongAxis(offsetWorldX, grid.cellWorldSize, grid.columnCount);
  const row = cellIndexAlongAxis(offsetWorldZ, grid.cellWorldSize, grid.rowCount);
  return row * grid.columnCount + column;
}

/** Like cellIndexFor, but a point off the grid throws: the pipeline guarantees on-map points. */
export function requireCellIndex(
  grid: HeatGrid,
  point: WorldPoint,
  pointDescription: string,
): number {
  const cellIndex = cellIndexFor(grid, point);
  if (cellIndex === null) {
    throw new DataContractError(
      `${pointDescription} at world (${point.worldX}, ${point.worldZ}) is outside the minimap ` +
        `(origin ${grid.worldOriginX}, ${grid.worldOriginZ}). The build step should have rejected it.`,
    );
  }
  return cellIndex;
}

/** Adds amount to one cell of the grid in place. An index past the grid throws. */
export function addToCell(grid: HeatGrid, cellIndex: number, amount: number): void {
  const currentValue = grid.values[cellIndex];
  if (currentValue === undefined) {
    throw new Error(`Heat grid has no cell ${cellIndex} (it has ${grid.values.length} cells)`);
  }
  grid.values[cellIndex] = currentValue + amount;
}

/** A copy of the grid with its values cloned, so callers never mutate the grid they passed in. */
export function cloneHeatGrid(grid: HeatGrid): HeatGrid {
  return { ...grid, values: new Float64Array(grid.values) };
}

/**
 * A new grid: the input's values plus 1 for every event in its cell. Every row counts, including
 * rows flagged isSameTickRepeat. An event off the grid throws a DataContractError.
 */
export function countEvents(grid: HeatGrid, events: readonly MapEvent[]): HeatGrid {
  const countedGrid = cloneHeatGrid(grid);
  for (const mapEvent of events) {
    const cellIndex = requireCellIndex(
      countedGrid,
      mapEvent.position,
      `Match "${mapEvent.matchId}", actor "${mapEvent.actorKey}": event "${mapEvent.eventCode}"`,
    );
    addToCell(countedGrid, cellIndex, 1);
  }
  return countedGrid;
}

/**
 * The events a heatmap counts, in input order: player-side only (bot-side events never enter
 * heatmaps), kills → "kill", combat deaths → "combat_death", storm deaths → "storm_death".
 */
export function eventsForHeatmap(
  heatmapKind: EventHeatmapKind,
  events: readonly MapEvent[],
): MapEvent[] {
  const category = categoryByEventHeatmapKind[heatmapKind];
  return events.filter((mapEvent) => !mapEvent.isPerformedByBot && mapEvent.category === category);
}
