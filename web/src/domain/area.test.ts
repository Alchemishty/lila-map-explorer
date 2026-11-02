import { describe, expect, it } from "vitest";
import { segmentIntersectsRect, summarizeArea } from "./area";
import type { MapEvent } from "./events";
import type { ActorTrack, ActorType, WorldPoint, WorldRect } from "./types";

const area: WorldRect = { minWorldX: 10, maxWorldX: 20, minWorldZ: 10, maxWorldZ: 20 };

function worldPoint(worldX: number, worldZ: number): WorldPoint {
  return { worldX, worldZ };
}

/** [eventCode, timestampSeconds, worldX, worldZ] */
type TrackRow = readonly [string, number, number, number];

function buildTrack(actorKey: string, actorType: ActorType, rows: readonly TrackRow[]): ActorTrack {
  return {
    actorKey,
    userId: actorKey,
    actorType,
    isPlayer: actorType !== "bot",
    eventCodes: rows.map((row) => row[0]),
    timestampSeconds: rows.map((row) => row[1]),
    worldX: rows.map((row) => row[2]),
    worldZ: rows.map((row) => row[3]),
    isSameTickRepeat: rows.map(() => false),
  };
}

function buildEvent(markerKey: string, position: WorldPoint, isSameTickRepeat = false): MapEvent {
  return {
    matchId: "match-1",
    actorKey: "player-a",
    actorType: "human",
    eventCode: markerKey,
    category: "kill",
    markerKey,
    otherParty: "bot",
    isPerformedByBot: false,
    position,
    timestampSeconds: 1000,
    isSameTickRepeat,
  };
}

describe("segmentIntersectsRect", () => {
  it("is true for a segment crossing the rect with both ends outside", () => {
    expect(segmentIntersectsRect(worldPoint(0, 15), worldPoint(30, 15), area)).toBe(true);
    expect(segmentIntersectsRect(worldPoint(5, 12), worldPoint(25, 18), area)).toBe(true);
  });

  it("is true when an end lies inside or exactly on the edge", () => {
    expect(segmentIntersectsRect(worldPoint(15, 15), worldPoint(40, 40), area)).toBe(true);
    expect(segmentIntersectsRect(worldPoint(0, 10), worldPoint(10, 10), area)).toBe(true);
  });

  it("is false for a segment that passes beside the rect", () => {
    expect(segmentIntersectsRect(worldPoint(0, 25), worldPoint(30, 25), area)).toBe(false);
    // Diagonal that misses the corner (20, 20): it crosses x = 20 at z = 21.
    expect(segmentIntersectsRect(worldPoint(18, 23), worldPoint(22, 19), area)).toBe(false);
  });

  it("handles a zero-length segment as a point", () => {
    expect(segmentIntersectsRect(worldPoint(12, 12), worldPoint(12, 12), area)).toBe(true);
    expect(segmentIntersectsRect(worldPoint(9, 12), worldPoint(9, 12), area)).toBe(false);
  });

  it("throws on a rect whose minimum is above its maximum", () => {
    const flippedArea: WorldRect = { minWorldX: 20, maxWorldX: 10, minWorldZ: 10, maxWorldZ: 20 };
    expect(() => segmentIntersectsRect(worldPoint(0, 0), worldPoint(1, 1), flippedArea)).toThrow(
      /minWorldX 20 is greater than maxWorldX 10/,
    );
  });
});

describe("summarizeArea", () => {
  it("counts each marker inside the area, edges included, and every repeated row", () => {
    const summary = summarizeArea(
      area,
      [
        buildEvent("kill_bot", worldPoint(12, 12)),
        buildEvent("kill_bot", worldPoint(12, 12), true),
        buildEvent("loot", worldPoint(20, 10)),
        buildEvent("loot", worldPoint(21, 10)),
      ],
      new Map([["match-1", []]]),
    );
    expect(summary.countsByMarker).toEqual({ kill_bot: 2, loot: 1 });
    expect(summary.matchIdsPassingThrough).toEqual([]);
  });

  it("counts a match whose samples sit on both sides of the area as passing through", () => {
    const tracksByMatch = new Map<string, readonly ActorTrack[]>([
      [
        "crossing-match",
        [
          buildTrack("player-a", "human", [
            ["Position", 0, 5, 15],
            ["Position", 5, 25, 15],
          ]),
        ],
      ],
    ]);
    const summary = summarizeArea(area, [], tracksByMatch);
    expect(summary.matchIdsPassingThrough).toEqual(["crossing-match"]);
    expect(summary.countsByMarker).toEqual({});
  });

  it("uses player tracks only and keeps the caller's match order", () => {
    const tracksByMatch = new Map<string, readonly ActorTrack[]>([
      [
        "second-player-crosses",
        [
          buildTrack("player-a", "human", [["Position", 0, 50, 50]]),
          buildTrack("player-b", "human_misid", [
            ["Position", 0, 15, 0],
            ["Position", 5, 15, 30],
          ]),
        ],
      ],
      [
        "only-bot-crosses",
        [
          buildTrack("player-c", "human", [
            ["Position", 0, 50, 50],
            ["Position", 5, 60, 60],
          ]),
          buildTrack("bot-1", "bot", [
            ["BotPosition", 0, 0, 15],
            ["BotPosition", 5, 30, 15],
          ]),
        ],
      ],
      ["one-sample-inside", [buildTrack("player-d", "human", [["Position", 0, 11, 19]])]],
      ["no-tracks", []],
    ]);
    const summary = summarizeArea(area, [], tracksByMatch);
    expect(summary.matchIdsPassingThrough).toEqual(["second-player-crosses", "one-sample-inside"]);
  });

  it("throws when a track's parallel arrays have different lengths", () => {
    const brokenTrack: ActorTrack = {
      ...buildTrack("player-a", "human", [
        ["Position", 0, 5, 15],
        ["Position", 5, 25, 15],
      ]),
      worldZ: [15],
    };
    expect(() => summarizeArea(area, [], new Map([["broken-match", [brokenTrack]]]))).toThrow(
      /broken-match.*player-a.*row 1/,
    );
  });
});

describe("summarizeArea matches to replay", () => {
  function eventInMatch(matchId: string, markerKey: string, position: WorldPoint): MapEvent {
    return { ...buildEvent(markerKey, position), matchId };
  }
  const crossingPlayerRows: readonly TrackRow[] = [
    ["Position", 0, 5, 15],
    ["Position", 5, 25, 15],
  ];
  const outsidePlayerRows: readonly TrackRow[] = [["Position", 0, 50, 50]];

  it("counts events inside the area per match, adding up to countsByMarker", () => {
    const tracksByMatch = new Map<string, readonly ActorTrack[]>([
      ["earliest-one-event", [buildTrack("player-a", "human", crossingPlayerRows)]],
      ["passes-only", [buildTrack("player-b", "human", crossingPlayerRows)]],
      ["three-events", [buildTrack("player-c", "human", crossingPlayerRows)]],
      ["later-one-event", [buildTrack("player-d", "human", crossingPlayerRows)]],
      ["never-near", [buildTrack("player-e", "human", outsidePlayerRows)]],
    ]);
    const summary = summarizeArea(
      area,
      [
        eventInMatch("later-one-event", "loot", worldPoint(11, 11)),
        eventInMatch("three-events", "loot", worldPoint(12, 12)),
        eventInMatch("three-events", "kill_bot", worldPoint(20, 20)),
        eventInMatch("three-events", "loot", worldPoint(10, 10)),
        eventInMatch("earliest-one-event", "kill_bot", worldPoint(15, 15)),
        eventInMatch("never-near", "loot", worldPoint(30, 30)),
      ],
      tracksByMatch,
    );
    expect(summary.countsByMarker).toEqual({ loot: 3, kill_bot: 2 });
    // Most events first, ties in the caller's (earliest-first) order, pass-through-only last.
    expect(summary.matchesToReplay).toEqual([
      { matchId: "three-events", eventCountInArea: 3, countsByMarker: { loot: 2, kill_bot: 1 } },
      { matchId: "earliest-one-event", eventCountInArea: 1, countsByMarker: { kill_bot: 1 } },
      { matchId: "later-one-event", eventCountInArea: 1, countsByMarker: { loot: 1 } },
      { matchId: "passes-only", eventCountInArea: 0, countsByMarker: {} },
    ]);
    const perMatchTotal = summary.matchesToReplay.reduce(
      (total, matchCount) => total + matchCount.eventCountInArea,
      0,
    );
    expect(perMatchTotal).toBe(5);
  });

  it("gives each match's counts per marker, adding up to its total and to countsByMarker", () => {
    const tracksByMatch = new Map<string, readonly ActorTrack[]>([
      ["mixed", [buildTrack("player-a", "human", crossingPlayerRows)]],
      ["loot-only", [buildTrack("player-b", "human", outsidePlayerRows)]],
    ]);
    const summary = summarizeArea(
      area,
      [
        eventInMatch("mixed", "kill_bot", worldPoint(12, 12)),
        eventInMatch("loot-only", "loot", worldPoint(13, 13)),
        eventInMatch("mixed", "loot", worldPoint(14, 14)),
        eventInMatch("mixed", "kill_bot", worldPoint(16, 16)),
        eventInMatch("loot-only", "loot", worldPoint(17, 17)),
        eventInMatch("mixed", "loot", worldPoint(40, 40)),
      ],
      tracksByMatch,
    );
    const totalByMarkerKey = new Map<string, number>();
    for (const matchCount of summary.matchesToReplay) {
      const perMarkerCounts = Object.entries(matchCount.countsByMarker);
      const perMarkerTotal = perMarkerCounts.reduce((total, [, count]) => total + count, 0);
      expect(perMarkerTotal).toBe(matchCount.eventCountInArea);
      for (const [markerKey, count] of perMarkerCounts) {
        const previousTotal = totalByMarkerKey.get(markerKey);
        totalByMarkerKey.set(markerKey, (previousTotal === undefined ? 0 : previousTotal) + count);
      }
    }
    expect(Object.fromEntries(totalByMarkerKey)).toEqual(summary.countsByMarker);
    expect(summary.countsByMarker).toEqual({ kill_bot: 2, loot: 3 });
    expect(summary.matchesToReplay.map((matchCount) => matchCount.countsByMarker)).toEqual([
      { kill_bot: 2, loot: 1 },
      { loot: 2 },
    ]);
  });

  it("lists a match whose only events inside are bot events, though no player path crossed", () => {
    const tracksByMatch = new Map<string, readonly ActorTrack[]>([
      ["bot-event-only", [buildTrack("player-a", "human", outsidePlayerRows)]],
    ]);
    const botKill = eventInMatch("bot-event-only", "bot_kill", worldPoint(15, 15));
    const summary = summarizeArea(area, [botKill], tracksByMatch);
    expect(summary.matchIdsPassingThrough).toEqual([]);
    expect(summary.matchesToReplay).toEqual([
      { matchId: "bot-event-only", eventCountInArea: 1, countsByMarker: { bot_kill: 1 } },
    ]);
  });

  it("lists a match with several players once, with every player's events", () => {
    const tracksByMatch = new Map<string, readonly ActorTrack[]>([
      [
        "multiplayer",
        [
          buildTrack("player-a", "human", crossingPlayerRows),
          buildTrack("player-b", "human", crossingPlayerRows),
        ],
      ],
    ]);
    const summary = summarizeArea(
      area,
      [
        eventInMatch("multiplayer", "kill_player", worldPoint(12, 15)),
        {
          ...eventInMatch("multiplayer", "death_by_player", worldPoint(12, 15)),
          actorKey: "player-b",
        },
      ],
      tracksByMatch,
    );
    expect(summary.matchIdsPassingThrough).toEqual(["multiplayer"]);
    // Both players' events add into the match's one row.
    expect(summary.matchesToReplay).toEqual([
      {
        matchId: "multiplayer",
        eventCountInArea: 2,
        countsByMarker: { kill_player: 1, death_by_player: 1 },
      },
    ]);
  });

  it("throws, naming the match, when an event inside belongs to a match without tracks", () => {
    expect(() =>
      summarizeArea(area, [eventInMatch("unknown-match", "loot", worldPoint(15, 15))], new Map()),
    ).toThrow(/unknown-match/);
  });
});
