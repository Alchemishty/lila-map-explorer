import { DataContractError } from "./contract";
import type { MapEvent } from "./events";
import { readTrackRow, trackRowCount, type TrackRow } from "./traffic";
import type { ActorTrack, MatchSummary, WorldPoint } from "./types";

// Replay playback: one match's clock, the trail of each actor up to now, and the
// timeline's event ticks. Times on the clock are elapsed seconds since the match's first row.

export type PlaybackSpeed = 1 | 4 | 16;

export interface PlaybackState {
  readonly matchStartTimestampSeconds: number;
  readonly durationSeconds: number;
  /** Between 0 and durationSeconds, both included. */
  readonly elapsedSeconds: number;
  readonly speed: PlaybackSpeed;
  readonly isPlaying: boolean;
}

/** An actor's path up to now: the rows at or before now, and where the actor is now. */
export interface TrailUpToNow {
  readonly points: WorldPoint[];
  /** Null before the actor's first row; otherwise interpolated toward the next row. */
  readonly headPosition: WorldPoint | null;
}

/** One event's place on the timeline. fraction is elapsedSeconds / match duration, from 0 to 1. */
export interface TimelineTick {
  readonly fraction: number;
  readonly markerKey: string;
  readonly elapsedSeconds: number;
}

const millisecondsPerSecond = 1000;

function clampElapsedSeconds(state: PlaybackState, elapsedSeconds: number): number {
  return Math.min(Math.max(elapsedSeconds, 0), state.durationSeconds);
}

/** A paused clock at the start of the match, at 1x. */
export function createPlayback(match: MatchSummary): PlaybackState {
  return {
    matchStartTimestampSeconds: match.startTimestampSeconds,
    durationSeconds: match.durationSeconds,
    elapsedSeconds: 0,
    speed: 1,
    isPlaying: false,
  };
}

/**
 * Moves a playing clock forward by the wall-clock time times the speed. It stops at the end of the
 * match and stops playing there. A paused clock does not move. A negative or non-finite delta
 * throws, because the animation loop never produces one.
 */
export function advancePlayback(
  state: PlaybackState,
  wallClockDeltaMilliseconds: number,
): PlaybackState {
  if (!Number.isFinite(wallClockDeltaMilliseconds) || wallClockDeltaMilliseconds < 0) {
    throw new Error(
      `Playback cannot advance by ${wallClockDeltaMilliseconds} ms: ` +
        "the wall-clock delta must be a finite number of milliseconds, 0 or more",
    );
  }
  if (!state.isPlaying) {
    return state; // valid path: a paused clock stays where it is
  }
  const elapsedSeconds = clampElapsedSeconds(
    state,
    state.elapsedSeconds + (wallClockDeltaMilliseconds / millisecondsPerSecond) * state.speed,
  );
  return { ...state, elapsedSeconds, isPlaying: elapsedSeconds < state.durationSeconds };
}

/** Jumps the clock to elapsedSeconds, clamped to the match. Speed and play state are kept. */
export function seekPlayback(state: PlaybackState, elapsedSeconds: number): PlaybackState {
  if (!Number.isFinite(elapsedSeconds)) {
    throw new Error(`Playback cannot seek to ${elapsedSeconds} s: the target must be finite`);
  }
  return { ...state, elapsedSeconds: clampElapsedSeconds(state, elapsedSeconds) };
}

function interpolatePosition(
  previousRow: TrackRow,
  nextRow: TrackRow,
  nowTimestampSeconds: number,
): WorldPoint {
  // nextRow is strictly after now and previousRow at or before it, so the gap is never 0.
  const fraction =
    (nowTimestampSeconds - previousRow.timestampSeconds) /
    (nextRow.timestampSeconds - previousRow.timestampSeconds);
  return {
    worldX:
      previousRow.position.worldX +
      (nextRow.position.worldX - previousRow.position.worldX) * fraction,
    worldZ:
      previousRow.position.worldZ +
      (nextRow.position.worldZ - previousRow.position.worldZ) * fraction,
  };
}

/** Throws unless elapsedSeconds is a finite number; callers pass a PlaybackState's clock. */
function requireFiniteElapsedSeconds(elapsedSeconds: number, functionName: string): void {
  if (!Number.isFinite(elapsedSeconds)) {
    throw new Error(`${functionName} was given elapsed ${elapsedSeconds} s: it must be finite`);
  }
}

/**
 * The actor's trail at elapsedSeconds. Every row counts (position and event rows), because each
 * records where the actor was. An actor with 0 rows, or none yet, has no head. Rows out
 * of time order throw a DataContractError (the build step sorts them) at any elapsed time, because
 * every row is checked, not only those before now.
 */
export function trailUpTo(
  track: ActorTrack,
  elapsedSeconds: number,
  matchStartTimestampSeconds: number,
): TrailUpToNow {
  requireFiniteElapsedSeconds(elapsedSeconds, "trailUpTo");
  const trackDescription = `Actor "${track.actorKey}"`;
  const nowTimestampSeconds = matchStartTimestampSeconds + elapsedSeconds;
  const points: WorldPoint[] = [];
  let previousRow: TrackRow | null = null;
  let lastRowUpToNow: TrackRow | null = null;
  let firstRowAfterNow: TrackRow | null = null;
  for (let i = 0; i < trackRowCount(track); i++) {
    const trackRow = readTrackRow(track, i, trackDescription);
    if (previousRow !== null && trackRow.timestampSeconds < previousRow.timestampSeconds) {
      throw new DataContractError(
        `${trackDescription}: rows are not sorted by time (row ${i} at ` +
          `${trackRow.timestampSeconds} s comes after ${previousRow.timestampSeconds} s)`,
      );
    }
    previousRow = trackRow;
    if (trackRow.timestampSeconds <= nowTimestampSeconds) {
      points.push(trackRow.position);
      lastRowUpToNow = trackRow;
    } else if (firstRowAfterNow === null) {
      firstRowAfterNow = trackRow;
    }
  }
  if (lastRowUpToNow === null) {
    return { points, headPosition: null }; // valid path: the actor has no row yet, or no rows at all
  }
  if (firstRowAfterNow === null) {
    return { points, headPosition: lastRowUpToNow.position }; // every row has passed: stay at the last one
  }
  return {
    points,
    headPosition: interpolatePosition(lastRowUpToNow, firstRowAfterNow, nowTimestampSeconds),
  };
}

/**
 * A new array of the events sorted by the time they happened. The sort is stable, so events in the
 * same second keep their input order (deriveEvents gives one actor's rows in recorded order).
 */
function sortEventsByTime(events: readonly MapEvent[]): MapEvent[] {
  return [...events].sort(
    (firstEvent, secondEvent) => firstEvent.timestampSeconds - secondEvent.timestampSeconds,
  );
}

/** The events at or before elapsedSeconds, in the order they happened. */
export function eventsUpTo(
  events: readonly MapEvent[],
  elapsedSeconds: number,
  matchStartTimestampSeconds: number,
): MapEvent[] {
  requireFiniteElapsedSeconds(elapsedSeconds, "eventsUpTo");
  const nowTimestampSeconds = matchStartTimestampSeconds + elapsedSeconds;
  return sortEventsByTime(events).filter(
    (mapEvent) => mapEvent.timestampSeconds <= nowTimestampSeconds,
  );
}

/**
 * One tick per event, in the order the events happened (same-second events in input order). An
 * event from another match or outside the match's time span throws a DataContractError: the build
 * step derives the span from the match's own rows. A match of length 0 throws too, because the
 * build step rejects it (every row in the same second means its timestamps are broken).
 */
export function timelineTicks(events: readonly MapEvent[], match: MatchSummary): TimelineTick[] {
  if (match.durationSeconds <= 0) {
    throw new DataContractError(
      `Match "${match.matchId}" has length ${match.durationSeconds} s, so its timestamps are ` +
        "broken (length 0 means every row in the same second). " +
        "The build step should have rejected it.",
    );
  }
  return sortEventsByTime(events).map((mapEvent) => {
    const elapsedSeconds = mapEvent.timestampSeconds - match.startTimestampSeconds;
    if (mapEvent.matchId !== match.matchId) {
      throw new DataContractError(
        `Timeline of match "${match.matchId}" was given an event from match "${mapEvent.matchId}"`,
      );
    }
    if (elapsedSeconds < 0 || elapsedSeconds > match.durationSeconds) {
      throw new DataContractError(
        `Match "${match.matchId}", actor "${mapEvent.actorKey}": event "${mapEvent.eventCode}" ` +
          `at ${elapsedSeconds} s is outside the match (0 to ${match.durationSeconds} s)`,
      );
    }
    return {
      fraction: elapsedSeconds / match.durationSeconds,
      markerKey: mapEvent.markerKey,
      elapsedSeconds,
    };
  });
}
