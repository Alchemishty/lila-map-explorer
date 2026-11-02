import { describe, expect, it } from "vitest";
import type { MapEvent } from "./events";
import { selectEventsAtWorldPosition } from "./eventStacks";
import type { WorldPoint } from "./types";

// Markers stacked on one spot: Replay lists every event at the tapped marker's exact position.

function buildEvent(actorKey: string, position: WorldPoint, timestampSeconds: number): MapEvent {
  return {
    matchId: "match-1",
    actorKey,
    actorType: "human",
    eventCode: "Loot",
    category: "loot",
    markerKey: "loot",
    otherParty: "none",
    isPerformedByBot: false,
    position,
    timestampSeconds,
    isSameTickRepeat: false,
  };
}

const stackSpot: WorldPoint = { worldX: 12.25, worldZ: -40.5 };

describe("selectEventsAtWorldPosition", () => {
  it("keeps only events at exactly that world position, in time order", () => {
    const lateEvent = buildEvent("player-a", stackSpot, 1_770_000_030);
    const earlyEvent = buildEvent("player-b", stackSpot, 1_770_000_005);
    const nearbyEvent = buildEvent("player-c", { worldX: 12.250001, worldZ: -40.5 }, 1_770_000_001);
    const sameXOtherZEvent = buildEvent("player-d", { worldX: 12.25, worldZ: -40 }, 1_770_000_002);
    expect(
      selectEventsAtWorldPosition(
        [lateEvent, nearbyEvent, earlyEvent, sameXOtherZEvent],
        stackSpot,
      ),
    ).toEqual([earlyEvent, lateEvent]);
  });

  it("keeps the given order for events in the same second", () => {
    const firstEvent = buildEvent("player-a", stackSpot, 1_770_000_010);
    const secondEvent = buildEvent("player-b", stackSpot, 1_770_000_010);
    const thirdEvent = buildEvent("player-c", stackSpot, 1_770_000_010);
    expect(selectEventsAtWorldPosition([firstEvent, secondEvent, thirdEvent], stackSpot)).toEqual([
      firstEvent,
      secondEvent,
      thirdEvent,
    ]);
  });

  it("gives an empty list when no event is at that position", () => {
    expect(
      selectEventsAtWorldPosition([buildEvent("player-a", { worldX: 0, worldZ: 0 }, 1)], stackSpot),
    ).toEqual([]);
  });
});
