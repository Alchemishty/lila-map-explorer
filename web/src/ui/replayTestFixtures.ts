import { deriveEvents, type MapEvent } from "../domain/events";
import type { ActorTrack, ActorType, DayFile, Manifest, MatchSummary } from "../domain/types";
import { fixtureEventConfig, fixtureMapConfig } from "./overviewTestFixtures";

// Test-only fixtures for the Replay tests (replay.test.ts and replay.browser.test.ts): one made-up
// multiplayer match (3 players, 2 bots, a player-vs-player kill) and one match with no bot files,
// both on Lockdown on 2026-02-12 (UTC), plus one match on 2026-02-13 in its own day file (for
// loads of a day file the user has since left). Not imported by app code.

interface FixtureRow {
  readonly eventCode: string;
  readonly elapsedSeconds: number;
  readonly worldX: number;
  readonly worldZ: number;
  readonly isSameTickRepeat?: boolean;
}

function buildTrack(
  actorKey: string,
  actorType: ActorType,
  matchStartTimestampSeconds: number,
  rows: readonly FixtureRow[],
): ActorTrack {
  return {
    actorKey,
    userId: actorKey,
    actorType,
    isPlayer: actorType !== "bot",
    worldX: rows.map((row) => row.worldX),
    worldZ: rows.map((row) => row.worldZ),
    timestampSeconds: rows.map((row) => matchStartTimestampSeconds + row.elapsedSeconds),
    eventCodes: rows.map((row) => row.eventCode),
    isSameTickRepeat: rows.map((row) => row.isSameTickRepeat === true),
  };
}

/** 2026-02-12 00:00:00 UTC, one hour later, and 2026-02-13 00:00:00 UTC. */
export const multiplayerMatchStartSeconds = 1_770_854_400;
export const quietMatchStartSeconds = 1_770_858_000;
export const nextDayMatchStartSeconds = 1_770_940_800;

/**
 * Match "multiplayer" (100 s): player-a kills player-b at 5 s, kills a bot at 10 s (flagged as a
 * same-second repeat) and loots at 15 s. bot-1 makes a kill at 20 s; bot-2 dies at 30 s. player-c
 * is a misidentified human whose last row, at 100 s, ends the match.
 */
export const multiplayerMatchTracks: readonly ActorTrack[] = [
  buildTrack("player-a-0f3c9e2d", "human", multiplayerMatchStartSeconds, [
    { eventCode: "Position", elapsedSeconds: 0, worldX: 10, worldZ: 20 },
    { eventCode: "Kill", elapsedSeconds: 5, worldX: 11.5, worldZ: 21.25 },
    { eventCode: "BotKill", elapsedSeconds: 10, worldX: 12, worldZ: 22, isSameTickRepeat: true },
    { eventCode: "Loot", elapsedSeconds: 15, worldX: 13, worldZ: 23 },
    { eventCode: "Position", elapsedSeconds: 40, worldX: 40, worldZ: 20 },
  ]),
  buildTrack("player-b", "human", multiplayerMatchStartSeconds, [
    { eventCode: "Position", elapsedSeconds: 1, worldX: 30, worldZ: 40 },
    { eventCode: "Killed", elapsedSeconds: 5, worldX: 31, worldZ: 41 },
  ]),
  buildTrack("player-c", "human_misid", multiplayerMatchStartSeconds, [
    { eventCode: "Position", elapsedSeconds: 2, worldX: -5, worldZ: -6 },
    { eventCode: "Position", elapsedSeconds: 100, worldX: -5, worldZ: 10 },
  ]),
  buildTrack("bot-1", "bot", multiplayerMatchStartSeconds, [
    { eventCode: "BotPosition", elapsedSeconds: 3, worldX: 50, worldZ: 60 },
    { eventCode: "BotKill", elapsedSeconds: 20, worldX: 51, worldZ: 61 },
    { eventCode: "BotPosition", elapsedSeconds: 60, worldX: 55, worldZ: 65 },
  ]),
  buildTrack("bot-2", "bot", multiplayerMatchStartSeconds, [
    { eventCode: "BotPosition", elapsedSeconds: 4, worldX: 70, worldZ: 80 },
    { eventCode: "BotKilled", elapsedSeconds: 30, worldX: 71, worldZ: 81 },
  ]),
];

/** Match "quiet" (80 s, no bot files): player-d walks east and loots. */
export const quietMatchTracks: readonly ActorTrack[] = [
  buildTrack("player-d", "human", quietMatchStartSeconds, [
    { eventCode: "Position", elapsedSeconds: 0, worldX: 0, worldZ: 0 },
    { eventCode: "Loot", elapsedSeconds: 10, worldX: 5, worldZ: 0 },
    { eventCode: "Position", elapsedSeconds: 80, worldX: 20, worldZ: 0 },
  ]),
];

/** Match "next-day" (60 s, no bot files, 2026-02-13): player-e stands still. */
export const nextDayMatchTracks: readonly ActorTrack[] = [
  buildTrack("player-e", "human", nextDayMatchStartSeconds, [
    { eventCode: "Position", elapsedSeconds: 0, worldX: -100, worldZ: -100 },
    { eventCode: "Position", elapsedSeconds: 60, worldX: -100, worldZ: -100 },
  ]),
];

const replayDayFilePath = "days/Lockdown/2026-02-12.json";
const nextDayFilePath = "days/Lockdown/2026-02-13.json";

function buildMatchSummary(
  matchId: string,
  dayUtc: string,
  startTimestampSeconds: number,
  durationSeconds: number,
  playerCount: number,
  botCount: number,
): MatchSummary {
  return {
    matchId,
    mapId: "Lockdown",
    dayUtc,
    startTimestampSeconds,
    durationSeconds,
    playerCount,
    botCount,
    eventCountsByMarker: {},
    dayFile: `days/Lockdown/${dayUtc}.json`,
  };
}

export const multiplayerMatch = buildMatchSummary(
  "multiplayer",
  "2026-02-12",
  multiplayerMatchStartSeconds,
  100,
  3,
  2,
);
export const quietMatch = buildMatchSummary(
  "quiet",
  "2026-02-12",
  quietMatchStartSeconds,
  80,
  1,
  0,
);
export const nextDayMatch = buildMatchSummary(
  "next-day",
  "2026-02-13",
  nextDayMatchStartSeconds,
  60,
  1,
  0,
);

export const replayDayFile: DayFile = {
  schemaVersion: 1,
  mapId: "Lockdown",
  dayUtc: "2026-02-12",
  matches: [
    { matchId: "multiplayer", actors: multiplayerMatchTracks },
    { matchId: "quiet", actors: quietMatchTracks },
  ],
};

export const replayManifest: Manifest = {
  schemaVersion: 1,
  generatedAtUtc: "2026-10-31T00:00:00+00:00",
  maps: [fixtureMapConfig],
  eventConfig: fixtureEventConfig,
  matches: [multiplayerMatch, quietMatch, nextDayMatch],
};

export const nextDayFile: DayFile = {
  schemaVersion: 1,
  mapId: "Lockdown",
  dayUtc: "2026-02-13",
  matches: [{ matchId: "next-day", actors: nextDayMatchTracks }],
};

/** The Replay day file at a manifest dayFile path, for fake loaders. An unknown path throws. */
export function requireReplayDayFile(dayFile: string): DayFile {
  if (dayFile === replayDayFilePath) {
    return replayDayFile;
  }
  if (dayFile === nextDayFilePath) {
    return nextDayFile;
  }
  throw new Error(`The Replay fixtures have no day file "${dayFile}"`);
}

/** The multiplayer match's first event with this marker key. A missing marker throws. */
export function requireMultiplayerEvent(markerKey: string): MapEvent {
  const found = deriveEvents(
    multiplayerMatchTracks,
    multiplayerMatch.matchId,
    replayManifest.eventConfig,
  ).find((mapEvent) => mapEvent.markerKey === markerKey);
  if (found === undefined) {
    throw new Error(`The multiplayer fixture has no "${markerKey}" event`);
  }
  return found;
}
