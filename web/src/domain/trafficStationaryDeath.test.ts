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

// User decision 2026-11-02: when a player's first death is later than their last
// position sample at or before it and records exactly the same world X and Z, the player stood
// there until they died, so the whole gap counts as time in that sample's cell.
describe("accumulateTrafficSeconds: stationary time before a matching death", () => {
  it("adds the 454 s from the last sample to a matching storm death at that spot", () => {
    // (1,1)@0 to (5,1)@10 crosses x = 4 at three quarters of the way: 7.5 s and 2.5 s.
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["Position", 10, 5, 1],
        ["KilledByStorm", 464, 5, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBeCloseTo(7.5, 12);
    expect(cellValueAt(trafficGrid, 5, 1)).toBeCloseTo(2.5 + 454, 12);
    expect(totalSeconds(trafficGrid)).toBeCloseTo(464, 12);
  });

  it("does the same for combat deaths (Killed, BotKilled) and a numeric-ID player", () => {
    const trafficGrid = trafficFor([
      buildTrack("killed-by-player", "human", [
        ["Position", 0, 1, 1],
        ["Killed", 30, 1, 1],
      ]),
      buildTrack("killed-by-bot", "human", [
        ["Position", 100, 21, 1],
        ["BotKilled", 140, 21, 1],
      ]),
      buildTrack("1234567", "human_misid", [
        ["Position", 200, 41, 1],
        ["KilledByStorm", 250, 41, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(30);
    expect(cellValueAt(trafficGrid, 21, 1)).toBe(40);
    expect(cellValueAt(trafficGrid, 41, 1)).toBe(50);
    expect(totalSeconds(trafficGrid)).toBe(120);
  });

  it("credits one position sample up to a matching death, and nothing with no position sample", () => {
    const trafficGrid = trafficFor([
      buildTrack("one-sample", "human", [
        ["Position", 7, 1, 1],
        ["KilledByStorm", 19, 1, 1],
      ]),
      buildTrack("no-samples", "human", [
        ["Loot", 0, 41, 41],
        ["KilledByStorm", 60, 41, 41],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(12);
    expect(cellValueAt(trafficGrid, 41, 41)).toBe(0);
    expect(totalSeconds(trafficGrid)).toBe(12);
  });

  it("adds nothing for a death at the same second as the last sample", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["Position", 10, 1, 1],
        ["BotKilled", 10, 1, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(10);
    expect(totalSeconds(trafficGrid)).toBe(10);
  });

  it("adds nothing when the death is near but not exactly at the last sample, even in the same cell", () => {
    const trafficGrid = trafficFor([
      buildTrack("same-cell-x", "human", [
        ["Position", 0, 1, 1],
        ["Position", 10, 1, 1],
        ["KilledByStorm", 100, 1.5, 1],
      ]),
      buildTrack("same-cell-z", "human", [
        ["Position", 0, 21, 1],
        ["Killed", 50, 21, 1.000001],
      ]),
      buildTrack("far-away", "human", [
        ["Position", 0, 41, 1],
        ["BotKilled", 50, 81, 81],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(10);
    expect(totalSeconds(trafficGrid)).toBe(10);
  });

  it("adds nothing after the last sample when the player has no death", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["Position", 10, 1, 1],
        ["Loot", 300, 1, 1],
        ["BotKill", 400, 1, 1],
      ]),
    ]);
    expect(totalSeconds(trafficGrid)).toBe(10);
  });

  it("stops at the first death: later samples, kills and death rows add nothing", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["KilledByStorm", 20, 1, 1],
        ["Position", 22, 1, 1],
        ["BotKill", 25, 1, 1],
        ["KilledByStorm", 30, 1, 1],
        ["BotKilled", 40, 1, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(20);
    expect(totalSeconds(trafficGrid)).toBe(20);
  });

  it("uses only the first death even when a later death row matches and the first does not", () => {
    const trafficGrid = trafficFor([
      buildTrack("player-a", "human", [
        ["Position", 0, 1, 1],
        ["BotKilled", 20, 9, 9],
        ["KilledByStorm", 30, 1, 1],
      ]),
    ]);
    expect(totalSeconds(trafficGrid)).toBe(0);
  });

  it("breaks a tie between death rows in the same second by row order", () => {
    const trafficGrid = trafficFor([
      buildTrack("first-row-matches", "human", [
        ["Position", 0, 1, 1],
        ["Killed", 20, 1, 1],
        ["KilledByStorm", 20, 9, 9],
      ]),
      buildTrack("first-row-elsewhere", "human", [
        ["Position", 0, 21, 1],
        ["Killed", 20, 29, 9],
        ["KilledByStorm", 20, 21, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(20);
    expect(cellValueAt(trafficGrid, 21, 1)).toBe(0);
    expect(totalSeconds(trafficGrid)).toBe(20);
  });

  it("credits each player of a match on their own and never a bot", () => {
    const trafficGrid = trafficFor([
      buildTrack("standing-player", "human", [
        ["Position", 0, 1, 1],
        ["Killed", 90, 1, 1],
      ]),
      buildTrack("killer-player", "human", [
        ["Position", 0, 21, 1],
        ["Kill", 90, 21, 1],
        ["Position", 95, 21, 1],
      ]),
      buildTrack("moved-player", "human", [
        ["Position", 0, 41, 1],
        ["BotKilled", 60, 45, 1],
      ]),
      buildTrack("bot-1", "bot", [
        ["BotPosition", 0, 61, 1],
        ["BotKilled", 70, 61, 1],
      ]),
    ]);
    expect(cellValueAt(trafficGrid, 1, 1)).toBe(90);
    expect(cellValueAt(trafficGrid, 21, 1)).toBe(95);
    expect(cellValueAt(trafficGrid, 41, 1)).toBe(0);
    expect(cellValueAt(trafficGrid, 61, 1)).toBe(0);
    expect(totalSeconds(trafficGrid)).toBe(185);
  });

  it("leaves the input grid and tracks unchanged", () => {
    const emptyGrid = createHeatGrid(lockdownMap);
    const track = buildTrack("player-a", "human", [
      ["Position", 0, 1, 1],
      ["KilledByStorm", 50, 1, 1],
    ]);
    const trackBefore = structuredClone(track);
    const trafficGrid = accumulateTrafficSeconds(emptyGrid, [track], eventConfig);
    expect(totalSeconds(trafficGrid)).toBe(50);
    expect(totalSeconds(emptyGrid)).toBe(0);
    expect(track).toEqual(trackBefore);
  });

  it("still throws when a matching death's track has a missing array value", () => {
    const track = buildTrack("player-a", "human", [
      ["Position", 0, 1, 1],
      ["KilledByStorm", 50, 1, 1],
    ]);
    const accumulateShortTrack = () =>
      trafficFor([{ ...track, timestampSeconds: track.timestampSeconds.slice(0, 1) }]);
    expect(accumulateShortTrack).toThrow(DataContractError);
    expect(accumulateShortTrack).toThrow(/player-a.*row 1 is missing a value/);
  });
});
