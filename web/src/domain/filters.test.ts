import { describe, expect, it } from "vitest";
import { availableDays, groupMatchesByStartDay, selectMatches } from "./filters";
import type { MatchSummary } from "./types";

function buildMatch(
  matchId: string,
  mapId: string,
  dayUtc: string,
  startTimestampSeconds: number,
): MatchSummary {
  return {
    matchId,
    mapId,
    dayUtc,
    startTimestampSeconds,
    durationSeconds: 600,
    playerCount: 1,
    botCount: 0,
    eventCountsByMarker: {},
    dayFile: `days/${mapId}/${dayUtc}.json`,
  };
}

// Deliberately out of start-time order. "late-night" starts Feb 9 23:58 UTC (the real edge case).
const allMatches: readonly MatchSummary[] = [
  buildMatch("lockdown-feb11-b", "Lockdown", "2026-02-11", 1770800000),
  buildMatch("ambrose-feb10", "AmbroseValley", "2026-02-10", 1770700000),
  buildMatch("lockdown-feb10", "Lockdown", "2026-02-10", 1770720000),
  buildMatch("lockdown-feb11-a", "Lockdown", "2026-02-11", 1770790000),
  buildMatch("late-night", "Lockdown", "2026-02-09", 1770681480),
  buildMatch("lockdown-feb12", "Lockdown", "2026-02-12", 1770900000),
];

function matchIdsOf(matches: readonly MatchSummary[]): string[] {
  return matches.map((match) => match.matchId);
}

describe("selectMatches", () => {
  it("keeps only the filter's map and days, sorted by start time", () => {
    const selectedMatches = selectMatches(allMatches, {
      mapId: "Lockdown",
      dayUtcSet: new Set(["2026-02-11", "2026-02-09", "2026-02-10"]),
      matchIdSet: null,
    });
    expect(matchIdsOf(selectedMatches)).toEqual([
      "late-night",
      "lockdown-feb10",
      "lockdown-feb11-a",
      "lockdown-feb11-b",
    ]);
  });

  it("narrows to the match set when one is given", () => {
    const selectedMatches = selectMatches(allMatches, {
      mapId: "Lockdown",
      dayUtcSet: new Set(["2026-02-10", "2026-02-11"]),
      matchIdSet: new Set([
        "lockdown-feb11-b",
        "lockdown-feb10",
        "ambrose-feb10",
        "lockdown-feb12",
      ]),
    });
    expect(matchIdsOf(selectedMatches)).toEqual(["lockdown-feb10", "lockdown-feb11-b"]);
  });

  it("returns an empty list when a picked day has no matches on the map", () => {
    const selectedMatches = selectMatches(allMatches, {
      mapId: "AmbroseValley",
      dayUtcSet: new Set(["2026-02-12"]),
      matchIdSet: null,
    });
    expect(selectedMatches).toEqual([]);
  });

  it("selects nothing when no days are picked", () => {
    const selectedMatches = selectMatches(allMatches, {
      mapId: "Lockdown",
      dayUtcSet: new Set<string>(),
      matchIdSet: null,
    });
    expect(selectedMatches).toEqual([]);
  });

  it("orders matches with the same start time by match id", () => {
    const sameStartMatches = [
      buildMatch("match-b", "Lockdown", "2026-02-10", 1770720000),
      buildMatch("match-a", "Lockdown", "2026-02-10", 1770720000),
    ];
    const selectedMatches = selectMatches(sameStartMatches, {
      mapId: "Lockdown",
      dayUtcSet: new Set(["2026-02-10"]),
      matchIdSet: null,
    });
    expect(matchIdsOf(selectedMatches)).toEqual(["match-a", "match-b"]);
  });

  it("does not reorder the input list", () => {
    const inputMatchIds = matchIdsOf(allMatches);
    selectMatches(allMatches, {
      mapId: "Lockdown",
      dayUtcSet: new Set(["2026-02-11"]),
      matchIdSet: null,
    });
    expect(matchIdsOf(allMatches)).toEqual(inputMatchIds);
  });
});

describe("availableDays", () => {
  it("lists each UTC day of the map once, ascending", () => {
    expect(availableDays(allMatches, "Lockdown")).toEqual([
      "2026-02-09",
      "2026-02-10",
      "2026-02-11",
      "2026-02-12",
    ]);
    expect(availableDays(allMatches, "AmbroseValley")).toEqual(["2026-02-10"]);
  });

  it("returns an empty list for a map with no matches", () => {
    expect(availableDays(allMatches, "GrandRift")).toEqual([]);
  });
});

describe("groupMatchesByStartDay", () => {
  const lockdownMatches = selectMatches(allMatches, {
    mapId: "Lockdown",
    dayUtcSet: new Set(["2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12"]),
    matchIdSet: null,
  });

  it("gives one group per UTC start day, in time order, with each day's matches in time order", () => {
    expect(
      groupMatchesByStartDay(lockdownMatches).map((group) => [
        group.dayUtc,
        matchIdsOf(group.matches),
      ]),
    ).toEqual([
      ["2026-02-09", ["late-night"]],
      ["2026-02-10", ["lockdown-feb10"]],
      ["2026-02-11", ["lockdown-feb11-a", "lockdown-feb11-b"]],
      ["2026-02-12", ["lockdown-feb12"]],
    ]);
  });

  it("files the match starting Feb 9 at 23:58 UTC under Feb 9, its start day", () => {
    const lateNightMatch = allMatches.find((match) => match.matchId === "late-night");
    expect(groupMatchesByStartDay(lockdownMatches)[0]).toEqual({
      dayUtc: "2026-02-09",
      matches: [lateNightMatch],
    });
  });

  it("returns no groups for no matches", () => {
    expect(groupMatchesByStartDay([])).toEqual([]);
  });

  it("throws in plain words when a day comes back after a later day", () => {
    const outOfOrderMatches = [
      buildMatch("first", "Lockdown", "2026-02-10", 1770720000),
      buildMatch("second", "Lockdown", "2026-02-11", 1770800000),
      buildMatch("third", "Lockdown", "2026-02-10", 1770730000),
    ];
    expect(() => groupMatchesByStartDay(outOfOrderMatches)).toThrow(
      'Match "third" starts on 2026-02-10 after a later day\'s match: the match list is not in start-time order',
    );
  });
});
