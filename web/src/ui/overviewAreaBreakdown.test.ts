import { describe, expect, it } from "vitest";
import type { WorldRect } from "../domain/types";
import { buildOverviewModel } from "./overviewModel";
import { fixtureDayFiles, fixtureManifest } from "./overviewTestFixtures";
import { createInitialAppState } from "./stateTransitions";

// Each "Replay a match here" row's events per marker type use the same event set as the
// inspector's totals: every player type, plus bot types only while switched on.

/** The whole Lockdown minimap (origin -500, scale 1000), so every fixture event is inside. */
const wholeMapArea: WorldRect = {
  minWorldX: -500,
  maxWorldX: 500,
  minWorldZ: -500,
  maxWorldZ: 500,
};

describe("buildOverviewModel per-match marker counts", () => {
  it("leaves a switched-off bot type out of every match, and the rows add up to the totals", () => {
    const initialState = createInitialAppState(fixtureManifest);
    const model = buildOverviewModel(
      {
        ...initialState,
        overview: {
          ...initialState.overview,
          selectedArea: wholeMapArea,
          // Player types hidden, "bot_kill" on, "bot_death" off.
          visibleMarkerKeys: new Set(["bot_kill"]),
        },
      },
      fixtureManifest,
      fixtureDayFiles,
    );
    expect(model.areaSummary?.matchesToReplay).toEqual([
      {
        matchId: "early",
        eventCountInArea: 3,
        countsByMarker: { loot: 1, storm_death: 1, bot_kill: 1 },
      },
      { matchId: "late", eventCountInArea: 2, countsByMarker: { kill_bot: 1, death_by_bot: 1 } },
      // bot-2's BotKilled in "last" is a bot_death event, which is switched off.
      { matchId: "last", eventCountInArea: 1, countsByMarker: { storm_death: 1 } },
    ]);
    expect(model.areaSummary?.countsByMarker).toEqual({
      loot: 1,
      storm_death: 2,
      bot_kill: 1,
      kill_bot: 1,
      death_by_bot: 1,
    });
  });
});
