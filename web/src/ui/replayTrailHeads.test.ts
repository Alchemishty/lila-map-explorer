import { describe, expect, it } from "vitest";
import { createPlayback, seekPlayback } from "../domain/playback";
import { buildReplayModel, type ReplayModel } from "./replayModel";
import { multiplayerMatch, replayDayFile, replayManifest } from "./replayTestFixtures";
import { createInitialAppState, type AppState, type ReplayState } from "./stateTransitions";

// Replay trail head states (telemetry audit issue 9): the model gives every shown head its state,
// and the followed actor's summary starts with it before its counts so far.

function replayStateAt(elapsedSeconds: number, replayPatch: Partial<ReplayState> = {}): AppState {
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

describe("Replay trail head states and the followed actor's summary", () => {
  it("summarizes a followed player: kills of players and of bots separately, and loot so far", () => {
    expect(modelAt(12, { followedActorKey: "player-a-0f3c9e2d" }).followedActorSummary).toEqual({
      actorKey: "player-a-0f3c9e2d",
      isPlayer: true,
      lines: ["Now: Moving", "Kills of players: 1", "Kills of bots: 1", "Loot events: 0"],
    });
    expect(
      modelAt(100, { followedActorKey: "player-a-0f3c9e2d" }).followedActorSummary?.lines,
    ).toEqual(["Now: Last seen here", "Kills of players: 1", "Kills of bots: 1", "Loot events: 1"]);
  });

  it("summarizes a followed bot: kills and whether it died so far, saying who is not recorded", () => {
    expect(modelAt(25, { followedActorKey: "bot-1" }).followedActorSummary).toEqual({
      actorKey: "bot-1",
      isPlayer: false,
      lines: [
        "Now: Moving",
        "Kills: 1",
        "Death recorded so far: no",
        "The victim and killer are not recorded.",
      ],
    });
    const deadBotSummary = modelAt(30, { followedActorKey: "bot-2" }).followedActorSummary;
    expect(deadBotSummary?.lines).toEqual([
      "Now: Dead here",
      "Kills: 0",
      "Death recorded so far: yes",
      "The victim and killer are not recorded.",
    ]);
    expect(deadBotSummary?.lines.join(" ")).toContain("not recorded");
  });

  it("gives each head its state: moving, waiting, dead or last seen, and none before its first row", () => {
    const headStatesAt = (elapsedSeconds: number): [string, string | null][] =>
      modelAt(elapsedSeconds).trails.map((trail) => [trail.actorKey, trail.headState]);
    expect(headStatesAt(3.5)).toEqual([
      ["player-a-0f3c9e2d", "moving"],
      ["player-b", "moving"],
      ["player-c", "moving"],
      ["bot-1", "moving"],
      ["bot-2", null],
    ]);
    expect(headStatesAt(50)).toEqual([
      ["player-a-0f3c9e2d", "last_seen"],
      ["player-b", "dead"],
      ["player-c", "moving"],
      ["bot-1", "moving"],
      ["bot-2", "dead"],
    ]);
    expect(headStatesAt(100)).toContainEqual(["player-c", "last_seen"]);
    expect(headStatesAt(100)).toContainEqual(["bot-1", "last_seen"]);
  });

  it("starts a followed actor's summary with Not recorded yet before its first row", () => {
    expect(modelAt(2, { followedActorKey: "bot-2" }).followedActorSummary?.lines[0]).toBe(
      "Now: Not recorded yet",
    );
  });
});
