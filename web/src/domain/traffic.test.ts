import { describe, expect, it } from "vitest";
import { DataContractError } from "./contract";
import { createHeatGrid } from "./heatmap";
import { accumulateTrafficSeconds } from "./traffic";
import {
  buildTrack,
  cellValueAt,
  eventConfig,
  lockdownMap,
  totalSeconds,
  trafficFor,
} from "./trafficTestFixtures";

describe("accumulateTrafficSeconds", () => {
  it("splits (0,0)@0 to (8,0)@10 into 5 s in each of 2 cells", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 0, 0],
        ["Position", 10, 8, 0],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 2, 2)).toBeCloseTo(5, 12);
    expect(cellValueAt(trafficGrid, 6, 2)).toBeCloseTo(5, 12);
    expect(totalSeconds(trafficGrid)).toBeCloseTo(10, 12);
  });

  it("puts a stationary 300 s gap into one cell", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 1000, 1, 1],
        ["Position", 1300, 1, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(300);
    expect(totalSeconds(trafficGrid)).toBe(300);
  });

  it("splits a diagonal segment by the length inside each cell", () => {
    // (1,1) to (5,3): crosses x = 4 at t = 0.75, so 3 s in the start cell and 1 s in the next.
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["Position", 4, 5, 3],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBeCloseTo(3, 12);
    expect(cellValueAt(trafficGrid, 5, 3)).toBeCloseTo(1, 12);
    expect(totalSeconds(trafficGrid)).toBeCloseTo(4, 12);
  });

  it("ignores samples after the first combat death", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["Position", 10, 1, 1],
        ["BotKilled", 10, 1, 1],
        ["Position", 15, 1, 1],
        ["Position", 20, 1, 1],
      ]),
    ]);
    expect(totalSeconds(trafficGrid)).toBe(10);
  });

  it("ignores samples after a storm death", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["KilledByStorm", 12, 9, 9], // away from the sample: the stationary-death rule does not apply
        ["Position", 13, 1, 1],
      ]),
    ]);
    expect(totalSeconds(trafficGrid)).toBe(0);
  });

  it("adds nothing for a track with 1 position sample or 0 position samples", () => {
    const trafficGrid = trafficFor([
      buildTrack("one-sample", "human", [["Position", 0, 1, 1]]),
      buildTrack("events-only", "human", [
        ["Loot", 0, 1, 1],
        ["KilledByStorm", 5, 9, 9],
      ]),
      buildTrack("no-rows", "human", []),
    ]);
    expect(totalSeconds(trafficGrid)).toBe(0);
  });

  it("adds no bot time, and the total equals the sum of every player's intervals", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, -20, -20],
        ["Position", 5, -12.5, -18],
        ["Position", 17, 30, 41.5],
        ["Position", 18, 30, 41.5],
      ]),
      buildTrack("player-b", "human_misid", [
        ["Position", 100, 200, 200],
        ["Position", 107, 180, 230],
      ]),
      buildTrack("bot-1", "bot", [
        ["BotPosition", 0, 0, 0],
        ["BotPosition", 50, 40, 0],
      ]),
    ]);
    expect(totalSeconds(trafficGrid)).toBeCloseTo(18 + 7, 9);
    expect(cellValueAt(trafficGrid, 20, 0)).toBe(0);
  });

  it("credits a segment ending exactly on the upper map edge to the last cell", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 497, 497],
        ["Position", 6, 500, 500],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 500, 500)).toBe(6);
  });

  it("leaves the input grid unchanged", () => {
    const emptyGrid = createHeatGrid(lockdownMap);
    accumulateTrafficSeconds(
      emptyGrid,
      [
        buildTrack("player-a", "human", [
          ["Position", 0, 1, 1],
          ["Position", 6, 1, 1],
        ]),
      ],
      eventConfig,
    );
    expect(totalSeconds(emptyGrid)).toBe(0);
  });

  it("throws a DataContractError naming the actor and point when a sample is off the map", () => {
    const accumulateOffMap = () =>
      trafficFor([
        buildTrack("player-a", "human", [
          ["Position", 0, 1, 1],
          ["Position", 6, 777, 1],
        ]),
      ]);
    expect(accumulateOffMap).toThrow(DataContractError);
    expect(accumulateOffMap).toThrow(/player-a.*777/);
  });

  it("throws when position samples go back in time", () => {
    const accumulateUnsorted = () =>
      trafficFor([
        buildTrack("player-a", "human", [
          ["Position", 10, 1, 1],
          ["Position", 5, 1, 1],
        ]),
      ]);
    expect(accumulateUnsorted).toThrow(DataContractError);
    expect(accumulateUnsorted).toThrow(/player-a.*not sorted by time/);
  });

  it("throws when a player event code has no rule", () => {
    const accumulateUnknownCode = () =>
      trafficFor([buildTrack("player-a", "human", [["Teleport", 0, 1, 1]])]);
    expect(accumulateUnknownCode).toThrow(DataContractError);
    expect(accumulateUnknownCode).toThrow(/Teleport/);
  });
});
