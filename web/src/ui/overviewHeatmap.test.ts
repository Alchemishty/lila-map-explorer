import { describe, expect, it } from "vitest";
import type { HeatmapKind } from "../domain/heatmap";
import { heatGridTotal } from "../domain/heatmapSmoothing";
import type { WorldRect } from "../domain/types";
import { buildOverviewModel, createOverviewModelBuilder } from "./overviewModel";
import { fixtureDayFiles, fixtureManifest } from "./overviewTestFixtures";
import { createInitialAppState, type AppState } from "./stateTransitions";

// The Overview draws a smoothed copy of the exact heat grid.

const centerArea: WorldRect = { minWorldX: -10, maxWorldX: 10, minWorldZ: -10, maxWorldZ: 10 };

function stateWithHeatmap(heatmapKind: HeatmapKind | null): AppState {
  const initialState = createInitialAppState(fixtureManifest);
  return { ...initialState, overview: { ...initialState.overview, heatmapKind } };
}

describe("OverviewModel.smoothedHeatGrid", () => {
  it("is null when the heatmap is off", () => {
    const model = buildOverviewModel(stateWithHeatmap(null), fixtureManifest, fixtureDayFiles);
    expect(model.smoothedHeatGrid).toBeNull();
  });

  it("smooths a copy, keeping the exact grid's count exact", () => {
    // The fixture's 2 storm deaths sit far from the grid edges, so smoothing keeps their mass.
    const model = buildOverviewModel(
      stateWithHeatmap("stormDeaths"),
      fixtureManifest,
      fixtureDayFiles,
    );
    if (model.heatGrid === null || model.smoothedHeatGrid === null) {
      throw new Error("The storm-death heatmap was not built");
    }
    expect(heatGridTotal(model.heatGrid)).toBe(2);
    expect(heatGridTotal(model.smoothedHeatGrid)).toBeCloseTo(2, 9);
    expect(model.smoothedHeatGrid.values).not.toBe(model.heatGrid.values);
    expect(Math.max(...model.smoothedHeatGrid.values)).toBeLessThan(1);
  });

  it("is reused when only the selected area changes", () => {
    const buildCachedModel = createOverviewModelBuilder();
    const state = stateWithHeatmap("kills");
    const firstModel = buildCachedModel(state, fixtureManifest, fixtureDayFiles);
    const areaModel = buildCachedModel(
      { ...state, overview: { ...state.overview, selectedArea: centerArea } },
      fixtureManifest,
      fixtureDayFiles,
    );
    expect(firstModel.smoothedHeatGrid).not.toBeNull();
    expect(areaModel.smoothedHeatGrid).toBe(firstModel.smoothedHeatGrid);
  });
});
