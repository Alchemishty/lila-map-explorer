import { describe, expect, it } from "vitest";
import type { MatchSummary } from "../domain/types";
import {
  formatDayLabel,
  formatMatchLabel,
  formatMatchRowLabel,
  formatMatchStartLabel,
  toggleMatchInSubset,
} from "./matchPicker";

function buildMatch(overrides: Partial<MatchSummary>): MatchSummary {
  return {
    matchId: "match-1",
    mapId: "AmbroseValley",
    dayUtc: "2026-02-12",
    startTimestampSeconds: 1770905100, // 2026-02-12 14:05:00 UTC
    durationSeconds: 382,
    playerCount: 1,
    botCount: 14,
    eventCountsByMarker: {},
    dayFile: "days/AmbroseValley/2026-02-12.json",
    ...overrides,
  };
}

describe("formatMatchStartLabel", () => {
  it("gives the UTC start day and time only", () => {
    expect(formatMatchStartLabel(buildMatch({}))).toBe("Feb 12 · 14:05 UTC");
    expect(formatMatchStartLabel(buildMatch({ startTimestampSeconds: 1770109679 }))).toBe(
      "Feb 3 · 09:07 UTC",
    );
  });
});

describe("formatMatchLabel", () => {
  it("gives the exact approved match label", () => {
    expect(formatMatchLabel(buildMatch({}))).toBe(
      "Feb 12 · 14:05 UTC · 6m 22s · 1 player, 14 recorded bot tracks",
    );
  });

  it("uses the singular for one recorded bot track", () => {
    expect(formatMatchLabel(buildMatch({ botCount: 1 }))).toBe(
      "Feb 12 · 14:05 UTC · 6m 22s · 1 player, 1 recorded bot track",
    );
  });

  it("uses UTC, pads hours and minutes, and does not pad the day or the seconds", () => {
    const match = buildMatch({
      startTimestampSeconds: 1770109679, // 2026-02-03 09:07:59 UTC
      durationSeconds: 45,
      playerCount: 3,
      botCount: 0,
    });
    expect(formatMatchLabel(match)).toBe(
      "Feb 3 · 09:07 UTC · 0m 45s · 3 players, 0 recorded bot tracks",
    );
  });
});

describe("formatMatchRowLabel", () => {
  it("is the full label without the start day, for a row under its day heading", () => {
    expect(formatMatchRowLabel(buildMatch({}))).toBe(
      "14:05 UTC · 6m 22s · 1 player, 14 recorded bot tracks",
    );
    expect(formatMatchLabel(buildMatch({}))).toBe(
      `Feb 12 · ${formatMatchRowLabel(buildMatch({}))}`,
    );
  });

  it("keeps the singular and plural agreement and pads the time", () => {
    const match = buildMatch({
      startTimestampSeconds: 1770681480, // 2026-02-09 23:58:00 UTC
      durationSeconds: 744,
      playerCount: 2,
      botCount: 1,
    });
    expect(formatMatchRowLabel(match)).toBe(
      "23:58 UTC · 12m 24s · 2 players, 1 recorded bot track",
    );
  });
});

describe("formatDayLabel", () => {
  it("turns a UTC day into month and day", () => {
    expect(formatDayLabel("2026-02-10")).toBe("Feb 10");
    expect(formatDayLabel("2026-12-01")).toBe("Dec 1");
  });

  it("throws in plain words for a day that is not YYYY-MM-DD", () => {
    expect(() => formatDayLabel("Feb 10")).toThrow('"Feb 10" is not a UTC day in YYYY-MM-DD form');
  });
});

describe("toggleMatchInSubset", () => {
  const availableMatchIds = ["match-a", "match-b", "match-c"];

  it("unchecking one match while all are shown keeps every other match", () => {
    expect(toggleMatchInSubset(null, availableMatchIds, "match-b", false)).toEqual(
      new Set(["match-a", "match-c"]),
    );
  });

  it("checking a match adds it to the subset", () => {
    expect(toggleMatchInSubset(new Set(["match-a"]), availableMatchIds, "match-c", true)).toEqual(
      new Set(["match-a", "match-c"]),
    );
  });

  it("unchecking the last match of the subset goes back to all matches (null)", () => {
    expect(toggleMatchInSubset(new Set(["match-a"]), availableMatchIds, "match-a", false)).toBe(
      null,
    );
  });

  it("does not change the input set", () => {
    const matchIdSet = new Set(["match-a"]);
    toggleMatchInSubset(matchIdSet, availableMatchIds, "match-b", true);
    expect(matchIdSet).toEqual(new Set(["match-a"]));
  });

  it("throws for a match that is not available", () => {
    expect(() => toggleMatchInSubset(null, availableMatchIds, "match-z", true)).toThrow(
      'Match "match-z" is not one of the matches for the chosen map and days',
    );
  });
});
