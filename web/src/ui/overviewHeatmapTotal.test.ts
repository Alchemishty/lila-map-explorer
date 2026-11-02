import { describe, expect, it } from "vitest";
import type { HeatmapKind } from "../domain/heatmap";
import { heatmapColorTop } from "../domain/heatmapColorTop";
import { heatGridTotal } from "../domain/heatmapSmoothing";
import { buildOverviewModel } from "./overviewModel";
import { fixtureDayFiles, fixtureManifest } from "./overviewTestFixtures";
import { createInitialAppState, type AppState } from "./stateTransitions";

// The colour scale's sample size: the exact grid's total. And the
// colour top the smoothed grid is drawn against (domain/heatmapColorTop.ts).

function stateWithHeatmap(heatmapKind: HeatmapKind | null, dayUtcList?: string[]): AppState {
  const initialState = createInitialAppState(fixtureManifest);
  return {
    ...initialState,
    filter:
      dayUtcList === undefined
        ? initialState.filter
        : { ...initialState.filter, dayUtcSet: new Set(dayUtcList) },
    overview: { ...initialState.overview, heatmapKind },
  };
}

function modelFor(state: AppState) {
  return buildOverviewModel(state, fixtureManifest, fixtureDayFiles);
}

describe("OverviewModel.heatmapTotal", () => {
  it("is null when the heatmap is off", () => {
    expect(modelFor(stateWithHeatmap(null)).heatmapTotal).toBeNull();
  });

  it("is the exact event count for an event heatmap, never the smoothed total", () => {
    const model = modelFor(stateWithHeatmap("stormDeaths"));
    if (model.heatGrid === null) {
      throw new Error("The storm-death heatmap was not built");
    }
    expect(model.heatmapTotal).toBe(2);
    expect(model.heatmapTotal).toBe(heatGridTotal(model.heatGrid));
  });

  it("is the credited traffic seconds for traffic", () => {
    const model = modelFor(stateWithHeatmap("traffic"));
    if (model.heatGrid === null) {
      throw new Error("The traffic heatmap was not built");
    }
    expect(model.heatmapTotal).toBe(heatGridTotal(model.heatGrid));
    expect(model.heatmapTotal).toBeGreaterThan(0);
  });

  it("is 0 when the heatmap is on and no match is selected", () => {
    const model = modelFor(stateWithHeatmap("kills", []));
    expect(model.selectedMatches).toEqual([]);
    expect(model.heatmapTotal).toBe(0);
  });
});

describe("OverviewModel.heatmapColorTop", () => {
  it("is null when the heatmap is off", () => {
    expect(modelFor(stateWithHeatmap(null)).heatmapColorTop).toBeNull();
  });

  it("raises a sparse event heatmap's colour top to the minimum, from the smoothed grid", () => {
    const model = modelFor(stateWithHeatmap("stormDeaths"));
    if (model.smoothedHeatGrid === null) {
      throw new Error("The storm-death heatmap was not smoothed");
    }
    expect(model.heatmapColorTop).toEqual(heatmapColorTop(model.smoothedHeatGrid, "stormDeaths"));
    expect(model.heatmapColorTop?.isRaisedToMinimum).toBe(true);
  });

  it("leaves Traffic's colour top at its busiest cell", () => {
    expect(modelFor(stateWithHeatmap("traffic")).heatmapColorTop?.isRaisedToMinimum).toBe(false);
  });
});
