import { describe, expect, it } from "vitest";
import { DataContractError } from "./contract";
import { botSideEvents, deriveEvents, playerSideEvents } from "./events";
import type { ActorTrack, ActorType, EventConfig, MarkerStyle } from "./types";

const placeholderMarkerStyle: MarkerStyle = {
  label: "test marker",
  shape: "circle",
  fill: "#ef4444",
  cross: "",
  outline: "solid",
};

// The rules mirror config/event_types.json (marker styles do not matter to deriveEvents).
const eventConfig: EventConfig = {
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
  markers: Object.fromEntries(
    [
      "kill_player",
      "kill_bot",
      "death_by_player",
      "death_by_bot",
      "storm_death",
      "loot",
      "bot_kill",
      "bot_death",
    ].map((markerKey) => [markerKey, placeholderMarkerStyle]),
  ),
};

interface TrackRow {
  readonly eventCode: string;
  readonly timestampSeconds: number;
  readonly worldX: number;
  readonly worldZ: number;
  readonly isSameTickRepeat?: boolean;
}

function buildTrack(actorKey: string, actorType: ActorType, rows: readonly TrackRow[]): ActorTrack {
  return {
    actorKey,
    userId: actorKey,
    actorType,
    isPlayer: actorType !== "bot",
    worldX: rows.map((row) => row.worldX),
    worldZ: rows.map((row) => row.worldZ),
    timestampSeconds: rows.map((row) => row.timestampSeconds),
    eventCodes: rows.map((row) => row.eventCode),
    isSameTickRepeat: rows.map((row) => row.isSameTickRepeat === true),
  };
}

const matchId = "multiplayer-match.nakama-0";

// Mirrors pipeline test_multiplayer.py: 3 players and 2 bots on Lockdown. Player A kills player B
// and a bot, bot 1 makes a kill and bot 2 dies. Player C is a misidentified human with no events.
const multiplayerTracks: readonly ActorTrack[] = [
  buildTrack("player-a", "human", [
    { eventCode: "Position", timestampSeconds: 1000, worldX: 10, worldZ: 20 },
    { eventCode: "Kill", timestampSeconds: 1005, worldX: 11.5, worldZ: 21.25 },
    {
      eventCode: "BotKill",
      timestampSeconds: 1010,
      worldX: 12,
      worldZ: 22,
      isSameTickRepeat: true,
    },
  ]),
  buildTrack("player-b", "human", [
    { eventCode: "Position", timestampSeconds: 1001, worldX: 30, worldZ: 40 },
    { eventCode: "Killed", timestampSeconds: 1005, worldX: 31, worldZ: 41 },
  ]),
  buildTrack("player-c-misid", "human_misid", [
    { eventCode: "Position", timestampSeconds: 1002, worldX: -5, worldZ: -6 },
  ]),
  buildTrack("bot-1", "bot", [
    { eventCode: "BotPosition", timestampSeconds: 1003, worldX: 50, worldZ: 60 },
    { eventCode: "BotKill", timestampSeconds: 1020, worldX: 51, worldZ: 61 },
  ]),
  buildTrack("bot-2", "bot", [
    { eventCode: "BotPosition", timestampSeconds: 1004, worldX: 70, worldZ: 80 },
    { eventCode: "BotKilled", timestampSeconds: 1030, worldX: 71, worldZ: 81 },
  ]),
];

describe("deriveEvents", () => {
  it("derives one event per non-position row, with player or bot rules chosen by isPlayer", () => {
    const mapEvents = deriveEvents(multiplayerTracks, matchId, eventConfig);
    expect(
      mapEvents.map((mapEvent) => [
        mapEvent.actorKey,
        mapEvent.markerKey,
        mapEvent.isPerformedByBot,
      ]),
    ).toEqual([
      ["player-a", "kill_player", false],
      ["player-a", "kill_bot", false],
      ["player-b", "death_by_player", false],
      ["bot-1", "bot_kill", true],
      ["bot-2", "bot_death", true],
    ]);
  });

  it("copies every field of the row and its rule exactly", () => {
    const mapEvents = deriveEvents(multiplayerTracks, matchId, eventConfig);
    expect(mapEvents[1]).toEqual({
      matchId,
      actorKey: "player-a",
      actorType: "human",
      eventCode: "BotKill",
      category: "kill",
      markerKey: "kill_bot",
      otherParty: "bot",
      isPerformedByBot: false,
      position: { worldX: 12, worldZ: 22 },
      timestampSeconds: 1010,
      isSameTickRepeat: true,
    });
    expect(mapEvents[3]).toEqual({
      matchId,
      actorKey: "bot-1",
      actorType: "bot",
      eventCode: "BotKill",
      category: "bot_kill",
      markerKey: "bot_kill",
      otherParty: "unknown",
      isPerformedByBot: true,
      position: { worldX: 51, worldZ: 61 },
      timestampSeconds: 1020,
      isSameTickRepeat: false,
    });
  });

  it("uses player rules for a misidentified human", () => {
    const misidTrack = buildTrack("player-misid", "human_misid", [
      { eventCode: "Position", timestampSeconds: 2000, worldX: 1, worldZ: 2 },
      { eventCode: "KilledByStorm", timestampSeconds: 2010, worldX: 3, worldZ: 4 },
      { eventCode: "Loot", timestampSeconds: 2011, worldX: 3, worldZ: 4 },
    ]);
    const mapEvents = deriveEvents([misidTrack], matchId, eventConfig);
    expect(
      mapEvents.map((mapEvent) => [
        mapEvent.markerKey,
        mapEvent.actorType,
        mapEvent.isPerformedByBot,
      ]),
    ).toEqual([
      ["storm_death", "human_misid", false],
      ["loot", "human_misid", false],
    ]);
  });

  it("keeps same-tick repeated rows as separate events", () => {
    const repeatTrack = buildTrack("player-repeat", "human", [
      { eventCode: "BotKill", timestampSeconds: 3000, worldX: 5, worldZ: 5 },
      {
        eventCode: "BotKill",
        timestampSeconds: 3000,
        worldX: 5,
        worldZ: 5,
        isSameTickRepeat: true,
      },
    ]);
    const mapEvents = deriveEvents([repeatTrack], matchId, eventConfig);
    expect(mapEvents.map((mapEvent) => mapEvent.isSameTickRepeat)).toEqual([false, true]);
  });

  it("returns no events for tracks with only positions or no rows", () => {
    const positionOnlyTrack = buildTrack("player-quiet", "human", [
      { eventCode: "Position", timestampSeconds: 4000, worldX: 0, worldZ: 0 },
    ]);
    const emptyBotTrack = buildTrack("bot-empty", "bot", []);
    expect(deriveEvents([positionOnlyTrack, emptyBotTrack], matchId, eventConfig)).toEqual([]);
  });

  it("throws, naming the code, match and actor, on an event code missing from the config", () => {
    const unknownCodeTrack = buildTrack("player-x", "human", [
      { eventCode: "Extracted", timestampSeconds: 5000, worldX: 0, worldZ: 0 },
    ]);
    expect(() => deriveEvents([unknownCodeTrack], matchId, eventConfig)).toThrow(DataContractError);
    expect(() => deriveEvents([unknownCodeTrack], matchId, eventConfig)).toThrow(
      `Match "${matchId}", actor "player-x": event code "Extracted" has no rule in the player section of eventConfig`,
    );
  });

  it("throws when a bot row has a code that only player rules define", () => {
    const botWithLootTrack = buildTrack("bot-looter", "bot", [
      { eventCode: "Loot", timestampSeconds: 5100, worldX: 0, worldZ: 0 },
    ]);
    expect(() => deriveEvents([botWithLootTrack], matchId, eventConfig)).toThrow(
      'event code "Loot" has no rule in the bot section of eventConfig',
    );
  });

  it("does not treat object built-ins such as toString as rules", () => {
    const builtInCodeTrack = buildTrack("player-y", "human", [
      { eventCode: "toString", timestampSeconds: 5200, worldX: 0, worldZ: 0 },
    ]);
    expect(() => deriveEvents([builtInCodeTrack], matchId, eventConfig)).toThrow(
      'event code "toString" has no rule',
    );
  });

  it("throws when a non-position rule has no marker", () => {
    const configWithoutLootMarker: EventConfig = {
      ...eventConfig,
      player: {
        ...eventConfig.player,
        Loot: { category: "loot", otherParty: "none", marker: null },
      },
    };
    const lootTrack = buildTrack("player-z", "human", [
      { eventCode: "Loot", timestampSeconds: 5300, worldX: 0, worldZ: 0 },
    ]);
    expect(() => deriveEvents([lootTrack], matchId, configWithoutLootMarker)).toThrow(
      'the player rule for event code "Loot" (category "loot") has no marker',
    );
  });

  it("throws when a track's parallel arrays have different lengths", () => {
    const fullTrack = buildTrack("player-short", "human", [
      { eventCode: "Loot", timestampSeconds: 5400, worldX: 0, worldZ: 0 },
      { eventCode: "Loot", timestampSeconds: 5401, worldX: 1, worldZ: 1 },
    ]);
    const shortTrack: ActorTrack = { ...fullTrack, worldZ: [0] };
    expect(() => deriveEvents([shortTrack], matchId, eventConfig)).toThrow(
      `Match "${matchId}", actor "player-short": row 1 is missing a value`,
    );
  });
});

describe("playerSideEvents and botSideEvents", () => {
  it("split events by who performed them, keeping order", () => {
    const mapEvents = deriveEvents(multiplayerTracks, matchId, eventConfig);
    expect(playerSideEvents(mapEvents).map((mapEvent) => mapEvent.markerKey)).toEqual([
      "kill_player",
      "kill_bot",
      "death_by_player",
    ]);
    expect(botSideEvents(mapEvents).map((mapEvent) => mapEvent.markerKey)).toEqual([
      "bot_kill",
      "bot_death",
    ]);
  });

  it("return empty lists for no events", () => {
    expect(playerSideEvents([])).toEqual([]);
    expect(botSideEvents([])).toEqual([]);
  });
});
