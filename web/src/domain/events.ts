import { DataContractError } from "./contract";
import type {
  ActorTrack,
  ActorType,
  EventConfig,
  EventRule,
  OtherParty,
  WorldPoint,
} from "./types";

/** One non-position row of an actor's track, labelled by its event rule. */
export interface MapEvent {
  readonly matchId: string;
  readonly actorKey: string;
  readonly actorType: ActorType;
  readonly eventCode: string;
  readonly category: string;
  /** Key into EventConfig.markers. */
  readonly markerKey: string;
  readonly otherParty: OtherParty;
  /** True for rows from bot tracks (rules in EventConfig.bot); the other party is then not recorded. */
  readonly isPerformedByBot: boolean;
  readonly position: WorldPoint;
  readonly timestampSeconds: number;
  /** The row repeats the previous one exactly in the same second; it still counts. */
  readonly isSameTickRepeat: boolean;
}

const positionCategory = "position";
/** The category of loot events (config/event_types.json). */
export const lootCategory = "loot";

/**
 * The events in drawing order: loot first, so the more numerous loot markers sit beneath kill,
 * death and storm markers (user decision 2026-11-02). Otherwise the order is kept.
 */
export function orderLootFirst<Item>(
  items: readonly Item[],
  eventOf: (item: Item) => MapEvent,
): Item[] {
  return [
    ...items.filter((item) => eventOf(item).category === lootCategory),
    ...items.filter((item) => eventOf(item).category !== lootCategory),
  ];
}

function findEventRule(
  eventConfig: EventConfig,
  track: ActorTrack,
  matchId: string,
  eventCode: string,
): EventRule {
  const sideName = track.isPlayer ? "player" : "bot";
  const rulesByEventCode = track.isPlayer ? eventConfig.player : eventConfig.bot;
  // Own keys only, so codes such as "toString" never resolve to Object built-ins.
  const eventRule = Object.hasOwn(rulesByEventCode, eventCode)
    ? rulesByEventCode[eventCode]
    : undefined;
  if (eventRule === undefined) {
    throw new DataContractError(
      `Match "${matchId}", actor "${track.actorKey}": event code "${eventCode}" has no rule in the ` +
        `${sideName} section of eventConfig (manifest.json). The build step should have rejected it.`,
    );
  }
  return eventRule;
}

function deriveTrackEvents(
  track: ActorTrack,
  matchId: string,
  eventConfig: EventConfig,
): MapEvent[] {
  const trackEvents: MapEvent[] = [];
  for (let i = 0; i < track.eventCodes.length; i++) {
    const eventCode = track.eventCodes[i];
    const worldX = track.worldX[i];
    const worldZ = track.worldZ[i];
    const timestampSeconds = track.timestampSeconds[i];
    const isSameTickRepeat = track.isSameTickRepeat[i];
    if (
      eventCode === undefined ||
      worldX === undefined ||
      worldZ === undefined ||
      timestampSeconds === undefined ||
      isSameTickRepeat === undefined
    ) {
      throw new DataContractError(
        `Match "${matchId}", actor "${track.actorKey}": row ${i} is missing a value ` +
          "(the track's parallel arrays have different lengths)",
      );
    }
    const eventRule = findEventRule(eventConfig, track, matchId, eventCode);
    if (eventRule.category === positionCategory) {
      continue;
    }
    if (eventRule.marker === null) {
      const sideName = track.isPlayer ? "player" : "bot";
      throw new DataContractError(
        `Match "${matchId}", actor "${track.actorKey}": the ${sideName} rule for event code "${eventCode}" ` +
          `(category "${eventRule.category}") has no marker in eventConfig (manifest.json)`,
      );
    }
    trackEvents.push({
      matchId,
      actorKey: track.actorKey,
      actorType: track.actorType,
      eventCode,
      category: eventRule.category,
      markerKey: eventRule.marker,
      otherParty: eventRule.otherParty,
      isPerformedByBot: !track.isPlayer,
      position: { worldX, worldZ },
      timestampSeconds,
      isSameTickRepeat,
    });
  }
  return trackEvents;
}

/**
 * Every non-position row of the match's tracks as a MapEvent, in track order then row order.
 * Player tracks use the player rules and bot tracks the bot rules. A code with no rule throws:
 * the pipeline rejects unknown codes, so reaching one here means the data contract is broken.
 */
export function deriveEvents(
  tracks: readonly ActorTrack[],
  matchId: string,
  eventConfig: EventConfig,
): MapEvent[] {
  return tracks.flatMap((track) => deriveTrackEvents(track, matchId, eventConfig));
}

/** Events performed by players (human or misidentified human), in input order. */
export function playerSideEvents(events: readonly MapEvent[]): MapEvent[] {
  return events.filter((mapEvent) => !mapEvent.isPerformedByBot);
}

/** Events performed by bots, in input order. */
export function botSideEvents(events: readonly MapEvent[]): MapEvent[] {
  return events.filter((mapEvent) => mapEvent.isPerformedByBot);
}
