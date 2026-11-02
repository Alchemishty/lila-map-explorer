import { describe, expect, it } from "vitest";
import type { HeatGrid } from "./heatmap";
import { traceHeatContour, type WorldLineSegment } from "./heatmapContour";

/** A grid of 4-unit cells from world (0, 0); rows of values are given bottom row (row 0) first. */
function buildGrid(valueRowsBottomFirst: readonly (readonly number[])[]): HeatGrid {
  const rowCount = valueRowsBottomFirst.length;
  const bottomRow = valueRowsBottomFirst[0];
  if (bottomRow === undefined) {
    throw new Error("A test grid needs at least one row of values");
  }
  const columnCount = bottomRow.length;
  return {
    cellWorldSize: 4,
    worldScale: 4 * Math.max(columnCount, rowCount),
    columnCount,
    rowCount,
    worldOriginX: 0,
    worldOriginZ: 0,
    values: Float64Array.from(valueRowsBottomFirst.flat()),
  };
}

/** Segments as sorted "x,z>x,z" keys with the two ends in a fixed order, so order does not matter. */
function segmentKeys(segments: readonly WorldLineSegment[]): string[] {
  return segments
    .map((segment) =>
      [segment.start, segment.end]
        .map((point) => `${point.worldX},${point.worldZ}`)
        .sort()
        .join(">"),
    )
    .sort();
}

function expectedKeys(pairs: readonly (readonly [string, string])[]): string[] {
  return pairs.map((pair) => [...pair].sort().join(">")).sort();
}

describe("traceHeatContour", () => {
  it("rings one busy cell halfway to its quiet neighbours' centres", () => {
    // Cell centres sit at 2, 6 and 10; the busy cell's centre is (6, 6).
    const grid = buildGrid([
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    expect(segmentKeys(traceHeatContour(grid, 0.5))).toEqual(
      expectedKeys([
        ["6,4", "4,6"],
        ["6,4", "8,6"],
        ["8,6", "6,8"],
        ["4,6", "6,8"],
      ]),
    );
  });

  it("closes a zone at the grid's edge, counting cells beyond the grid as zero, on a non-square grid", () => {
    // Two columns, one row: the busy cell's centre is (2, 2) and the level is halfway to zero.
    const grid = buildGrid([[2, 0]]);
    expect(segmentKeys(traceHeatContour(grid, 1))).toEqual(
      expectedKeys([
        ["0,2", "2,0"],
        ["2,0", "4,2"],
        ["4,2", "2,4"],
        ["2,4", "0,2"],
      ]),
    );
  });

  it("joins two diagonal busy cells when the square's middle reaches the level, and parts them when not", () => {
    const grid = buildGrid([
      [1, 0],
      [0, 1],
    ]);
    // Middle value 0.5: at level 0.5 the middle is in the zone, so the two cells join.
    const joinedKeys = segmentKeys(traceHeatContour(grid, 0.5));
    expect(joinedKeys).toEqual(expect.arrayContaining(expectedKeys([["2,4", "4,6"]])));
    expect(joinedKeys).toEqual(expect.arrayContaining(expectedKeys([["4,2", "6,4"]])));
    // At level 0.75 the middle is outside, so each busy cell is cut off on its own.
    const partedKeys = segmentKeys(traceHeatContour(grid, 0.75));
    expect(partedKeys).toEqual(expect.arrayContaining(expectedKeys([["2,3", "3,2"]])));
    expect(partedKeys).toEqual(expect.arrayContaining(expectedKeys([["6,5", "5,6"]])));
  });

  it("draws nothing when no cell reaches the level", () => {
    expect(traceHeatContour(buildGrid([[0.2, 0.4]]), 0.5)).toEqual([]);
    expect(traceHeatContour(buildGrid([[0, 0]]), 1)).toEqual([]);
  });

  it("forms closed loops: every segment end is shared by an even number of segments", () => {
    let seed = 7;
    const nextValue = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const grid = buildGrid(
      Array.from({ length: 23 }, () => Array.from({ length: 31 }, () => nextValue())),
    );
    const segments = traceHeatContour(grid, 0.6);
    expect(segments.length).toBeGreaterThan(20);
    const endCountsByKey = new Map<string, number>();
    for (const segment of segments) {
      for (const point of [segment.start, segment.end]) {
        const pointKey = `${point.worldX},${point.worldZ}`;
        const earlierEndCount = endCountsByKey.get(pointKey);
        endCountsByKey.set(pointKey, earlierEndCount === undefined ? 1 : earlierEndCount + 1);
      }
    }
    expect([...endCountsByKey.values()].filter((endCount) => endCount % 2 !== 0)).toEqual([]);
  });

  it("throws in plain words for a level that is not above zero", () => {
    const grid = buildGrid([[1]]);
    for (const badLevel of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => traceHeatContour(grid, badLevel)).toThrow(
        `A heatmap outline needs a level above zero, got ${badLevel}`,
      );
    }
  });
});
