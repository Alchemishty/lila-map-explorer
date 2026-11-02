import { describe, expect, it } from "vitest";
import { DataContractError } from "./contract";
import { buildTrack, cellValueAt, totalSeconds, trafficFor } from "./trafficTestFixtures";

// User decision 2026-11-02: a player's Loot and kill rows (Kill, BotKill) recorded
// between their first and last position sample are waypoints of the Traffic path, in recorded
// order, the same as Replay's trail. Time between two consecutive waypoints is spread along the
// straight line between them. Loot and kill rows before the first or after the last position
// sample add no time.
describe("accumulateTrafficSeconds: loot and kill rows as waypoints", () => {
  it("routes the time through a Loot row between two position samples", () => {
    // (1,1)@0 to (9,1)@4 crosses x = 4 at 3/8 and x = 8 at 7/8: 1.5 s, 2 s and 0.5 s.
    // The way back from (9,1)@4 to (1,1)@8 mirrors it.
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["Loot", 4, 9, 1],
        ["Position", 8, 1, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBeCloseTo(3, 12);
    expect(cellValueAt(trafficGrid, 6, 1)).toBeCloseTo(4, 12);
    expect(cellValueAt(trafficGrid, 9, 1)).toBeCloseTo(1, 12);
    expect(totalSeconds(trafficGrid)).toBeCloseTo(8, 12);
  });

  it("routes the time through BotKill and Kill rows, for a numeric-ID player too", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["BotKill", 10, 41, 1],
        ["Position", 20, 41, 1],
      ]),
      buildTrack("1234567", "human_misid", [
        ["Position", 100, 1, 41],
        ["Kill", 110, 1, 81],
        ["Position", 120, 1, 81],
      ]),
    ]);
    // Each first segment is 40 units across 11 cells: 3 units (0.75 s) in the start cell.
    expect(cellValueAt(trafficGrid, 1, 1)).toBeCloseTo(0.75, 12);
    expect(cellValueAt(trafficGrid, 41, 1)).toBeCloseTo(0.25 + 10, 12);
    expect(cellValueAt(trafficGrid, 1, 41)).toBeCloseTo(0.75, 12);
    expect(cellValueAt(trafficGrid, 1, 81)).toBeCloseTo(0.25 + 10, 12);
    expect(totalSeconds(trafficGrid)).toBeCloseTo(40, 12);
  });

  it("adds nothing extra for repeated rows in the same second", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["Loot", 4, 9, 1],
        ["Loot", 4, 9, 1],
        ["Position", 8, 1, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBeCloseTo(3, 12);
    expect(cellValueAt(trafficGrid, 9, 1)).toBeCloseTo(1, 12);
    expect(totalSeconds(trafficGrid)).toBeCloseTo(8, 12);
  });

  it("adds no time for Loot and kill rows before the first position sample", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Loot", 0, 41, 1],
        ["BotKill", 2, 81, 1],
        ["Position", 5, 1, 1],
        ["Position", 10, 1, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(5);
    expect(totalSeconds(trafficGrid)).toBe(5);
  });

  it("adds no time for Loot and kill rows after the last position sample, same second included", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["Position", 10, 1, 1],
        ["Loot", 10, 41, 1],
        ["BotKill", 15, 81, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(10);
    expect(totalSeconds(trafficGrid)).toBe(10);
  });

  it("ignores Loot and kill rows after the first death", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["Position", 10, 1, 1],
        ["BotKilled", 12, 21, 1], // away from the last sample: no stationary time
        ["Loot", 14, 41, 1],
        ["Position", 20, 1, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 41, 1)).toBe(0);
    expect(totalSeconds(trafficGrid)).toBe(10);
  });

  it("still extends the last position sample to a matching death after a waypoint", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["Loot", 0, 1, 1],
        ["Position", 10, 1, 1],
        ["Loot", 10, 41, 1], // after the last position sample in row order: not a waypoint
        ["KilledByStorm", 30, 1, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(30);
    expect(cellValueAt(trafficGrid, 41, 1)).toBe(0);
    expect(totalSeconds(trafficGrid)).toBe(30);
  });

  it("throws when a waypoint goes back in time", () => {
    const accumulateUnsorted = () =>
      trafficFor([
        buildTrack("player-a", "human", [
          ["Position", 0, 1, 1],
          ["Loot", 7, 9, 1],
          ["Position", 5, 1, 1],
        ]),
      ]);
    expect(accumulateUnsorted).toThrow(DataContractError);
    expect(accumulateUnsorted).toThrow(
      /player-a.*not sorted by time \(row 2 at 5 s comes after 7 s\)/,
    );
  });
});
