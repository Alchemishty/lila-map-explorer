import { describe, expect, it } from "vitest";
import { minimumFramedSpanWorldUnits, widenToMinimumSpan, worldRectOfTracks } from "./matchExtent";
import type { ActorTrack } from "./types";

function trackAt(actorKey: string, worldPoints: readonly [number, number][]): ActorTrack {
  return {
    actorKey,
    userId: actorKey,
    actorType: "human",
    isPlayer: true,
    worldX: worldPoints.map(([worldX]) => worldX),
    worldZ: worldPoints.map(([, worldZ]) => worldZ),
    timestampSeconds: worldPoints.map((_, i) => 1_770_854_400 + i),
    eventCodes: worldPoints.map(() => "Position"),
    isSameTickRepeat: worldPoints.map(() => false),
  };
}

describe("worldRectOfTracks", () => {
  it("holds every row of every track, exactly", () => {
    const rect = worldRectOfTracks(
      [
        trackAt("player-a", [
          [10.25, 20],
          [40, -6.5],
        ]),
        trackAt("bot-1", [[-5.75, 81]]),
      ],
      "match-1",
    );
    expect(rect).toEqual({ minWorldX: -5.75, maxWorldX: 40, minWorldZ: -6.5, maxWorldZ: 81 });
  });

  it("skips a track with no rows, which adds nothing", () => {
    expect(worldRectOfTracks([trackAt("empty", []), trackAt("one", [[3, 4]])], "match-1")).toEqual({
      minWorldX: 3,
      maxWorldX: 3,
      minWorldZ: 4,
      maxWorldZ: 4,
    });
  });

  it("throws, naming the match, when no track has a row", () => {
    expect(() => worldRectOfTracks([trackAt("empty", [])], "match-1")).toThrow(
      'Match "match-1" has no recorded rows to frame on the map',
    );
    expect(() => worldRectOfTracks([], "match-2")).toThrow('Match "match-2"');
  });

  it("throws when a track's x and z columns differ in length", () => {
    const brokenTrack: ActorTrack = { ...trackAt("player-a", [[1, 2]]), worldZ: [] };
    expect(() => worldRectOfTracks([brokenTrack], "match-1")).toThrow(
      'Actor "player-a" in match "match-1" has 1 x values but 0 z values',
    );
  });
});

describe("widenToMinimumSpan", () => {
  it("grows a single point into a square of the minimum span about it", () => {
    expect(
      widenToMinimumSpan({ minWorldX: 3, maxWorldX: 3, minWorldZ: 4, maxWorldZ: 4 }, 40),
    ).toEqual({ minWorldX: -17, maxWorldX: 23, minWorldZ: -16, maxWorldZ: 24 });
  });

  it("grows only the axis that is too narrow", () => {
    expect(
      widenToMinimumSpan({ minWorldX: 0, maxWorldX: 100, minWorldZ: 10, maxWorldZ: 20 }, 40),
    ).toEqual({ minWorldX: 0, maxWorldX: 100, minWorldZ: -5, maxWorldZ: 35 });
  });

  it("leaves a rect already wide enough unchanged", () => {
    const rect = { minWorldX: -50, maxWorldX: 50, minWorldZ: 0, maxWorldZ: 60 };
    expect(widenToMinimumSpan(rect, minimumFramedSpanWorldUnits)).toEqual(rect);
  });

  it("throws for a span that is not a positive number", () => {
    const rect = { minWorldX: 0, maxWorldX: 0, minWorldZ: 0, maxWorldZ: 0 };
    expect(() => widenToMinimumSpan(rect, 0)).toThrow("got 0");
    expect(() => widenToMinimumSpan(rect, Number.NaN)).toThrow("got NaN");
  });
});
