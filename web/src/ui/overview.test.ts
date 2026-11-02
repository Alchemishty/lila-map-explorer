import { describe, expect, it } from "vitest";
import { cellIndexFor, type HeatmapKind } from "../domain/heatmap";
import type { WorldRect } from "../domain/types";
import { buildOverviewModel, createOverviewModelBuilder } from "./overviewModel";
import { fixtureDayFiles, fixtureManifest, sumHeatGrid } from "./overviewTestFixtures";
import type { AppState, OverviewState } from "./stateTransitions";

const bothDays = ["2026-02-10", "2026-02-11"];
const playerKeys: ReadonlySet<string> = new Set([
  "kill_player",
  "kill_bot",
  "death_by_player",
  "death_by_bot",
  "storm_death",
  "loot",
]);
const allKeys: ReadonlySet<string> = new Set([
  "kill_player",
  "kill_bot",
  "death_by_player",
  "death_by_bot",
  "storm_death",
  "loot",
  "bot_kill",
  "bot_death",
]);

function buildState(
  overview: Partial<OverviewState>,
  dayUtcList: readonly string[] = bothDays,
  matchIdList: readonly string[] | null = null,
): AppState {
  return {
    appMode: "overview",
    filter: {
      mapId: "Lockdown",
      dayUtcSet: new Set(dayUtcList),
      matchIdSet: matchIdList === null ? null : new Set(matchIdList),
    },
    overview: {
      heatmapKind: "traffic",
      visibleMarkerKeys: playerKeys,
      selectedArea: null,
      ...overview,
    },
    replay: {
      matchId: null,
      followedActorKey: null,
      shouldHideBots: false,
      visibleMarkerKeys: allKeys,
      playback: null,
      inspectedMarkerEvents: [],
    },
  };
}

function requireHeatGridTotal(heatmapKind: HeatmapKind, dayUtcList = bothDays): number {
  const model = buildOverviewModel(
    buildState({ heatmapKind }, dayUtcList),
    fixtureManifest,
    fixtureDayFiles,
  );
  if (model.heatGrid === null) {
    throw new Error(`The ${heatmapKind} heatmap was not built`);
  }
  return sumHeatGrid(model.heatGrid);
}

const centerArea: WorldRect = { minWorldX: -10, maxWorldX: 10, minWorldZ: -10, maxWorldZ: 10 };
const lateDeathArea: WorldRect = { minWorldX: 295, maxWorldX: 305, minWorldZ: 305, maxWorldZ: 325 };
const botKillArea: WorldRect = { minWorldX: 205, maxWorldX: 215, minWorldZ: 195, maxWorldZ: 205 };

describe("buildOverviewModel with no matches (Review Focus 1)", () => {
  it("gives the no-matches message, no heatmap, no markers and no area summary", () => {
    const model = buildOverviewModel(
      buildState(
        { heatmapKind: "stormDeaths", visibleMarkerKeys: allKeys, selectedArea: centerArea },
        [],
      ),
      fixtureManifest,
      [],
    );
    expect(model.emptyMessage).toBe("No matches for these filters");
    expect(model.selectedMatches).toEqual([]);
    expect(model.heatGrid).toBeNull();
    expect(model.markers).toEqual([]);
    expect(model.botDataMatchCount).toBe(0);
    expect(model.areaSummary).toBeNull();
  });

  it("has no empty message when matches are selected", () => {
    const model = buildOverviewModel(buildState({}), fixtureManifest, fixtureDayFiles);
    expect(model.emptyMessage).toBeNull();
    expect(model.selectedMatches.map((match) => match.matchId)).toEqual(["early", "late", "last"]);
  });
});

describe("buildOverviewModel markers", () => {
  it("shows only player-side events while the bot-event types are off", () => {
    const model = buildOverviewModel(buildState({}), fixtureManifest, fixtureDayFiles);
    expect(model.markers.some((mapEvent) => mapEvent.isPerformedByBot)).toBe(false);
    expect(model.markers.map((mapEvent) => mapEvent.markerKey).sort()).toEqual([
      "death_by_bot",
      "kill_bot",
      "loot",
      "storm_death",
      "storm_death",
    ]);
  });

  it("adds the bot-side events when the bot-event types are on", () => {
    const model = buildOverviewModel(
      buildState({ visibleMarkerKeys: allKeys }),
      fixtureManifest,
      fixtureDayFiles,
    );
    const botMarkerKeys = model.markers
      .filter((mapEvent) => mapEvent.isPerformedByBot)
      .map((mapEvent) => mapEvent.markerKey)
      .sort();
    expect(botMarkerKeys).toEqual(["bot_death", "bot_kill"]);
    expect(model.markers).toHaveLength(7);
  });

  it("keeps the markers when the heatmap is off, and uses only the chosen match subset", () => {
    const model = buildOverviewModel(
      buildState({ heatmapKind: null }, bothDays, ["late"]),
      fixtureManifest,
      fixtureDayFiles,
    );
    expect(model.heatGrid).toBeNull();
    expect(model.selectedMatches.map((match) => match.matchId)).toEqual(["late"]);
    expect(model.markers.map((mapEvent) => mapEvent.matchId)).toEqual(["late", "late"]);
  });
});

describe("buildOverviewModel heatmaps", () => {
  it("storm deaths: the grid total equals the storm deaths in the selection", () => {
    expect(requireHeatGridTotal("stormDeaths")).toBe(2);
    expect(requireHeatGridTotal("stormDeaths", ["2026-02-10"])).toBe(1);
  });

  it("puts the storm death in the cell holding its position", () => {
    const model = buildOverviewModel(
      buildState({ heatmapKind: "stormDeaths" }, ["2026-02-10"]),
      fixtureManifest,
      fixtureDayFiles,
    );
    if (model.heatGrid === null) {
      throw new Error("The storm-death heatmap was not built");
    }
    const deathCellIndex = cellIndexFor(model.heatGrid, { worldX: 100, worldZ: 0 });
    if (deathCellIndex === null) {
      throw new Error("The storm death is off the grid");
    }
    expect(model.heatGrid.values[deathCellIndex]).toBe(1);
    expect(model.heatGrid.cellWorldSize).toBe(4);
  });

  it("kills and combat deaths count player-side events only", () => {
    expect(requireHeatGridTotal("kills")).toBe(1);
    expect(requireHeatGridTotal("combatDeaths")).toBe(1);
  });

  it("traffic sums the seconds between player position samples, never bots", () => {
    // a: 20 s + 10 s still until its storm death at the last sample; b: 0 s; c: 30 s + 5 s.
    expect(requireHeatGridTotal("traffic")).toBeCloseTo(65, 9);
  });
});

describe("buildOverviewModel bot data count", () => {
  it("counts the selected matches with botCount > 0", () => {
    const allDaysModel = buildOverviewModel(buildState({}), fixtureManifest, fixtureDayFiles);
    expect(allDaysModel.botDataMatchCount).toBe(2);
    const lateOnlyModel = buildOverviewModel(
      buildState({}, bothDays, ["late"]),
      fixtureManifest,
      fixtureDayFiles,
    );
    expect(lateOnlyModel.botDataMatchCount).toBe(0);
  });
});

describe("buildOverviewModel area summary", () => {
  it("lists the matches whose player trails cross the area, earliest first", () => {
    const model = buildOverviewModel(
      buildState({ selectedArea: centerArea }),
      fixtureManifest,
      fixtureDayFiles,
    );
    expect(model.areaSummary).toEqual({
      countsByMarker: {},
      matchIdsPassingThrough: ["early", "last"],
      matchesToReplay: [
        { matchId: "early", eventCountInArea: 0, countsByMarker: {} },
        { matchId: "last", eventCountInArea: 0, countsByMarker: {} },
      ],
    });
  });

  it("counts the visible-marker events inside the area, whatever the heatmap kind", () => {
    for (const heatmapKind of ["kills", "traffic", null] as const) {
      const model = buildOverviewModel(
        buildState({ heatmapKind, selectedArea: lateDeathArea }),
        fixtureManifest,
        fixtureDayFiles,
      );
      const lateCounts = { kill_bot: 1, death_by_bot: 1 };
      expect(model.areaSummary).toEqual({
        countsByMarker: lateCounts,
        matchIdsPassingThrough: ["late"],
        matchesToReplay: [{ matchId: "late", eventCountInArea: 2, countsByMarker: lateCounts }],
      });
    }
  });

  it("counts bot-side events only while their type is on, even with player markers hidden", () => {
    const botEventsOff = buildOverviewModel(
      buildState({ selectedArea: botKillArea, visibleMarkerKeys: new Set() }),
      fixtureManifest,
      fixtureDayFiles,
    );
    expect(botEventsOff.areaSummary?.countsByMarker).toEqual({});
    const botEventsOn = buildOverviewModel(
      buildState({
        selectedArea: botKillArea,
        visibleMarkerKeys: new Set(["bot_kill", "bot_death"]),
      }),
      fixtureManifest,
      fixtureDayFiles,
    );
    expect(botEventsOn.areaSummary?.countsByMarker).toEqual({ bot_kill: 1 });
    expect(botEventsOn.areaSummary?.matchIdsPassingThrough).toEqual([]);
    expect(botEventsOn.areaSummary?.matchesToReplay).toEqual([
      { matchId: "early", eventCountInArea: 1, countsByMarker: { bot_kill: 1 } },
    ]);
  });
});

describe("buildOverviewModel bad input", () => {
  it("throws, naming the match and its day file, when a selected match has no rows loaded", () => {
    expect(() =>
      buildOverviewModel(buildState({}), fixtureManifest, fixtureDayFiles.slice(0, 1)),
    ).toThrow(/Match "late".*days\/Lockdown\/2026-02-11\.json/);
  });

  it("throws when the chosen map has no entry in the manifest", () => {
    const state = buildState({});
    expect(() =>
      buildOverviewModel(
        { ...state, filter: { ...state.filter, mapId: "Nowhere" } },
        {
          ...fixtureManifest,
          matches: fixtureManifest.matches.map((match) => ({ ...match, mapId: "Nowhere" })),
        },
        fixtureDayFiles,
      ),
    ).toThrow('Map "Nowhere" has no entry in manifest.json');
  });
});

describe("createOverviewModelBuilder", () => {
  it("gives the same model as buildOverviewModel", () => {
    const buildCachedModel = createOverviewModelBuilder();
    const state = buildState({ heatmapKind: "kills", selectedArea: lateDeathArea });
    expect(buildCachedModel(state, fixtureManifest, fixtureDayFiles)).toEqual(
      buildOverviewModel(state, fixtureManifest, fixtureDayFiles),
    );
  });

  it("reuses the heatmap and markers when only the selected area changes", () => {
    const buildCachedModel = createOverviewModelBuilder();
    const state = buildState({});
    const firstModel = buildCachedModel(state, fixtureManifest, fixtureDayFiles);
    const areaModel = buildCachedModel(
      { ...state, overview: { ...state.overview, selectedArea: centerArea } },
      fixtureManifest,
      fixtureDayFiles,
    );
    expect(areaModel.heatGrid).toBe(firstModel.heatGrid);
    expect(areaModel.markers).toBe(firstModel.markers);
    expect(areaModel.areaSummary?.matchIdsPassingThrough).toEqual(["early", "last"]);
  });

  it("rebuilds the heatmap when the heatmap kind changes", () => {
    const buildCachedModel = createOverviewModelBuilder();
    const state = buildState({});
    buildCachedModel(state, fixtureManifest, fixtureDayFiles);
    const stormModel = buildCachedModel(
      { ...state, overview: { ...state.overview, heatmapKind: "stormDeaths" } },
      fixtureManifest,
      fixtureDayFiles,
    );
    if (stormModel.heatGrid === null) {
      throw new Error("The storm-death heatmap was not built");
    }
    expect(sumHeatGrid(stormModel.heatGrid)).toBe(2);
  });
});
