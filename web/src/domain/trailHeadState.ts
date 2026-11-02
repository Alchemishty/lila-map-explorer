import { DataContractError } from "./contract";
import { readTrackRow, trackRowCount, type TrackRow } from "./traffic";
import type { ActorTrack, EventConfig } from "./types";

// What Replay can honestly say about an actor's head at the clock (telemetry audit issue 9, user
// decision 2026-11-02). We only know where an actor was at its recorded rows, so the head says
// which case it is in instead of always looking like a live actor standing there:
// - "moving": between two rows at different positions (however slowly).
// - "waiting": between two rows at exactly the same world X and Z. The later row proves the actor
//   was still alive, and we assume it stood still (audit issue 4).
// - "dead": at or after the actor's first recorded death.
// - "last_seen": after the actor's final row, with no recorded death. Nothing is known after it.

export type TrailHeadState = "moving" | "waiting" | "dead" | "last_seen";

const deathCategories: ReadonlySet<string> = new Set(["combat_death", "storm_death", "bot_death"]);

function isDeathRow(track: ActorTrack, trackRow: TrackRow, eventConfig: EventConfig): boolean {
  const sideRules = track.isPlayer ? eventConfig.player : eventConfig.bot;
  const sideName = track.isPlayer ? "player" : "bot";
  // Own keys only, so codes such as "toString" never resolve to Object built-ins.
  const eventRule = Object.hasOwn(sideRules, trackRow.eventCode)
    ? sideRules[trackRow.eventCode]
    : undefined;
  if (eventRule === undefined) {
    throw new DataContractError(
      `Actor "${track.actorKey}": event code "${trackRow.eventCode}" has no rule in the ` +
        `${sideName} section of eventConfig (manifest.json). The build step should have rejected it.`,
    );
  }
  return deathCategories.has(eventRule.category);
}

function isSameWorldPosition(firstRow: TrackRow, secondRow: TrackRow): boolean {
  return (
    firstRow.position.worldX === secondRow.position.worldX &&
    firstRow.position.worldZ === secondRow.position.worldZ
  );
}

/**
 * The head's state at elapsedSeconds, or null before the actor's first row (no head yet). Rows
 * must be sorted by time, as trailUpTo checks; this reads the same rows in the same order.
 */
export function trailHeadStateAt(
  track: ActorTrack,
  elapsedSeconds: number,
  matchStartTimestampSeconds: number,
  eventConfig: EventConfig,
): TrailHeadState | null {
  if (!Number.isFinite(elapsedSeconds)) {
    throw new Error(`trailHeadStateAt was given elapsed ${elapsedSeconds} s: it must be finite`);
  }
  const trackDescription = `Actor "${track.actorKey}"`;
  const nowTimestampSeconds = matchStartTimestampSeconds + elapsedSeconds;
  let lastRowUpToNow: TrackRow | null = null;
  let firstRowAfterNow: TrackRow | null = null;
  for (let i = 0; i < trackRowCount(track); i++) {
    const trackRow = readTrackRow(track, i, trackDescription);
    if (trackRow.timestampSeconds > nowTimestampSeconds) {
      firstRowAfterNow = trackRow;
      break;
    }
    if (isDeathRow(track, trackRow, eventConfig)) {
      return "dead"; // rows after a death (audit issue 3) do not bring the actor back
    }
    lastRowUpToNow = trackRow;
  }
  if (lastRowUpToNow === null) {
    return null; // valid path: the actor has no row yet, or no rows at all
  }
  if (firstRowAfterNow === null) {
    return "last_seen";
  }
  return isSameWorldPosition(lastRowUpToNow, firstRowAfterNow) ? "waiting" : "moving";
}
