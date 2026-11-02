import { describe, expect, it } from "vitest";
import { createPlayback, seekPlayback } from "../domain/playback";
import type { DayFile } from "../domain/types";
import { buildReplayModel, noBotFilesNoteText, type ReplayModel } from "./replayModel";
import {
  multiplayerMatch,
  quietMatch,
  replayDayFile,
  replayManifest,
  requireMultiplayerEvent,
} from "./replayTestFixtures";
import {
  createInitialAppState,
  transitionAppState,
  type AppState,
  type ReplayState,
} from "./stateTransitions";

// Replay's model. The inspector and timeline text are tested in
// replayInspector.test.ts, the DOM parts in replay.browser.test.ts.

const initialState = createInitialAppState(replayManifest);

function buildReplayState(replayPatch: Partial<ReplayState>): AppState {
  return {
    appMode: "replay",
    filter: { mapId: "Lockdown", dayUtcSet: new Set(["2026-02-12"]), matchIdSet: null },
    overview: {
      heatmapKind: null,
      visibleMarkerKeys: initialState.overview.visibleMarkerKeys,
      selectedArea: null,
    },
    replay: {
      matchId: multiplayerMatch.matchId,
      followedActorKey: null,
      shouldHideBots: false,
      visibleMarkerKeys: initialState.replay.visibleMarkerKeys,
      playback: createPlayback(multiplayerMatch),
      inspectedMarkerEvents: [],
      ...replayPatch,
    },
  };
}

/** The model of the multiplayer match at elapsedSeconds. */
function modelAt(elapsedSeconds: number, replayPatch: Partial<ReplayState> = {}): ReplayModel {
  const playback = seekPlayback(createPlayback(multiplayerMatch), elapsedSeconds);
  return buildReplayModel(
    buildReplayState({ playback, ...replayPatch }),
    replayManifest,
    replayDayFile,
  );
}

describe("buildReplayModel", () => {
  it("gives every actor of the multiplayer match: 5 tracks, or the 3 players with shouldHideBots", () => {
    expect(modelAt(0).tracks.map((track) => track.actorKey)).toEqual([
      "player-a-0f3c9e2d",
      "player-b",
      "player-c",
      "bot-1",
      "bot-2",
    ]);
    expect(modelAt(0, { shouldHideBots: true }).tracks.map((track) => track.actorKey)).toEqual([
      "player-a-0f3c9e2d",
      "player-b",
      "player-c",
    ]);
  });

  it("colors players from the palette in order of their first row and bots dashed grey", () => {
    const { colors } = modelAt(0);
    expect(colors.get("player-a-0f3c9e2d")).toEqual({ color: "#22d3ee", isDashed: false });
    expect(colors.get("player-b")).toEqual({ color: "#f472b6", isDashed: false });
    expect(colors.get("player-c")).toEqual({ color: "#a3e635", isDashed: false });
    expect(colors.get("bot-2")).toEqual({ color: "#cbd5e1", isDashed: true });
  });

  it("shows bot events by default, and shouldHideBots removes them but keeps kill_bot", () => {
    expect(modelAt(100).visibleEvents.map((mapEvent) => mapEvent.markerKey)).toEqual([
      "kill_player",
      "death_by_player",
      "kill_bot",
      "loot",
      "bot_kill",
      "bot_death",
    ]);
    const hiddenBotsModel = modelAt(100, { shouldHideBots: true });
    expect(hiddenBotsModel.visibleEvents.map((mapEvent) => mapEvent.markerKey)).toEqual([
      "kill_player",
      "death_by_player",
      "kill_bot",
      "loot",
    ]);
    expect(hiddenBotsModel.ticks.map((tick) => tick.markerKey)).toEqual([
      "kill_player",
      "death_by_player",
      "kill_bot",
      "loot",
    ]);
  });

  it("shows only the events that happened by now, but ticks for the whole match", () => {
    const model = modelAt(12);
    expect(model.visibleEvents.map((mapEvent) => mapEvent.markerKey)).toEqual([
      "kill_player",
      "death_by_player",
      "kill_bot",
    ]);
    expect(model.ticks.map((tick) => [tick.markerKey, tick.elapsedSeconds, tick.fraction])).toEqual(
      [
        ["kill_player", 5, 0.05],
        ["death_by_player", 5, 0.05],
        ["kill_bot", 10, 0.1],
        ["loot", 15, 0.15],
        ["bot_kill", 20, 0.2],
        ["bot_death", 30, 0.3],
      ],
    );
  });

  it("grows trails with the clock: rows so far plus a head moving toward the next row", () => {
    const playerTrail = modelAt(20).trails.find((trail) => trail.actorKey === "player-a-0f3c9e2d");
    expect(playerTrail?.points).toEqual([
      { worldX: 10, worldZ: 20 },
      { worldX: 11.5, worldZ: 21.25 },
      { worldX: 12, worldZ: 22 },
      { worldX: 13, worldZ: 23 },
    ]);
    // 5 s of the 25 s from (13, 23) at 15 s to (40, 20) at 40 s.
    expect(playerTrail?.headPosition?.worldX).toBeCloseTo(18.4, 10);
    expect(playerTrail?.headPosition?.worldZ).toBeCloseTo(22.4, 10);
    expect(playerTrail?.style).toEqual({
      color: "#22d3ee",
      isDashed: false,
      isHighlighted: false,
      isDimmed: false,
      headShape: "round",
    });
    const lateBotTrail = modelAt(2).trails.find((trail) => trail.actorKey === "bot-2");
    expect(lateBotTrail).toEqual({
      actorKey: "bot-2",
      points: [],
      headPosition: null,
      headState: null,
      style: {
        color: "#cbd5e1",
        isDashed: true,
        isHighlighted: false,
        isDimmed: false,
        headShape: "square",
      },
    });
  });

  it("highlights the followed actor's trail and dims every other trail", () => {
    const trails = modelAt(50, { followedActorKey: "bot-1" }).trails;
    expect(
      trails.map((trail) => [trail.actorKey, trail.style.isHighlighted, trail.style.isDimmed]),
    ).toEqual([
      ["player-a-0f3c9e2d", false, true],
      ["player-b", false, true],
      ["player-c", false, true],
      ["bot-1", true, false],
      ["bot-2", false, true],
    ]);
  });

  it("does not follow a bot hidden by shouldHideBots, and shows it again when bots are shown", () => {
    const hiddenModel = modelAt(50, { followedActorKey: "bot-1", shouldHideBots: true });
    expect(hiddenModel.followedActorSummary).toBeNull();
    expect(hiddenModel.trails.some((trail) => trail.style.isDimmed)).toBe(false);
    expect(modelAt(50, { followedActorKey: "bot-1" }).followedActorSummary?.actorKey).toBe("bot-1");
  });

  it("gives the exact note for a match with no bot files, and none for a match with bots", () => {
    const quietModel = buildReplayModel(
      buildReplayState({ matchId: quietMatch.matchId, playback: createPlayback(quietMatch) }),
      replayManifest,
      replayDayFile,
    );
    expect(quietModel.noBotFilesNote).toBe(
      "No bot tracks were recorded. Player events involving bots are still shown.",
    );
    expect(noBotFilesNoteText).toBe(quietModel.noBotFilesNote);
    expect(modelAt(0).noBotFilesNote).toBeNull();
  });

  it("is empty when no match is replayed", () => {
    const model = buildReplayModel(
      buildReplayState({ matchId: null, playback: null }),
      replayManifest,
      null,
    );
    expect(model).toEqual({
      match: null,
      tracks: [],
      colors: new Map(),
      visibleEvents: [],
      ticks: [],
      noBotFilesNote: null,
      followedActorSummary: null,
      trails: [],
    });
  });

  it("throws when the followed actor is not in the match", () => {
    expect(() => modelAt(0, { followedActorKey: "nobody" })).toThrow(
      'Actor "nobody" is followed, but match "multiplayer" has no such actor',
    );
  });

  it("throws, naming the day file, when the day file lacks the match's rows", () => {
    const otherDayFile: DayFile = { ...replayDayFile, matches: [] };
    expect(() => buildReplayModel(buildReplayState({}), replayManifest, otherDayFile)).toThrow(
      'Match "multiplayer" is listed in manifest.json but its rows were not found in ' +
        "days/Lockdown/2026-02-12.json",
    );
  });

  it("throws when the replayed match is not listed in manifest.json", () => {
    expect(() =>
      buildReplayModel(buildReplayState({ matchId: "unlisted" }), replayManifest, replayDayFile),
    ).toThrow('Match "unlisted" is replayed, but manifest.json does not list it');
  });

  it("throws when a match is replayed but its day file is not given", () => {
    expect(() => buildReplayModel(buildReplayState({}), replayManifest, null)).toThrow(
      'Match "multiplayer" is replayed, but its day file days/Lockdown/2026-02-12.json was not given',
    );
  });
});

describe("match change during playback (Review Focus 4)", () => {
  it("restarts the clock paused at 0, drops the followed actor and the old match's tracks", () => {
    const playingState = buildReplayState({
      followedActorKey: "player-a-0f3c9e2d",
      playback: { ...seekPlayback(createPlayback(multiplayerMatch), 50), isPlaying: true },
      inspectedMarkerEvents: [
        requireMultiplayerEvent("kill_bot"),
        requireMultiplayerEvent("death_by_player"),
      ],
    });
    const nextState = transitionAppState(
      playingState,
      { replay: { ...playingState.replay, matchId: quietMatch.matchId } },
      replayManifest.matches,
    );
    expect(nextState.replay.playback?.elapsedSeconds).toBe(0);
    expect(nextState.replay.playback?.isPlaying).toBe(false);
    expect(nextState.replay.followedActorKey).toBeNull();
    expect(nextState.replay.inspectedMarkerEvents).toEqual([]);
    const model = buildReplayModel(nextState, replayManifest, replayDayFile);
    expect(model.tracks.map((track) => track.actorKey)).toEqual(["player-d"]);
    expect(model.trails.map((trail) => trail.actorKey)).toEqual(["player-d"]);
    expect(model.visibleEvents).toEqual([]);
  });

  it("clears the inspected markers on a mode change", () => {
    const inspectingState = buildReplayState({
      inspectedMarkerEvents: [requireMultiplayerEvent("loot"), requireMultiplayerEvent("kill_bot")],
    });
    const nextState = transitionAppState(
      inspectingState,
      { appMode: "overview" },
      replayManifest.matches,
    );
    expect(nextState.replay.inspectedMarkerEvents).toEqual([]);
  });
});
