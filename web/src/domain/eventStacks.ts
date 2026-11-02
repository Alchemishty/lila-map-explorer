import type { MapEvent } from "./events";
import type { WorldPoint } from "./types";

/**
 * The events recorded at exactly this world position, in time order; events in the same second
 * keep their given order. Only an exact match counts: markers that are merely close apart separate
 * when the map is zoomed in, while markers at one exact spot never do.
 */
export function selectEventsAtWorldPosition(
  events: readonly MapEvent[],
  worldPosition: WorldPoint,
): MapEvent[] {
  return events
    .filter(
      (mapEvent) =>
        mapEvent.position.worldX === worldPosition.worldX &&
        mapEvent.position.worldZ === worldPosition.worldZ,
    )
    .sort((firstEvent, secondEvent) => firstEvent.timestampSeconds - secondEvent.timestampSeconds);
}
