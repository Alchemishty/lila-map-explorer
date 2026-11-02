import { describe, expect, it } from "vitest";
import { DataContractError } from "./contract";
import {
  advancePlayback,
  createPlayback,
  seekPlayback,
  trailUpTo,
  type PlaybackState,
} from "./playback";
import { matchStartTimestampSeconds, testMatch } from "./playbackTestFixtures";
import type { ActorTrack, WorldPoint } from "./types";

/** [eventCode, elapsedSeconds, worldX, worldZ] */
type TrackRow = readonly [string, number, number, number];

function buildTrack(actorKey: string, rows: readonly TrackRow[]): ActorTrack {
  return {
    actorKey,
    userId: actorKey,
    actorType: "human",
    isPlayer: true,
    eventCodes: rows.map((row) => row[0]),
    timestampSeconds: rows.map((row) => matchStartTimestampSeconds + row[1]),
    worldX: rows.map((row) => row[2]),
    worldZ: rows.map((row) => row[3]),
    isSameTickRepeat: rows.map(() => false),
  };
}

function playingAt(elapsedSeconds: number, speed: PlaybackState["speed"]): PlaybackState {
  return { ...createPlayback(testMatch), elapsedSeconds, speed, isPlaying: true };
}

describe("createPlayback", () => {
  it("starts at elapsed 0, speed 1, paused, with the match's start and duration", () => {
    expect(createPlayback(testMatch)).toEqual({
      matchStartTimestampSeconds,
      durationSeconds: 600,
      elapsedSeconds: 0,
      speed: 1,
      isPlaying: false,
    });
  });
});

describe("advancePlayback", () => {
  it("adds 4 s for a 1000 ms advance at 4x", () => {
    expect(advancePlayback(playingAt(10, 4), 1000).elapsedSeconds).toBe(14);
  });

  it("scales by speed at 1x and 16x", () => {
    expect(advancePlayback(playingAt(0, 1), 500).elapsedSeconds).toBe(0.5);
    expect(advancePlayback(playingAt(0, 16), 250).elapsedSeconds).toBe(4);
  });

  it("clamps at the duration and stops playing", () => {
    const advancedState = advancePlayback(playingAt(598, 16), 1000);
    expect(advancedState.elapsedSeconds).toBe(600);
    expect(advancedState.isPlaying).toBe(false);
  });

  it("stops playing when it lands exactly on the duration", () => {
    const advancedState = advancePlayback(playingAt(596, 4), 1000);
    expect(advancedState.elapsedSeconds).toBe(600);
    expect(advancedState.isPlaying).toBe(false);
  });

  it("keeps playing before the end", () => {
    expect(advancePlayback(playingAt(0, 1), 1000).isPlaying).toBe(true);
  });

  it("does not move while paused", () => {
    const pausedState = { ...createPlayback(testMatch), elapsedSeconds: 30 };
    expect(advancePlayback(pausedState, 1000)).toEqual(pausedState);
  });

  it("throws on a negative or non-finite wall-clock delta", () => {
    expect(() => advancePlayback(playingAt(0, 1), -16)).toThrow(/-16/);
    expect(() => advancePlayback(playingAt(0, 1), Number.NaN)).toThrow(/NaN/);
  });
});

describe("seekPlayback", () => {
  it("sets elapsed and keeps speed and play state", () => {
    expect(seekPlayback(playingAt(0, 4), 120)).toEqual({ ...playingAt(0, 4), elapsedSeconds: 120 });
  });

  it("clamps to 0 and to the duration", () => {
    expect(seekPlayback(playingAt(50, 1), -5).elapsedSeconds).toBe(0);
    expect(seekPlayback(playingAt(50, 1), 900).elapsedSeconds).toBe(600);
  });

  it("throws on a non-finite target", () => {
    expect(() => seekPlayback(playingAt(0, 1), Number.NaN)).toThrow(/NaN/);
  });
});

describe("trailUpTo", () => {
  const twoSampleTrack = buildTrack("player-a", [
    ["Position", 0, 0, 0],
    ["Position", 10, 10, 20],
  ]);

  it("interpolates the head halfway between samples at 0 s and 10 s when elapsed is 5", () => {
    const trail = trailUpTo(twoSampleTrack, 5, matchStartTimestampSeconds);
    expect(trail.points).toEqual<WorldPoint[]>([{ worldX: 0, worldZ: 0 }]);
    expect(trail.headPosition).toEqual<WorldPoint>({ worldX: 5, worldZ: 10 });
  });

  it("includes a sample exactly at now and puts the head on it", () => {
    const trail = trailUpTo(twoSampleTrack, 10, matchStartTimestampSeconds);
    expect(trail.points).toEqual<WorldPoint[]>([
      { worldX: 0, worldZ: 0 },
      { worldX: 10, worldZ: 20 },
    ]);
    expect(trail.headPosition).toEqual<WorldPoint>({ worldX: 10, worldZ: 20 });
  });

  it("keeps the head on the last sample after the track ends", () => {
    const trail = trailUpTo(twoSampleTrack, 500, matchStartTimestampSeconds);
    expect(trail.points).toHaveLength(2);
    expect(trail.headPosition).toEqual<WorldPoint>({ worldX: 10, worldZ: 20 });
  });

  it("gives a head at the only sample and a 1-point trail for a single-sample track", () => {
    const singleSampleTrack = buildTrack("bot-a", [["BotPosition", 30, 7, 8]]);
    const trail = trailUpTo(singleSampleTrack, 100, matchStartTimestampSeconds);
    expect(trail.points).toEqual<WorldPoint[]>([{ worldX: 7, worldZ: 8 }]);
    expect(trail.headPosition).toEqual<WorldPoint>({ worldX: 7, worldZ: 8 });
  });

  it("has a null head and no points before the first sample", () => {
    const lateTrack = buildTrack("player-b", [["Position", 30, 7, 8]]);
    expect(trailUpTo(lateTrack, 29.5, matchStartTimestampSeconds)).toEqual({
      points: [],
      headPosition: null,
    });
  });

  it("has a null head and no points for a track with no rows", () => {
    expect(trailUpTo(buildTrack("player-c", []), 100, matchStartTimestampSeconds)).toEqual({
      points: [],
      headPosition: null,
    });
  });

  it("uses every row, event rows included", () => {
    const trackWithKill = buildTrack("player-a", [
      ["Position", 0, 0, 0],
      ["Kill", 4, 4, 0],
      ["Position", 8, 8, 0],
    ]);
    const trail = trailUpTo(trackWithKill, 6, matchStartTimestampSeconds);
    expect(trail.points).toEqual<WorldPoint[]>([
      { worldX: 0, worldZ: 0 },
      { worldX: 4, worldZ: 0 },
    ]);
    expect(trail.headPosition).toEqual<WorldPoint>({ worldX: 6, worldZ: 0 });
  });

  it("throws when rows are not sorted by time", () => {
    const unsortedTrack = buildTrack("player-a", [
      ["Position", 10, 0, 0],
      ["Position", 5, 1, 1],
    ]);
    expect(() => trailUpTo(unsortedTrack, 20, matchStartTimestampSeconds)).toThrow(
      DataContractError,
    );
    expect(() => trailUpTo(unsortedTrack, 20, matchStartTimestampSeconds)).toThrow(/player-a/);
  });

  it("throws on unsorted rows even when now is before the out-of-order row", () => {
    const unsortedTrack = buildTrack("player-a", [
      ["Position", 10, 0, 0],
      ["Position", 5, 1, 1],
    ]);
    expect(() => trailUpTo(unsortedTrack, 7, matchStartTimestampSeconds)).toThrow(
      /not sorted by time/,
    );
    expect(() => trailUpTo(unsortedTrack, 0, matchStartTimestampSeconds)).toThrow(
      DataContractError,
    );
  });

  it("throws on a non-finite elapsed time", () => {
    expect(() => trailUpTo(twoSampleTrack, Number.NaN, matchStartTimestampSeconds)).toThrow(/NaN/);
    expect(() =>
      trailUpTo(twoSampleTrack, Number.POSITIVE_INFINITY, matchStartTimestampSeconds),
    ).toThrow(/Infinity/);
  });

  it("throws when the parallel arrays have different lengths", () => {
    const brokenTrack: ActorTrack = { ...twoSampleTrack, worldZ: [0] };
    expect(() => trailUpTo(brokenTrack, 20, matchStartTimestampSeconds)).toThrow(
      /different lengths/,
    );
  });
});
