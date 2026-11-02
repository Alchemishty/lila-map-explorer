import { describe, expect, it } from "vitest";
import type { MatchFilter } from "../domain/filters";
import { createPlayback } from "../domain/playback";
import type { MatchSummary } from "../domain/types";
import { transitionAppState, type AppState } from "./stateTransitions";

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
    botCount: 2,
    eventCountsByMarker: {},
    dayFile: `days/${mapId}/${dayUtc}.json`,
  };
}

// Deliberately out of start-time order.
const allMatches: readonly MatchSummary[] = [
  buildMatch("lockdown-feb11", "Lockdown", "2026-02-11", 1770800000),
  buildMatch("lockdown-feb10-late", "Lockdown", "2026-02-10", 1770740000),
  buildMatch("lockdown-feb10-early", "Lockdown", "2026-02-10", 1770720000),
  buildMatch("ambrose-feb12", "AmbroseValley", "2026-02-12", 1770900000),
  buildMatch("ambrose-feb10", "AmbroseValley", "2026-02-10", 1770700000),
];

function requireMatch(matchId: string): MatchSummary {
  const match = allMatches.find((candidate) => candidate.matchId === matchId);
  if (match === undefined) {
    throw new Error(`Test fixture has no match "${matchId}"`);
  }
  return match;
}

const lockdownAllDaysFilter: MatchFilter = {
  mapId: "Lockdown",
  dayUtcSet: new Set(["2026-02-10", "2026-02-11"]),
  matchIdSet: null,
};

const selectedAreaInLockdown = { minWorldX: 0, maxWorldX: 10, minWorldZ: 0, maxWorldZ: 10 };

/** Replay mode on Lockdown, playing "lockdown-feb11" at 120 s and following an actor. */
function buildPlayingReplayState(): AppState {
  return {
    appMode: "replay",
    filter: lockdownAllDaysFilter,
    overview: {
      heatmapKind: "traffic",
      visibleMarkerKeys: new Set([
        "kill_player",
        "kill_bot",
        "death_by_player",
        "death_by_bot",
        "storm_death",
        "loot",
      ]),
      selectedArea: selectedAreaInLockdown,
    },
    replay: {
      matchId: "lockdown-feb11",
      followedActorKey: "player-a",
      shouldHideBots: true,
      visibleMarkerKeys: new Set([
        "kill_player",
        "kill_bot",
        "death_by_player",
        "death_by_bot",
        "storm_death",
        "loot",
        "bot_kill",
        "bot_death",
      ]),
      playback: {
        ...createPlayback(requireMatch("lockdown-feb11")),
        elapsedSeconds: 120,
        speed: 4,
        isPlaying: true,
      },
      inspectedMarkerEvents: [],
    },
  };
}

function buildOverviewState(): AppState {
  const playingState = buildPlayingReplayState();
  return {
    ...playingState,
    appMode: "overview",
    replay: {
      matchId: null,
      followedActorKey: null,
      shouldHideBots: false,
      visibleMarkerKeys: new Set([
        "kill_player",
        "kill_bot",
        "death_by_player",
        "death_by_bot",
        "storm_death",
        "loot",
        "bot_kill",
        "bot_death",
      ]),
      playback: null,
      inspectedMarkerEvents: [],
    },
  };
}

describe("transitionAppState: a replay match change", () => {
  it("resets playback to elapsed 0, paused, and clears the followed actor", () => {
    const previous = buildPlayingReplayState();
    const next = transitionAppState(
      previous,
      { replay: { ...previous.replay, matchId: "lockdown-feb10-late" } },
      allMatches,
    );
    expect(next.replay.matchId).toBe("lockdown-feb10-late");
    expect(next.replay.playback).toEqual(createPlayback(requireMatch("lockdown-feb10-late")));
    expect(next.replay.playback?.elapsedSeconds).toBe(0);
    expect(next.replay.playback?.isPlaying).toBe(false);
    expect(next.replay.followedActorKey).toBeNull();
    expect(next.replay.shouldHideBots).toBe(true);
  });

  it("throws in plain words for a match that is not in the current selection", () => {
    const previous = buildPlayingReplayState();
    expect(() =>
      transitionAppState(
        previous,
        { replay: { ...previous.replay, matchId: "ambrose-feb10" } },
        allMatches,
      ),
    ).toThrow('Match "ambrose-feb10" cannot be replayed: it is not among the selected matches');
  });
});

describe("transitionAppState: a filter change", () => {
  it("moves to the earliest remaining match when the current one is filtered out", () => {
    const previous = buildPlayingReplayState();
    const next = transitionAppState(
      previous,
      { filter: { ...lockdownAllDaysFilter, dayUtcSet: new Set(["2026-02-10"]) } },
      allMatches,
    );
    expect(next.replay.matchId).toBe("lockdown-feb10-early");
    expect(next.replay.playback).toEqual(createPlayback(requireMatch("lockdown-feb10-early")));
    expect(next.replay.followedActorKey).toBeNull();
    expect(next.overview.selectedArea).toBeNull();
  });

  it("keeps the current match, restarted, when it is still selected", () => {
    const previous = buildPlayingReplayState();
    const next = transitionAppState(
      previous,
      { filter: { ...lockdownAllDaysFilter, dayUtcSet: new Set(["2026-02-11"]) } },
      allMatches,
    );
    expect(next.replay.matchId).toBe("lockdown-feb11");
    expect(next.replay.playback).toEqual(createPlayback(requireMatch("lockdown-feb11")));
  });

  it("gives a null match and null playback when no match is left", () => {
    const previous = buildPlayingReplayState();
    const next = transitionAppState(
      previous,
      { filter: { ...lockdownAllDaysFilter, dayUtcSet: new Set<string>() } },
      allMatches,
    );
    expect(next.replay.matchId).toBeNull();
    expect(next.replay.playback).toBeNull();
    expect(next.replay.followedActorKey).toBeNull();
  });

  it("drops match ids no longer available after a day change", () => {
    const previous: AppState = {
      ...buildOverviewState(),
      filter: {
        ...lockdownAllDaysFilter,
        matchIdSet: new Set(["lockdown-feb11", "lockdown-feb10-late"]),
      },
    };
    const next = transitionAppState(
      previous,
      { filter: { ...previous.filter, dayUtcSet: new Set(["2026-02-10"]) } },
      allMatches,
    );
    expect(next.filter.matchIdSet).toEqual(new Set(["lockdown-feb10-late"]));
  });

  it("turns the match subset into null when a day change leaves none of it", () => {
    const previous: AppState = {
      ...buildOverviewState(),
      filter: { ...lockdownAllDaysFilter, matchIdSet: new Set(["lockdown-feb11"]) },
    };
    const next = transitionAppState(
      previous,
      { filter: { ...previous.filter, dayUtcSet: new Set(["2026-02-10"]) } },
      allMatches,
    );
    expect(next.filter.matchIdSet).toBeNull();
  });

  it("resets days to all available days, the subset to null and the area to null on a map change", () => {
    const previous: AppState = {
      ...buildPlayingReplayState(),
      filter: { ...lockdownAllDaysFilter, matchIdSet: new Set(["lockdown-feb11"]) },
    };
    const next = transitionAppState(
      previous,
      { filter: { ...previous.filter, mapId: "AmbroseValley" } },
      allMatches,
    );
    expect(next.filter).toEqual({
      mapId: "AmbroseValley",
      dayUtcSet: new Set(["2026-02-10", "2026-02-12"]),
      matchIdSet: null,
    });
    expect(next.overview.selectedArea).toBeNull();
    expect(next.replay.matchId).toBe("ambrose-feb10");
    expect(next.replay.playback).toEqual(createPlayback(requireMatch("ambrose-feb10")));
  });

  it("leaves state untouched for a filter equal in content to the current one", () => {
    const previous = buildPlayingReplayState();
    const next = transitionAppState(
      previous,
      { filter: { ...lockdownAllDaysFilter, dayUtcSet: new Set(["2026-02-11", "2026-02-10"]) } },
      allMatches,
    );
    expect(next.replay).toBe(previous.replay);
    expect(next.overview.selectedArea).toBe(selectedAreaInLockdown);
  });
});

describe("transitionAppState: a mode change", () => {
  it("picks the earliest selected match when entering Replay with no match", () => {
    const next = transitionAppState(buildOverviewState(), { appMode: "replay" }, allMatches);
    expect(next.appMode).toBe("replay");
    expect(next.replay.matchId).toBe("lockdown-feb10-early");
    expect(next.replay.playback).toEqual(createPlayback(requireMatch("lockdown-feb10-early")));
  });

  it("stops playback and clears the followed actor when leaving Replay, keeping the area", () => {
    const next = transitionAppState(buildPlayingReplayState(), { appMode: "overview" }, allMatches);
    expect(next.replay.matchId).toBe("lockdown-feb11");
    expect(next.replay.playback).toEqual(createPlayback(requireMatch("lockdown-feb11")));
    expect(next.replay.followedActorKey).toBeNull();
    expect(next.overview.selectedArea).toBe(selectedAreaInLockdown);
  });

  it("opens Replay on a chosen selected match and keeps the filter (Replay a match here)", () => {
    const previous = buildOverviewState();
    const next = transitionAppState(
      previous,
      { appMode: "replay", replay: { ...previous.replay, matchId: "lockdown-feb10-late" } },
      allMatches,
    );
    expect(next.appMode).toBe("replay");
    expect(next.filter).toBe(previous.filter);
    expect(next.replay.matchId).toBe("lockdown-feb10-late");
    expect(next.replay.playback).toEqual(createPlayback(requireMatch("lockdown-feb10-late")));
  });
});

describe("transitionAppState: other changes", () => {
  it("passes a playback update through without any reset", () => {
    const previous = buildPlayingReplayState();
    const previousPlayback = previous.replay.playback;
    if (previousPlayback === null) {
      throw new Error("The playing fixture must have playback");
    }
    const nextPlayback = { ...previousPlayback, elapsedSeconds: 130 };
    const next = transitionAppState(
      previous,
      { replay: { ...previous.replay, playback: nextPlayback } },
      allMatches,
    );
    expect(next.replay.playback).toBe(nextPlayback);
    expect(next.replay.followedActorKey).toBe("player-a");
  });
});
