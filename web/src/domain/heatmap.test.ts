import { describe, expect, it } from "vitest";
import { DataContractError } from "./contract";
import type { MapEvent } from "./events";
import { addToCell, cellIndexFor, countEvents, createHeatGrid, eventsForHeatmap } from "./heatmap";
import type { MapConfig, WorldPoint } from "./types";

const ambroseValleyMap: MapConfig = {
  mapId: "AmbroseValley",
  imageUrl: "data/minimaps/AmbroseValley.jpg",
  imageWidthPixels: 4096,
  imageHeightPixels: 4096,
  worldScale: 900,
  worldOriginX: -370,
  worldOriginZ: -473,
};

const grandRiftMap: MapConfig = {
  mapId: "GrandRift",
  imageUrl: "data/minimaps/GrandRift.jpg",
  imageWidthPixels: 2160,
  imageHeightPixels: 2158,
  worldScale: 581,
  worldOriginX: -290,
  worldOriginZ: -290,
};

interface EventSpec {
  readonly category: string;
  readonly markerKey: string;
  readonly isPerformedByBot: boolean;
  readonly position: WorldPoint;
}

function buildEvent(spec: EventSpec): MapEvent {
  return {
    matchId: "match-1",
    actorKey: spec.isPerformedByBot ? "bot-1" : "player-1",
    actorType: spec.isPerformedByBot ? "bot" : "human",
    eventCode: spec.markerKey,
    category: spec.category,
    markerKey: spec.markerKey,
    otherParty: "bot",
    isPerformedByBot: spec.isPerformedByBot,
    position: spec.position,
    timestampSeconds: 1000,
    isSameTickRepeat: false,
  };
}

const origin: WorldPoint = { worldX: -370, worldZ: -473 };
const playerKill = buildEvent({
  category: "kill",
  markerKey: "kill_bot",
  isPerformedByBot: false,
  position: { worldX: -369, worldZ: -472 },
});
const playerCombatDeath = buildEvent({
  category: "combat_death",
  markerKey: "death_by_bot",
  isPerformedByBot: false,
  position: origin,
});
const playerStormDeath = buildEvent({
  category: "storm_death",
  markerKey: "storm_death",
  isPerformedByBot: false,
  position: origin,
});
const botKill = buildEvent({
  category: "bot_kill",
  markerKey: "bot_kill",
  isPerformedByBot: true,
  position: origin,
});
const botDeath = buildEvent({
  category: "bot_death",
  markerKey: "bot_death",
  isPerformedByBot: true,
  position: origin,
});
// Defensive: a bot-performed row labelled "kill" must still stay out of every heatmap.
const botPerformedKill = buildEvent({
  category: "kill",
  markerKey: "bot_kill",
  isPerformedByBot: true,
  position: origin,
});

describe("createHeatGrid", () => {
  it("uses ceil(worldScale / cellWorldSize) cells per side, all zero", () => {
    const ambroseValleyGrid = createHeatGrid(ambroseValleyMap);
    expect(ambroseValleyGrid.cellWorldSize).toBe(4);
    expect(ambroseValleyGrid.columnCount).toBe(225);
    expect(ambroseValleyGrid.rowCount).toBe(225);
    expect(ambroseValleyGrid.worldOriginX).toBe(-370);
    expect(ambroseValleyGrid.worldOriginZ).toBe(-473);
    expect(ambroseValleyGrid.values.length).toBe(225 * 225);
    expect(ambroseValleyGrid.values.every((cellValue) => cellValue === 0)).toBe(true);

    const grandRiftGrid = createHeatGrid(grandRiftMap);
    expect(grandRiftGrid.columnCount).toBe(146);
    expect(grandRiftGrid.rowCount).toBe(146);
  });

  it("rejects a cell size that is not a positive number", () => {
    expect(() => createHeatGrid(ambroseValleyMap, 0)).toThrow(/cell size/);
    expect(() => createHeatGrid(ambroseValleyMap, Number.NaN)).toThrow(/cell size/);
  });
});

describe("cellIndexFor", () => {
  const grid = createHeatGrid(ambroseValleyMap);

  it("puts the origin in cell 0 and indexes rows by worldZ", () => {
    expect(cellIndexFor(grid, origin)).toBe(0);
    expect(cellIndexFor(grid, { worldX: -370 + 4, worldZ: -473 })).toBe(1);
    expect(cellIndexFor(grid, { worldX: -370, worldZ: -473 + 4 })).toBe(225);
    expect(cellIndexFor(grid, { worldX: -370 + 9, worldZ: -473 + 13 })).toBe(3 * 225 + 2);
  });

  it("counts the upper edge (u = 1 or v = 1) in the last column and row", () => {
    expect(cellIndexFor(grid, { worldX: -370 + 900, worldZ: -473 })).toBe(224);
    expect(cellIndexFor(grid, { worldX: -370, worldZ: -473 + 900 })).toBe(224 * 225);
    expect(cellIndexFor(grid, { worldX: -370 + 900, worldZ: -473 + 900 })).toBe(225 * 225 - 1);
  });

  it("uses the partial last cell on GrandRift (581 is not a multiple of 4)", () => {
    const grandRiftGrid = createHeatGrid(grandRiftMap);
    expect(cellIndexFor(grandRiftGrid, { worldX: -290 + 581, worldZ: -290 })).toBe(145);
  });

  it("returns null on GrandRift between worldScale (581) and the grid's last line (584)", () => {
    const grandRiftGrid = createHeatGrid(grandRiftMap);
    expect(cellIndexFor(grandRiftGrid, { worldX: -290 + 582, worldZ: -290 })).toBeNull();
    expect(cellIndexFor(grandRiftGrid, { worldX: -290, worldZ: -290 + 584 })).toBeNull();
  });

  it("returns null outside [origin, origin + worldScale]", () => {
    expect(cellIndexFor(grid, { worldX: -370 + 900.001, worldZ: -473 })).toBeNull();
    expect(cellIndexFor(grid, { worldX: -370.001, worldZ: -473 })).toBeNull();
    expect(cellIndexFor(grid, { worldX: -370, worldZ: -473 - 0.001 })).toBeNull();
    expect(cellIndexFor(grid, { worldX: Number.NaN, worldZ: -473 })).toBeNull();
  });
});

describe("addToCell", () => {
  it("adds to one cell and throws for an index past the grid", () => {
    const grid = createHeatGrid(ambroseValleyMap);
    addToCell(grid, 3, 2.5);
    addToCell(grid, 3, 1);
    expect(grid.values[3]).toBe(3.5);
    expect(() => addToCell(grid, 225 * 225, 1)).toThrow(/no cell 50625/);
  });
});

describe("countEvents", () => {
  it("counts 2 kills in the same cell as 2", () => {
    const secondKillSameCell = buildEvent({
      category: "kill",
      markerKey: "kill_player",
      isPerformedByBot: false,
      position: { worldX: -367, worldZ: -470 },
    });
    const countedGrid = countEvents(createHeatGrid(ambroseValleyMap), [
      playerKill,
      secondKillSameCell,
    ]);
    expect(countedGrid.values[0]).toBe(2);
    expect(countedGrid.values.reduce((total, cellValue) => total + cellValue, 0)).toBe(2);
  });

  it("counts a point at worldX = -370 + 900 in the last column", () => {
    const edgeKill = buildEvent({
      category: "kill",
      markerKey: "kill_bot",
      isPerformedByBot: false,
      position: { worldX: -370 + 900, worldZ: -473 },
    });
    const countedGrid = countEvents(createHeatGrid(ambroseValleyMap), [edgeKill]);
    expect(countedGrid.values[224]).toBe(1);
  });

  it("throws a DataContractError naming the point when an event is beyond the grid", () => {
    const outsideKill = buildEvent({
      category: "kill",
      markerKey: "kill_bot",
      isPerformedByBot: false,
      position: { worldX: 531, worldZ: -473 },
    });
    const countOutside = () => countEvents(createHeatGrid(ambroseValleyMap), [outsideKill]);
    expect(countOutside).toThrow(DataContractError);
    expect(countOutside).toThrow(/531/);
  });

  it("leaves the input grid unchanged", () => {
    const emptyGrid = createHeatGrid(ambroseValleyMap);
    countEvents(emptyGrid, [playerKill]);
    expect(emptyGrid.values[0]).toBe(0);
  });
});

describe("eventsForHeatmap", () => {
  const allEvents = [
    playerKill,
    playerCombatDeath,
    playerStormDeath,
    botKill,
    botDeath,
    botPerformedKill,
  ];

  it("selects player-side kills, combat deaths and storm deaths separately", () => {
    expect(eventsForHeatmap("kills", allEvents)).toEqual([playerKill]);
    expect(eventsForHeatmap("combatDeaths", allEvents)).toEqual([playerCombatDeath]);
    expect(eventsForHeatmap("stormDeaths", allEvents)).toEqual([playerStormDeath]);
  });

  it("keeps storm deaths out of the combat deaths set", () => {
    expect(eventsForHeatmap("combatDeaths", allEvents)).not.toContain(playerStormDeath);
  });

  it("never returns events performed by a bot", () => {
    for (const heatmapKind of ["kills", "combatDeaths", "stormDeaths"] as const) {
      const selectedEvents = eventsForHeatmap(heatmapKind, allEvents);
      expect(selectedEvents.filter((mapEvent) => mapEvent.isPerformedByBot)).toEqual([]);
    }
  });

  it("returns an empty list for an empty event list", () => {
    expect(eventsForHeatmap("kills", [])).toEqual([]);
  });
});
