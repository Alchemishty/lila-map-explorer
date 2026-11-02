import { describe, expect, it } from "vitest";
import type { Manifest, MapConfig, MatchSummary } from "../domain/types";
import { createInitialAppState } from "./stateTransitions";

function buildMatch(matchId: string, mapId: string, dayUtc: string): MatchSummary {
  return {
    matchId,
    mapId,
    dayUtc,
    startTimestampSeconds: 1770720000,
    durationSeconds: 600,
    playerCount: 1,
    botCount: 2,
    eventCountsByMarker: {},
    dayFile: `days/${mapId}/${dayUtc}.json`,
  };
}

// Lockdown has the most matches; GrandRift has none.
const allMatches: readonly MatchSummary[] = [
  buildMatch("lockdown-feb11", "Lockdown", "2026-02-11"),
  buildMatch("lockdown-feb10-late", "Lockdown", "2026-02-10"),
  buildMatch("lockdown-feb10-early", "Lockdown", "2026-02-10"),
  buildMatch("ambrose-feb12", "AmbroseValley", "2026-02-12"),
  buildMatch("ambrose-feb10", "AmbroseValley", "2026-02-10"),
];

function buildMapConfig(mapId: string): MapConfig {
  return {
    mapId,
    imageUrl: `data/minimaps/${mapId}.jpg`,
    imageWidthPixels: 1024,
    imageHeightPixels: 1024,
    worldScale: 1000,
    worldOriginX: -500,
    worldOriginZ: -500,
  };
}

function buildManifest(mapIds: readonly string[]): Manifest {
  return {
    schemaVersion: 1,
    generatedAtUtc: "2026-10-31T00:00:00+00:00",
    maps: mapIds.map(buildMapConfig),
    eventConfig: { player: {}, bot: {}, markers: {} },
    matches: allMatches,
  };
}

describe("createInitialAppState", () => {
  it("starts on the map with the most matches, all its days, all matches, Overview on Kill zones", () => {
    const initialState = createInitialAppState(buildManifest(["AmbroseValley", "Lockdown"]));
    expect(initialState).toEqual({
      appMode: "overview",
      filter: {
        mapId: "Lockdown",
        dayUtcSet: new Set(["2026-02-10", "2026-02-11"]),
        matchIdSet: null,
      },
      overview: {
        heatmapKind: "kills",
        visibleMarkerKeys: new Set(),
        selectedArea: null,
      },
      replay: {
        matchId: null,
        followedActorKey: null,
        shouldHideBots: false,
        visibleMarkerKeys: new Set(), // this manifest's event config has no markers
        playback: null,
        inspectedMarkerEvents: [],
      },
    });
  });

  it("starts Overview with every marker type off, player and bot, while Replay shows them all", () => {
    const markerStyle = {
      label: "test marker",
      shape: "circle",
      fill: "#ef4444",
      cross: "",
      outline: "solid",
    } as const;
    const initialState = createInitialAppState({
      ...buildManifest(["Lockdown"]),
      eventConfig: {
        player: {
          Position: { category: "position", otherParty: "none", marker: null },
          BotKill: { category: "kill", otherParty: "bot", marker: "kill_bot" },
          Loot: { category: "loot", otherParty: "none", marker: "loot" },
        },
        bot: {
          BotPosition: { category: "position", otherParty: "none", marker: null },
          BotKilled: { category: "bot_death", otherParty: "unknown", marker: "bot_death" },
        },
        markers: { kill_bot: markerStyle, loot: markerStyle, bot_death: markerStyle },
      },
    });
    expect(initialState.overview.heatmapKind).toBe("kills");
    expect(initialState.overview.visibleMarkerKeys).toEqual(new Set());
    expect(initialState.replay.visibleMarkerKeys).toEqual(
      new Set(["kill_bot", "loot", "bot_death"]),
    );
  });

  it("breaks a tie by manifest order, and allows a map with no matches", () => {
    const tiedMatches = allMatches.filter((match) => match.matchId !== "lockdown-feb11");
    const lockdownFirstState = createInitialAppState({
      ...buildManifest(["Lockdown", "AmbroseValley"]),
      matches: tiedMatches,
    });
    expect(lockdownFirstState.filter.mapId).toBe("Lockdown");
    const ambroseFirstState = createInitialAppState({
      ...buildManifest(["AmbroseValley", "Lockdown"]),
      matches: tiedMatches,
    });
    expect(ambroseFirstState.filter.mapId).toBe("AmbroseValley");
    const emptyMapState = createInitialAppState({ ...buildManifest(["GrandRift"]), matches: [] });
    expect(emptyMapState.filter.mapId).toBe("GrandRift");
    expect(emptyMapState.filter.dayUtcSet).toEqual(new Set());
  });

  it("throws in plain words for a manifest with no maps", () => {
    expect(() => createInitialAppState(buildManifest([]))).toThrow(
      "manifest.json lists no maps, so there is nothing to show",
    );
  });
});
