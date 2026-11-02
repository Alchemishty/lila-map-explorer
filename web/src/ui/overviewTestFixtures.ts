import type { HeatGrid } from "../domain/heatmap";
import type {
  ActorTrack,
  ActorType,
  DayFile,
  EventConfig,
  Manifest,
  MapConfig,
  MarkerStyle,
  MatchSummary,
} from "../domain/types";

// Test-only fixtures for the Overview tests (overview.test.ts and the browser tests): three Lockdown
// matches over two UTC days, with players, bots and every event kind. Not imported by app code.

function buildMarkerStyle(
  label: string,
  shape: MarkerStyle["shape"],
  fill: string,
  cross: string,
  outline: MarkerStyle["outline"],
): MarkerStyle {
  return { label, shape, fill, cross, outline };
}

/** Mirrors config/event_types.json. */
export const fixtureEventConfig: EventConfig = {
  player: {
    Position: { category: "position", otherParty: "none", marker: null },
    Kill: { category: "kill", otherParty: "player", marker: "kill_player" },
    BotKill: { category: "kill", otherParty: "bot", marker: "kill_bot" },
    Killed: { category: "combat_death", otherParty: "player", marker: "death_by_player" },
    BotKilled: { category: "combat_death", otherParty: "bot", marker: "death_by_bot" },
    KilledByStorm: { category: "storm_death", otherParty: "none", marker: "storm_death" },
    Loot: { category: "loot", otherParty: "none", marker: "loot" },
  },
  bot: {
    BotPosition: { category: "position", otherParty: "none", marker: null },
    BotKill: { category: "bot_kill", otherParty: "unknown", marker: "bot_kill" },
    BotKilled: { category: "bot_death", otherParty: "unknown", marker: "bot_death" },
  },
  markers: {
    kill_player: buildMarkerStyle(
      "Player killed a player",
      "circle",
      "#ef4444",
      "#ffffff",
      "solid",
    ),
    kill_bot: buildMarkerStyle("Player killed a bot", "square", "#ef4444", "#ffffff", "solid"),
    death_by_player: buildMarkerStyle(
      "Player killed by a player",
      "circle",
      "#111111",
      "#ef4444",
      "solid",
    ),
    death_by_bot: buildMarkerStyle(
      "Player killed by a bot",
      "square",
      "#111111",
      "#ef4444",
      "solid",
    ),
    storm_death: buildMarkerStyle("Player died to storm", "triangle", "#a855f7", "", "solid"),
    loot: buildMarkerStyle("Player looted", "diamond", "#facc15", "", "solid"),
    bot_kill: buildMarkerStyle(
      "Bot made a kill (victim not recorded)",
      "square",
      "#ef4444",
      "#ffffff",
      "dashed",
    ),
    bot_death: buildMarkerStyle(
      "Bot died (killer not recorded)",
      "square",
      "#111111",
      "#ef4444",
      "dashed",
    ),
  },
};

export const fixtureMapConfig: MapConfig = {
  mapId: "Lockdown",
  imageUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  imageWidthPixels: 1024,
  imageHeightPixels: 1024,
  worldScale: 1000,
  worldOriginX: -500,
  worldOriginZ: -500,
};

interface FixtureRow {
  readonly eventCode: string;
  readonly elapsedSeconds: number;
  readonly worldX: number;
  readonly worldZ: number;
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
    isSameTickRepeat: rows.map(() => false),
  };
}

function buildMatchSummary(
  matchId: string,
  dayUtc: string,
  startTimestampSeconds: number,
  botCount: number,
): MatchSummary {
  return {
    matchId,
    mapId: "Lockdown",
    dayUtc,
    startTimestampSeconds,
    durationSeconds: 100,
    playerCount: 1,
    botCount,
    eventCountsByMarker: {},
    dayFile: `days/Lockdown/${dayUtc}.json`,
  };
}

// 2026-02-10 and 2026-02-11 (UTC) start times.
const earlyMatchStartSeconds = 1_770_720_000;
const lateMatchStartSeconds = 1_770_800_000;
const lastMatchStartSeconds = 1_770_810_000;

/** Match "early" (Feb 10, bots): player-a walks east along z = 0, loots, dies in the storm. */
const earlyMatchTracks: readonly ActorTrack[] = [
  buildTrack("player-a", "human", earlyMatchStartSeconds, [
    { eventCode: "Position", elapsedSeconds: 0, worldX: -100, worldZ: 0 },
    { eventCode: "Loot", elapsedSeconds: 10, worldX: -50, worldZ: 0 },
    { eventCode: "Position", elapsedSeconds: 20, worldX: 100, worldZ: 0 },
    { eventCode: "KilledByStorm", elapsedSeconds: 30, worldX: 100, worldZ: 0 },
  ]),
  buildTrack("bot-1", "bot", earlyMatchStartSeconds, [
    { eventCode: "BotPosition", elapsedSeconds: 0, worldX: 200, worldZ: 200 },
    { eventCode: "BotKill", elapsedSeconds: 50, worldX: 210, worldZ: 200 },
  ]),
];

/** Match "late" (Feb 11, no bot files): player-b kills a bot, is killed by one, at x = 300. */
const lateMatchTracks: readonly ActorTrack[] = [
  buildTrack("player-b", "human", lateMatchStartSeconds, [
    { eventCode: "Position", elapsedSeconds: 0, worldX: 300, worldZ: 300 },
    { eventCode: "BotKill", elapsedSeconds: 40, worldX: 300, worldZ: 310 },
    { eventCode: "BotKilled", elapsedSeconds: 60, worldX: 300, worldZ: 320 },
  ]),
];

/** Match "last" (Feb 11, bots): player-c crosses x = 0 going north, with a storm death; bot-2 dies. */
const lastMatchTracks: readonly ActorTrack[] = [
  buildTrack("player-c", "human_misid", lastMatchStartSeconds, [
    { eventCode: "Position", elapsedSeconds: 0, worldX: 0, worldZ: -100 },
    { eventCode: "Position", elapsedSeconds: 30, worldX: 0, worldZ: 100 },
    { eventCode: "KilledByStorm", elapsedSeconds: 35, worldX: 0, worldZ: 100 },
  ]),
  buildTrack("bot-2", "bot", lastMatchStartSeconds, [
    { eventCode: "BotPosition", elapsedSeconds: 0, worldX: -200, worldZ: -200 },
    { eventCode: "BotKilled", elapsedSeconds: 20, worldX: -200, worldZ: -200 },
  ]),
];

export const fixtureMatches: readonly MatchSummary[] = [
  buildMatchSummary("early", "2026-02-10", earlyMatchStartSeconds, 1),
  buildMatchSummary("late", "2026-02-11", lateMatchStartSeconds, 0),
  buildMatchSummary("last", "2026-02-11", lastMatchStartSeconds, 1),
];

export const fixtureDayFiles: readonly DayFile[] = [
  {
    schemaVersion: 1,
    mapId: "Lockdown",
    dayUtc: "2026-02-10",
    matches: [{ matchId: "early", actors: earlyMatchTracks }],
  },
  {
    schemaVersion: 1,
    mapId: "Lockdown",
    dayUtc: "2026-02-11",
    matches: [
      { matchId: "late", actors: lateMatchTracks },
      { matchId: "last", actors: lastMatchTracks },
    ],
  },
];

export const fixtureManifest: Manifest = {
  schemaVersion: 1,
  generatedAtUtc: "2026-10-31T00:00:00+00:00",
  maps: [fixtureMapConfig],
  eventConfig: fixtureEventConfig,
  matches: fixtureMatches,
};

/** The day file at a manifest dayFile path, for fake loaders. An unknown path throws. */
export function requireFixtureDayFile(dayFile: string): DayFile {
  const found = fixtureDayFiles.find(
    (candidate) => `days/${candidate.mapId}/${candidate.dayUtc}.json` === dayFile,
  );
  if (found === undefined) {
    throw new Error(`The Overview fixtures have no day file "${dayFile}"`);
  }
  return found;
}

/** The sum of every cell of a heat grid. */
export function sumHeatGrid(grid: HeatGrid): number {
  let total = 0;
  for (const value of grid.values) {
    total += value;
  }
  return total;
}
