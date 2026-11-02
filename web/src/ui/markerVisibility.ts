import type { MapEvent } from "../domain/events";
import type { EventConfig } from "../domain/types";
import { legendEntries } from "./legend";

// Which marker types are shown. Keys come from the event config's
// legend, never from code: 6 player markers and 2 bot-event markers with today's config.

/** The markers the player rules use, in legend order. */
export function playerMarkerKeys(eventConfig: EventConfig): string[] {
  return legendEntries(eventConfig, "player").map((entry) => entry.markerKey);
}

/** The markers only the bot rules use, in legend order. */
export function botOnlyMarkerKeys(eventConfig: EventConfig): string[] {
  const playerKeys = new Set(playerMarkerKeys(eventConfig));
  return legendEntries(eventConfig, "all")
    .map((entry) => entry.markerKey)
    .filter((markerKey) => !playerKeys.has(markerKey));
}

/** Throws, naming the key, if any key is not a legend marker of the config. */
export function requireKnownMarkerKeys(
  markerKeys: ReadonlySet<string>,
  eventConfig: EventConfig,
): void {
  const knownKeys = new Set(legendEntries(eventConfig, "all").map((entry) => entry.markerKey));
  for (const markerKey of markerKeys) {
    if (!knownKeys.has(markerKey)) {
      throw new Error(`Marker "${markerKey}" is not in eventConfig (manifest.json)`);
    }
  }
}

/** A new set with one key shown or hidden. */
export function withMarkerVisibility(
  markerKeys: ReadonlySet<string>,
  markerKey: string,
  isVisible: boolean,
  eventConfig: EventConfig,
): ReadonlySet<string> {
  requireKnownMarkerKeys(new Set([markerKey]), eventConfig);
  const changedKeys = new Set(markerKeys);
  if (isVisible) {
    changedKeys.add(markerKey);
  } else {
    changedKeys.delete(markerKey);
  }
  return changedKeys;
}

/** "Show all" / "Hide all": every player key on or off; bot keys stay as they were. */
export function withAllPlayerMarkers(
  markerKeys: ReadonlySet<string>,
  isVisible: boolean,
  eventConfig: EventConfig,
): ReadonlySet<string> {
  const changedKeys = new Set(markerKeys);
  for (const markerKey of playerMarkerKeys(eventConfig)) {
    if (isVisible) {
      changedKeys.add(markerKey);
    } else {
      changedKeys.delete(markerKey);
    }
  }
  return changedKeys;
}

/** "Only": this key on and every other key, player or bot, off. */
export function onlyMarker(markerKey: string, eventConfig: EventConfig): ReadonlySet<string> {
  const onlyKeys = new Set([markerKey]);
  requireKnownMarkerKeys(onlyKeys, eventConfig);
  return onlyKeys;
}

/** The events whose marker is visible, in input order. */
export function visibleMarkerEvents(
  events: readonly MapEvent[],
  markerKeys: ReadonlySet<string>,
): MapEvent[] {
  return events.filter((mapEvent) => markerKeys.has(mapEvent.markerKey));
}
