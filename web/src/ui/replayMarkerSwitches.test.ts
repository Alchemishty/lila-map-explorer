import { describe, expect, it } from "vitest";
import { createPlayback, seekPlayback } from "../domain/playback";
import { onlyMarker, playerMarkerKeys } from "./markerVisibility";
import { buildReplayModel, createReplayModelBuilder, type ReplayModel } from "./replayModel";
import { multiplayerMatch, replayDayFile, replayManifest } from "./replayTestFixtures";
import {
  createInitialAppState,
  transitionAppState,
  type AppState,
  type ReplayState,
} from "./stateTransitions";

// Per-type marker switches in Replay: their own set, all on by default; they filter
// markers and timeline ticks, never the followed actor's summary.

const allMarkerKeys = [
  "kill_player",
  "kill_bot",
  "death_by_player",
  "death_by_bot",
  "storm_death",
  "loot",
  "bot_kill",
  "bot_death",
];

function replayStateAt(elapsedSeconds: number, replayPatch: Partial<ReplayState>): AppState {
  const initialState = createInitialAppState(replayManifest);
  return {
    ...initialState,
    appMode: "replay",
    filter: { mapId: "Lockdown", dayUtcSet: new Set(["2026-02-12"]), matchIdSet: null },
    replay: {
      ...initialState.replay,
      matchId: multiplayerMatch.matchId,
      playback: seekPlayback(createPlayback(multiplayerMatch), elapsedSeconds),
      ...replayPatch,
    },
  };
}

function modelAt(elapsedSeconds: number, replayPatch: Partial<ReplayState> = {}): ReplayModel {
  return buildReplayModel(
    replayStateAt(elapsedSeconds, replayPatch),
    replayManifest,
    replayDayFile,
  );
}

function markerKeysOf(model: ReplayModel): string[] {
  return model.visibleEvents.map((mapEvent) => mapEvent.markerKey);
}

describe("Replay visible marker keys", () => {
  it("start with all 8 marker types on", () => {
    expect([...createInitialAppState(replayManifest).replay.visibleMarkerKeys]).toEqual(
      allMarkerKeys,
    );
  });

  it("are separate from the Overview's set: changing one leaves the other", () => {
    const initialState = createInitialAppState(replayManifest);
    const lootOnly = onlyMarker("loot", replayManifest.eventConfig);
    const nextState = transitionAppState(
      initialState,
      { replay: { ...initialState.replay, visibleMarkerKeys: lootOnly } },
      replayManifest.matches,
    );
    expect(nextState.replay.visibleMarkerKeys).toBe(lootOnly);
    expect(nextState.overview.visibleMarkerKeys).toBe(initialState.overview.visibleMarkerKeys);
  });
});

describe("Replay marker switches", () => {
  const withoutLoot = new Set(allMarkerKeys.filter((markerKey) => markerKey !== "loot"));

  it("hide a type's markers and timeline ticks", () => {
    expect(markerKeysOf(modelAt(100))).toContain("loot");
    const lootHiddenModel = modelAt(100, { visibleMarkerKeys: withoutLoot });
    expect(markerKeysOf(lootHiddenModel)).not.toContain("loot");
    expect(lootHiddenModel.ticks.some((tick) => tick.markerKey === "loot")).toBe(false);
    expect(modelAt(100).ticks.some((tick) => tick.markerKey === "loot")).toBe(true);
  });

  it("leave the followed actor's summary counting every event", () => {
    const followed = { followedActorKey: "player-a-0f3c9e2d", visibleMarkerKeys: withoutLoot };
    expect(modelAt(100, followed).followedActorSummary?.lines).toEqual([
      "Now: Last seen here",
      "Kills of players: 1",
      "Kills of bots: 1",
      "Loot events: 1",
    ]);
  });

  it("never show bot-performed events while bots are hidden, whatever the switches say", () => {
    const hiddenBotsModel = modelAt(100, { shouldHideBots: true });
    expect(hiddenBotsModel.visibleEvents.some((mapEvent) => mapEvent.isPerformedByBot)).toBe(false);
    // Bot-performed events are the bot-event markers; player events about bots keep kill_bot etc.
    expect(
      hiddenBotsModel.ticks.some((tick) => ["bot_kill", "bot_death"].includes(tick.markerKey)),
    ).toBe(false);
  });

  it("keep the bot types off after Only on a player row while bots were hidden", () => {
    const hiddenBotsState = replayStateAt(100, { shouldHideBots: true });
    const afterOnlyState = transitionAppState(
      hiddenBotsState,
      {
        replay: {
          ...hiddenBotsState.replay,
          visibleMarkerKeys: onlyMarker("loot", replayManifest.eventConfig),
        },
      },
      replayManifest.matches,
    );
    const botsShownState = transitionAppState(
      afterOnlyState,
      { replay: { ...afterOnlyState.replay, shouldHideBots: false } },
      replayManifest.matches,
    );
    // Loot is a player row, so this is "Only" on a player row while the bot rows were hidden.
    expect(playerMarkerKeys(replayManifest.eventConfig)).toContain("loot");
    expect([...botsShownState.replay.visibleMarkerKeys]).toEqual(["loot"]);
    const shownAgainModel = buildReplayModel(botsShownState, replayManifest, replayDayFile);
    expect(new Set(markerKeysOf(shownAgainModel))).toEqual(new Set(["loot"]));
  });

  it("throw, naming the key, for a marker key the config does not know", () => {
    expect(() => modelAt(0, { visibleMarkerKeys: new Set(["bogus"]) })).toThrow(
      'Marker "bogus" is not in eventConfig (manifest.json)',
    );
  });

  it("throw for an unknown marker key even when no match is replayed", () => {
    const noMatchState = replayStateAt(0, {
      matchId: null,
      playback: null,
      visibleMarkerKeys: new Set(["bogus"]),
    });
    expect(() => buildReplayModel(noMatchState, replayManifest, null)).toThrow(
      'Marker "bogus" is not in eventConfig (manifest.json)',
    );
    expect(() => createReplayModelBuilder()(noMatchState, replayManifest, null)).toThrow(
      'Marker "bogus" is not in eventConfig (manifest.json)',
    );
  });
});

describe("createReplayModelBuilder and the marker switches", () => {
  it("re-filters markers and ticks when only the switch set changes", () => {
    const buildCachedModel = createReplayModelBuilder();
    const allShownState = replayStateAt(100, {});
    const allShownModel = buildCachedModel(allShownState, replayManifest, replayDayFile);
    const lootOnlyState: AppState = {
      ...allShownState,
      replay: {
        ...allShownState.replay,
        visibleMarkerKeys: onlyMarker("loot", replayManifest.eventConfig),
      },
    };
    const lootOnlyModel = buildCachedModel(lootOnlyState, replayManifest, replayDayFile);
    expect(new Set(markerKeysOf(allShownModel)).size).toBeGreaterThan(1);
    expect(new Set(markerKeysOf(lootOnlyModel))).toEqual(new Set(["loot"]));
    expect(lootOnlyModel.ticks.every((tick) => tick.markerKey === "loot")).toBe(true);
    expect(lootOnlyModel.ticks.length).toBeLessThan(allShownModel.ticks.length);
  });
});
