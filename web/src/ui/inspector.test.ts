import { describe, expect, it } from "vitest";
import type { MatchSummary } from "../domain/types";
import {
  areaCountRows,
  areaHintText,
  areaHintTextFor,
  formatPassingThrough,
  replayMatchRows,
  touchAreaHintText,
} from "./inspector";
import { legendEntries } from "./legend";
import { fixtureEventConfig, fixtureMatches } from "./overviewTestFixtures";

describe("area inspector content", () => {
  const areaSummary = {
    countsByMarker: { loot: 3, kill_bot: 1 },
    matchIdsPassingThrough: ["early", "last"],
    matchesToReplay: [],
  };

  it("lists every legend marker with its count, 0 for markers absent from the summary", () => {
    expect(
      areaCountRows(areaSummary, legendEntries(fixtureEventConfig, "player")).map((countRow) => [
        countRow.entry.style.label,
        countRow.count,
      ]),
    ).toEqual([
      ["Player killed a player", 0],
      ["Player killed a bot", 1],
      ["Player killed by a player", 0],
      ["Player killed by a bot", 0],
      ["Player died to storm", 0],
      ["Player looted", 3],
    ]);
  });

  it("says how many matches passed through", () => {
    expect(formatPassingThrough({ ...areaSummary, matchIdsPassingThrough: ["one"] })).toBe(
      "Player paths crossed this area in 1 match",
    );
    expect(formatPassingThrough(areaSummary)).toBe("Player paths crossed this area in 2 matches");
    expect(formatPassingThrough({ ...areaSummary, matchIdsPassingThrough: [] })).toBe(
      "Player paths crossed this area in 0 matches",
    );
  });
});

describe("replayMatchRows", () => {
  const matchesById = new Map<string, MatchSummary>(
    fixtureMatches.map((match) => [match.matchId, match]),
  );
  const entries = legendEntries(fixtureEventConfig, "all");

  it("labels each match with its UTC start and its events in the area, in the summary's order", () => {
    const rows = replayMatchRows(
      [
        { matchId: "late", eventCountInArea: 2, countsByMarker: { loot: 2 } },
        { matchId: "last", eventCountInArea: 1, countsByMarker: { loot: 1 } },
        { matchId: "early", eventCountInArea: 0, countsByMarker: {} },
      ],
      matchesById,
      entries,
    );
    expect(rows.map((row) => [row.matchId, row.label])).toEqual([
      ["late", "Feb 11 · 08:53 UTC · 2 events"],
      ["last", "Feb 11 · 11:40 UTC · 1 event"],
      ["early", "Feb 10 · 10:40 UTC · 0 events"],
    ]);
  });

  it("breaks each match's events down by marker, non-zero only, in legend order", () => {
    const [row] = replayMatchRows(
      [
        {
          matchId: "late",
          eventCountInArea: 6,
          countsByMarker: { loot: 2, bot_kill: 1, kill_bot: 3 },
        },
      ],
      matchesById,
      entries,
    );
    expect(row?.markerCounts.map(({ entry, count }) => [entry.markerKey, count])).toEqual([
      ["kill_bot", 3],
      ["loot", 2],
      ["bot_kill", 1],
    ]);
  });

  it("gives a 0-event match no breakdown", () => {
    const [row] = replayMatchRows(
      [{ matchId: "early", eventCountInArea: 0, countsByMarker: {} }],
      matchesById,
      entries,
    );
    expect(row?.markerCounts).toEqual([]);
  });

  it("throws, naming the match, when a listed match is not among the selected matches", () => {
    expect(() =>
      replayMatchRows(
        [{ matchId: "missing", eventCountInArea: 1, countsByMarker: { loot: 1 } }],
        matchesById,
        entries,
      ),
    ).toThrow(/"missing"/);
  });

  it("throws, naming the marker and match, when a counted marker is not in the legend", () => {
    expect(() =>
      replayMatchRows(
        [{ matchId: "late", eventCountInArea: 1, countsByMarker: { bot_death: 1 } }],
        matchesById,
        legendEntries(fixtureEventConfig, "player"),
      ),
    ).toThrow(/"bot_death".*"late"/);
  });
});

describe("area hint wording", () => {
  it("names Shift-drag only where there is a pointer that can hover", () => {
    expect(areaHintTextFor(false)).toBe(
      "Shift-drag on the map, or press Select area and drag, to see what happened in an area.",
    );
    expect(areaHintTextFor(false)).toBe(areaHintText);
  });

  it("names only the touch steps on touch screens with no hover, where there is no Shift key", () => {
    expect(areaHintTextFor(true)).toBe(
      "Press Select area, then drag on the map to see what happened in an area.",
    );
    expect(areaHintTextFor(true)).toBe(touchAreaHintText);
    expect(touchAreaHintText).not.toContain("Shift");
  });
});
