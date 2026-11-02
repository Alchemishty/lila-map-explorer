// Test-only fixtures shared by the traffic test files.
import { accumulateTrafficSeconds } from "./traffic";
import { cellIndexFor, createHeatGrid, type HeatGrid } from "./heatmap";
import type { ActorTrack, ActorType, EventConfig, MapConfig, MarkerStyle } from "./types";

export const lockdownMap: MapConfig = {
  mapId: "Lockdown",
  imageUrl: "data/minimaps/Lockdown.jpg",
  imageWidthPixels: 4096,
  imageHeightPixels: 4096,
  worldScale: 1000,
  worldOriginX: -500,
  worldOriginZ: -500,
};

const placeholderMarkerStyle: MarkerStyle = {
  label: "test marker",
  shape: "circle",
  fill: "#ef4444",
  cross: "",
  outline: "solid",
};

// The rules mirror config/event_types.json (marker styles do not matter to traffic).
export const eventConfig: EventConfig = {
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

/** [eventCode, timestampSeconds, worldX, worldZ] */
export type TrackRowFixture = readonly [string, number, number, number];

export function buildTrack(
  actorKey: string,
  actorType: ActorType,
  rows: readonly TrackRowFixture[],
): ActorTrack {
  return {
    actorKey,
    userId: actorKey,
    actorType,
    isPlayer: actorType !== "bot",
    eventCodes: rows.map((row) => row[0]),
    timestampSeconds: rows.map((row) => row[1]),
    worldX: rows.map((row) => row[2]),
    worldZ: rows.map((row) => row[3]),
    isSameTickRepeat: rows.map(() => false),
  };
}

export function cellValueAt(grid: HeatGrid, worldX: number, worldZ: number): number {
  const cellIndex = cellIndexFor(grid, { worldX, worldZ });
  if (cellIndex === null) {
    throw new Error(`test point (${worldX}, ${worldZ}) is outside the grid`);
  }
  const cellValue = grid.values[cellIndex];
  if (cellValue === undefined) {
    throw new Error(`cell ${cellIndex} does not exist`);
  }
  return cellValue;
}

export function totalSeconds(grid: HeatGrid): number {
  return grid.values.reduce((total, cellValue) => total + cellValue, 0);
}

export function trafficFor(tracks: readonly ActorTrack[]): HeatGrid {
  return accumulateTrafficSeconds(createHeatGrid(lockdownMap), tracks, eventConfig);
}
