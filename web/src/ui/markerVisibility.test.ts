import { describe, expect, it } from "vitest";
import type { MapEvent } from "../domain/events";
import type { MatchSummary } from "../domain/types";
import {
  botOnlyMarkerKeys,
  onlyMarker,
  playerMarkerKeys,
  requireKnownMarkerKeys,
  visibleMarkerEvents,
  withAllPlayerMarkers,
  withMarkerVisibility,
} from "./markerVisibility";
import { fixtureEventConfig, fixtureManifest, fixtureMatches } from "./overviewTestFixtures";
import { createInitialAppState, transitionAppState, type AppState } from "./stateTransitions";

const allPlayerKeys = [
  "kill_player",
  "kill_bot",
  "death_by_player",
  "death_by_bot",
  "storm_death",
  "loot",
];

function sortedKeys(markerKeys: ReadonlySet<string>): string[] {
  return [...markerKeys].sort();
}

describe("marker key lists", () => {
  it("lists the 6 player keys and the 2 bot-only keys in config order", () => {
    expect(playerMarkerKeys(fixtureEventConfig)).toEqual(allPlayerKeys);
    expect(botOnlyMarkerKeys(fixtureEventConfig)).toEqual(["bot_kill", "bot_death"]);
  });
});

describe("visibility changes", () => {
  const someKeys: ReadonlySet<string> = new Set(["loot", "bot_kill"]);

  it("adds or removes one key and returns a new set", () => {
    const withStorm = withMarkerVisibility(someKeys, "storm_death", true, fixtureEventConfig);
    expect(sortedKeys(withStorm)).toEqual(["bot_kill", "loot", "storm_death"]);
    const withoutLoot = withMarkerVisibility(someKeys, "loot", false, fixtureEventConfig);
    expect(sortedKeys(withoutLoot)).toEqual(["bot_kill"]);
    expect(sortedKeys(someKeys)).toEqual(["bot_kill", "loot"]);
  });

  it("switches every player key with Show all and Hide all, leaving the bot keys as they were", () => {
    expect(sortedKeys(withAllPlayerMarkers(someKeys, true, fixtureEventConfig))).toEqual(
      [...allPlayerKeys, "bot_kill"].sort(),
    );
    expect(sortedKeys(withAllPlayerMarkers(someKeys, false, fixtureEventConfig))).toEqual([
      "bot_kill",
    ]);
  });

  it("turns one key on and every other key off with Only", () => {
    expect(sortedKeys(onlyMarker("storm_death", fixtureEventConfig))).toEqual(["storm_death"]);
    expect(sortedKeys(onlyMarker("bot_death", fixtureEventConfig))).toEqual(["bot_death"]);
  });

  it("throws, naming the key, for a key the config does not know", () => {
    expect(() => requireKnownMarkerKeys(new Set(["loot", "nope"]), fixtureEventConfig)).toThrow(
      'Marker "nope" is not in eventConfig',
    );
    expect(() => withMarkerVisibility(someKeys, "nope", true, fixtureEventConfig)).toThrow(
      'Marker "nope" is not in eventConfig',
    );
    expect(() => onlyMarker("nope", fixtureEventConfig)).toThrow('Marker "nope"');
  });
});

describe("visibleMarkerEvents", () => {
  it("keeps the events whose marker is visible, in input order", () => {
    const events = ["loot", "storm_death", "loot", "kill_bot"].map(
      (markerKey, eventIndex) => ({ markerKey, eventIndex }) as unknown as MapEvent,
    );
    const shownEvents = visibleMarkerEvents(events, new Set(["loot", "kill_bot"]));
    expect(shownEvents).toEqual([events[0], events[2], events[3]]);
  });
});

describe("Overview visible marker keys in the app state", () => {
  it("start with every key off, player and bot, so the Kill zones heatmap reads first", () => {
    const initialState = createInitialAppState(fixtureManifest);
    expect(sortedKeys(initialState.overview.visibleMarkerKeys)).toEqual([]);
    expect(initialState.overview.heatmapKind).toBe("kills");
  });

  it("survive day, match, map and mode changes", () => {
    const otherMapMatch: MatchSummary = {
      ...(fixtureMatches[0] as MatchSummary),
      matchId: "other-map-match",
      mapId: "OtherMap",
    };
    const matches = [...fixtureMatches, otherMapMatch];
    const initialState = createInitialAppState(fixtureManifest);
    const chosenKeys: ReadonlySet<string> = new Set(["storm_death", "bot_death"]);
    let state: AppState = transitionAppState(
      initialState,
      { overview: { ...initialState.overview, visibleMarkerKeys: chosenKeys } },
      matches,
    );
    const patches: Partial<AppState>[] = [
      { filter: { ...state.filter, dayUtcSet: new Set(["2026-02-11"]) } },
      { filter: { ...state.filter, matchIdSet: new Set(["last"]) } },
      { filter: { mapId: "OtherMap", dayUtcSet: new Set(), matchIdSet: null } },
      { appMode: "replay" },
      { appMode: "overview" },
    ];
    for (const patch of patches) {
      state = transitionAppState(state, patch, matches);
      expect(state.overview.visibleMarkerKeys).toBe(chosenKeys);
    }
    expect(state.filter.mapId).toBe("OtherMap");
  });
});
