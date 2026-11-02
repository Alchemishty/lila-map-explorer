import type { MapEvent } from "../domain/events";
import type { TrailHeadState } from "../domain/trailHeadState";
import type { ActorTrack } from "../domain/types";
import { describeHeadStateNow } from "./trailHeadKey";

// The Replay inspector's summary of the followed actor. It counts every event so
// far, whatever the marker switches show.

export const notRecordedNoteText = "The victim and killer are not recorded.";

/** What the inspector shows for the followed actor, up to the playback clock. */
export interface FollowedActorSummary {
  readonly actorKey: string;
  readonly isPlayer: boolean;
  readonly lines: readonly string[];
}

function countEventsOf(
  mapEvents: readonly MapEvent[],
  isCounted: (mapEvent: MapEvent) => boolean,
): number {
  return mapEvents.filter(isCounted).length;
}

/**
 * The actor's head state now, then kills (of players and of bots) and loot for a player, or kills
 * and death for a bot, so far.
 */
export function summarizeFollowedActor(
  track: ActorTrack,
  headStateNow: TrailHeadState | null,
  eventsSoFar: readonly MapEvent[],
): FollowedActorSummary {
  const actorEvents = eventsSoFar.filter((mapEvent) => mapEvent.actorKey === track.actorKey);
  if (track.isPlayer) {
    const isKill = (mapEvent: MapEvent): boolean => mapEvent.category === "kill";
    return {
      actorKey: track.actorKey,
      isPlayer: true,
      lines: [
        describeHeadStateNow(headStateNow),
        `Kills of players: ${countEventsOf(actorEvents, (mapEvent) => isKill(mapEvent) && mapEvent.otherParty === "player")}`,
        `Kills of bots: ${countEventsOf(actorEvents, (mapEvent) => isKill(mapEvent) && mapEvent.otherParty === "bot")}`,
        `Loot events: ${countEventsOf(actorEvents, (mapEvent) => mapEvent.category === "loot")}`,
      ],
    };
  }
  const hasDied = actorEvents.some((mapEvent) => mapEvent.category === "bot_death");
  return {
    actorKey: track.actorKey,
    isPlayer: false,
    lines: [
      describeHeadStateNow(headStateNow),
      `Kills: ${countEventsOf(actorEvents, (mapEvent) => mapEvent.category === "bot_kill")}`,
      `Death recorded so far: ${hasDied ? "yes" : "no"}`,
      notRecordedNoteText,
    ],
  };
}
