import { describe, expect, it } from "vitest";
import type { WorldRect } from "../domain/types";
import { playerMarkerKeys } from "./markerVisibility";
import { buildOverviewModel, createOverviewModelBuilder } from "./overviewModel";
import { fixtureDayFiles, fixtureEventConfig, fixtureManifest } from "./overviewTestFixtures";
import { createInitialAppState, type AppState } from "./stateTransitions";

// Per-type marker switches in the Overview: the switches
// choose what is drawn; the inspector counts every player-side type whatever they say.

const wholeMapArea: WorldRect = {
  minWorldX: -500,
  maxWorldX: 500,
  minWorldZ: -500,
  maxWorldZ: 500,
};
const allPlayerKeys = playerMarkerKeys(fixtureEventConfig);

function stateWithMarkers(visibleMarkerKeys: readonly string[]): AppState {
  const initialState = createInitialAppState(fixtureManifest);
  return {
    ...initialState,
    overview: {
      ...initialState.overview,
      heatmapKind: "kills",
      visibleMarkerKeys: new Set(visibleMarkerKeys),
      selectedArea: wholeMapArea,
    },
  };
}

function modelFor(state: AppState) {
  return buildOverviewModel(state, fixtureManifest, fixtureDayFiles);
}

function requireAreaCounts(state: AppState): Record<string, number> {
  const areaSummary = modelFor(state).areaSummary;
  if (areaSummary === null) {
    throw new Error("The whole-map area has no summary");
  }
  return areaSummary.countsByMarker;
}

describe("Overview marker switches", () => {
  it("draws no loot with loot hidden, while the inspector's loot count stays the same", () => {
    const allShownState = stateWithMarkers(allPlayerKeys);
    const lootHiddenState = stateWithMarkers(allPlayerKeys.filter((key) => key !== "loot"));
    expect(modelFor(allShownState).markers.some((event) => event.markerKey === "loot")).toBe(true);
    expect(modelFor(lootHiddenState).markers.some((event) => event.markerKey === "loot")).toBe(
      false,
    );
    expect(requireAreaCounts(lootHiddenState).loot).toBe(requireAreaCounts(allShownState).loot);
    expect(requireAreaCounts(allShownState).loot).toBeGreaterThan(0);
  });

  it("draws nothing with every type hidden, and the player counts stay (Review Focus 4)", () => {
    const allHiddenState = stateWithMarkers([]);
    expect(modelFor(allHiddenState).markers).toEqual([]);
    expect(requireAreaCounts(allHiddenState)).toEqual(
      requireAreaCounts(stateWithMarkers(allPlayerKeys)),
    );
  });

  it("counts a bot-event type in the area only while it is switched on", () => {
    expect(requireAreaCounts(stateWithMarkers(allPlayerKeys)).bot_kill).toBeUndefined();
    const botKillCounts = requireAreaCounts(stateWithMarkers([...allPlayerKeys, "bot_kill"]));
    expect(botKillCounts.bot_kill).toBeGreaterThan(0);
    expect(botKillCounts.bot_death).toBeUndefined();
  });

  it("draws bot events only for the bot types switched on", () => {
    const markers = modelFor(stateWithMarkers(["bot_kill"])).markers;
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((event) => event.markerKey === "bot_kill")).toBe(true);
  });

  it("keeps the heat grids when only a switch changes", () => {
    const buildCachedModel = createOverviewModelBuilder();
    const firstState = stateWithMarkers(allPlayerKeys);
    const firstModel = buildCachedModel(firstState, fixtureManifest, fixtureDayFiles);
    const toggledState: AppState = {
      ...firstState,
      overview: { ...firstState.overview, visibleMarkerKeys: new Set(["storm_death"]) },
    };
    const toggledModel = buildCachedModel(toggledState, fixtureManifest, fixtureDayFiles);
    expect(toggledModel.markers.every((event) => event.markerKey === "storm_death")).toBe(true);
    expect(firstModel.smoothedHeatGrid).not.toBeNull();
    expect(toggledModel.smoothedHeatGrid).toBe(firstModel.smoothedHeatGrid);
    expect(toggledModel.heatGrid).toBe(firstModel.heatGrid);
  });

  it("throws for a marker key the config does not know", () => {
    expect(() => modelFor(stateWithMarkers(["loot", "nope"]))).toThrow('Marker "nope"');
  });
});
