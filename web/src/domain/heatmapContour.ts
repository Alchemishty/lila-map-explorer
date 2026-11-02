import type { HeatGrid } from "./heatmap";
import type { WorldPoint } from "./types";

// The outline around a heatmap's busiest zones (user decision 2026-11-02, docs/domain.md "How
// heatmaps are drawn"). It traces where the smoothed grid crosses one level, by marching squares
// over the cell centres, so the line follows the same smoothed values the colours come from. Cells
// beyond the grid count as zero, as they do for smoothing, so a zone at the grid's edge still
// closes. The result is in world units; it is converted to the screen only when drawn.

export interface WorldLineSegment {
  readonly start: WorldPoint;
  readonly end: WorldPoint;
}

/** A corner of one marching square: a cell centre and its smoothed value. */
interface SquareCorner {
  readonly point: WorldPoint;
  readonly cellValue: number;
}

type SquareEdge = "bottom" | "right" | "top" | "left";

/** Which edges each corner case joins. Cases 5 and 10 (two opposite corners) are decided apart. */
const edgePairsByCase: Readonly<Record<number, readonly (readonly [SquareEdge, SquareEdge])[]>> = {
  1: [["left", "bottom"]],
  2: [["bottom", "right"]],
  3: [["left", "right"]],
  4: [["right", "top"]],
  6: [["bottom", "top"]],
  7: [["left", "top"]],
  8: [["top", "left"]],
  9: [["bottom", "top"]],
  11: [["right", "top"]],
  12: [["left", "right"]],
  13: [["bottom", "right"]],
  14: [["left", "bottom"]],
};

/** A cell's smoothed value; cells beyond the grid count as zero. */
function cellValueAt(grid: HeatGrid, column: number, row: number): number {
  if (column < 0 || row < 0 || column >= grid.columnCount || row >= grid.rowCount) {
    return 0; // valid path: beyond the grid counts as zero, as for smoothing
  }
  const cellValue = grid.values[row * grid.columnCount + column];
  if (cellValue === undefined) {
    throw new Error(`Heat grid has no cell at column ${column}, row ${row}`);
  }
  return cellValue;
}

function squareCorner(grid: HeatGrid, column: number, row: number): SquareCorner {
  return {
    point: {
      worldX: grid.worldOriginX + (column + 0.5) * grid.cellWorldSize,
      worldZ: grid.worldOriginZ + (row + 0.5) * grid.cellWorldSize,
    },
    cellValue: cellValueAt(grid, column, row),
  };
}

/** Where the level falls between two corners, one at or above it and one below. */
function crossingPoint(first: SquareCorner, second: SquareCorner, level: number): WorldPoint {
  const position = (level - first.cellValue) / (second.cellValue - first.cellValue);
  return {
    worldX: first.point.worldX + (second.point.worldX - first.point.worldX) * position,
    worldZ: first.point.worldZ + (second.point.worldZ - first.point.worldZ) * position,
  };
}

/** Edge pairs for the two-opposite-corner cases, by whether the square's middle is in the zone. */
function saddleEdgePairs(
  cornerCase: 5 | 10,
  isMiddleInZone: boolean,
): readonly (readonly [SquareEdge, SquareEdge])[] {
  // Case 5 has bottom-left and top-right in the zone; case 10 has bottom-right and top-left.
  const isBottomLeftJoinedToTopRight = cornerCase === 5 ? isMiddleInZone : !isMiddleInZone;
  return isBottomLeftJoinedToTopRight
    ? [
        ["left", "top"],
        ["bottom", "right"],
      ]
    : [
        ["left", "bottom"],
        ["right", "top"],
      ];
}

/**
 * The line segments where the grid's smoothed values cross level: every cell at or above level is
 * inside the outline. Segments are unordered; together they form closed loops. A level that is not
 * a positive finite number throws, because it would put the whole map inside the outline.
 */
export function traceHeatContour(grid: HeatGrid, level: number): WorldLineSegment[] {
  if (!(Number.isFinite(level) && level > 0)) {
    throw new Error(`A heatmap outline needs a level above zero, got ${level}`);
  }
  const segments: WorldLineSegment[] = [];
  for (let row = -1; row < grid.rowCount; row += 1) {
    for (let column = -1; column < grid.columnCount; column += 1) {
      const bottomLeft = squareCorner(grid, column, row);
      const bottomRight = squareCorner(grid, column + 1, row);
      const topRight = squareCorner(grid, column + 1, row + 1);
      const topLeft = squareCorner(grid, column, row + 1);
      const cornerCase =
        (bottomLeft.cellValue >= level ? 1 : 0) +
        (bottomRight.cellValue >= level ? 2 : 0) +
        (topRight.cellValue >= level ? 4 : 0) +
        (topLeft.cellValue >= level ? 8 : 0);
      if (cornerCase === 0 || cornerCase === 15) {
        continue; // valid path: the square is wholly outside or wholly inside the outline
      }
      const edgePoint = (edge: SquareEdge): WorldPoint => {
        switch (edge) {
          case "bottom":
            return crossingPoint(bottomLeft, bottomRight, level);
          case "right":
            return crossingPoint(bottomRight, topRight, level);
          case "top":
            return crossingPoint(topLeft, topRight, level);
          case "left":
            return crossingPoint(bottomLeft, topLeft, level);
        }
      };
      const middleValue =
        (bottomLeft.cellValue + bottomRight.cellValue + topRight.cellValue + topLeft.cellValue) / 4;
      const edgePairs =
        cornerCase === 5 || cornerCase === 10
          ? saddleEdgePairs(cornerCase, middleValue >= level)
          : edgePairsByCase[cornerCase];
      if (edgePairs === undefined) {
        throw new Error(`Marching squares has no edges for corner case ${cornerCase}`);
      }
      for (const [startEdge, endEdge] of edgePairs) {
        segments.push({ start: edgePoint(startEdge), end: edgePoint(endEdge) });
      }
    }
  }
  return segments;
}
