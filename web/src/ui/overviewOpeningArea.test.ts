import { describe, expect, it } from "vitest";
import type { HeatmapKind } from "../domain/heatmap";
import type { WorldRect } from "../domain/types";
import { buildOverviewModel } from "./overviewModel";
import { fixtureDayFiles, fixtureManifest } from "./overviewTestFixtures";
import { createInitialAppState } from "./stateTransitions";

// The app opens with every marker type off (user decision 2026-11-02). Area counts must not follow
// the player switches: every player event in the area still counts, and only the markers are hidden.

/** Holds the late match's bot kill and death by a bot, both player-side events. */
const lateDeathArea: WorldRect = { minWorldX: 295, maxWorldX: 305, minWorldZ: 305, maxWorldZ: 325 };

describe("the opening Overview state", () => {
  it.each<HeatmapKind | null>([null, "kills", "combatDeaths", "stormDeaths", "traffic"])(
    "draws no markers, yet counts every player event with heatmap %s",
    (heatmapKind) => {
      const initialState = createInitialAppState(fixtureManifest);
      expect(initialState.overview.visibleMarkerKeys).toEqual(new Set());
      const model = buildOverviewModel(
        {
          ...initialState,
          overview: { ...initialState.overview, heatmapKind, selectedArea: lateDeathArea },
        },
        fixtureManifest,
        fixtureDayFiles,
      );
      expect(model.markers).toEqual([]);
      const lateCounts = { kill_bot: 1, death_by_bot: 1 };
      expect(model.areaSummary).toEqual({
        countsByMarker: lateCounts,
        matchIdsPassingThrough: ["late"],
        matchesToReplay: [{ matchId: "late", eventCountInArea: 2, countsByMarker: lateCounts }],
      });
    },
  );
});
