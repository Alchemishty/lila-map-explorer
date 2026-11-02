import { describe, expect, it } from "vitest";
import type { TrailHeadState } from "../domain/trailHeadState";
import type { WorldPoint } from "../domain/types";
import type { TrailStyle } from "./drawTrails";
import {
  callsNamed,
  createRecordingContext,
  type RecordingContext,
} from "./recordingContextTestFixtures";
import { createScene, emptySceneLayers, type SceneTrail } from "./scene";
import { createFakeMapView } from "./sceneTestFixtures";

// The scene hands each trail head's state to the real trail drawing (telemetry audit issue 9).

const trailStyle: TrailStyle = {
  color: "#22d3ee",
  isDashed: false,
  isHighlighted: false,
  isDimmed: false,
  headShape: "round",
};

function buildTrail(headPosition: WorldPoint | null, headState: TrailHeadState | null): SceneTrail {
  return { actorKey: "player-x", points: [], headPosition, headState, style: trailStyle };
}

/** Draws one trail through a real scene onto a recording context, and returns that context. */
function drawOneTrail(trail: SceneTrail): RecordingContext {
  const recordingContext = createRecordingContext();
  const overlay = {
    context: recordingContext,
    clear: () => ({ leftCanvasX: 0, topCanvasY: 0, rightCanvasX: 200, bottomCanvasY: 200 }),
  };
  createScene(createFakeMapView(), overlay).setLayers({ ...emptySceneLayers, trails: [trail] });
  return recordingContext;
}

describe("createScene trail heads", () => {
  it("draws a moving head filled and a last-seen head hollow at the head's canvas point", () => {
    const movingContext = drawOneTrail(buildTrail({ worldX: 3, worldZ: -4 }, "moving"));
    expect(callsNamed(movingContext, "fill")).toHaveLength(1);
    expect(callsNamed(movingContext, "arc")[0]?.argumentValues.slice(0, 2)).toEqual([6, 8]);
    const lastSeenContext = drawOneTrail(buildTrail({ worldX: 3, worldZ: -4 }, "last_seen"));
    expect(callsNamed(lastSeenContext, "fill")).toHaveLength(0);
    expect(callsNamed(lastSeenContext, "arc")[0]?.argumentValues.slice(0, 2)).toEqual([6, 8]);
  });

  it("draws no head when there is neither a head position nor a state", () => {
    const context = drawOneTrail(buildTrail(null, null));
    expect(callsNamed(context, "arc")).toHaveLength(0);
  });

  it("throws naming the actor when a trail has a head position without a state, or the reverse", () => {
    expect(() => drawOneTrail(buildTrail({ worldX: 1, worldZ: -1 }, null))).toThrowError(
      /Trail of actor "player-x" has a head position or a head state but not both/,
    );
    expect(() => drawOneTrail(buildTrail(null, "dead"))).toThrowError(/player-x/);
  });
});
