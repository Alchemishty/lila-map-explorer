import { readTrackRow, trackRowCount } from "./traffic";
import type { MapEvent } from "./events";
import type { ActorTrack, WorldPoint, WorldRect } from "./types";

/** What the inspector shows for a selected area. */
export interface AreaSummary {
  /** Events inside the area per marker key. Markers with no event inside are absent. */
  readonly countsByMarker: Record<string, number>;
  /** Matches with a player trail that touches the area, in the order of tracksByMatch. */
  readonly matchIdsPassingThrough: string[];
  /**
   * Every match with a counted event inside the area or a player trail through it, once each:
   * most events inside first, ties in the order of tracksByMatch, pass-through-only matches
   * (0 events) last. The counts add up to the sum of countsByMarker.
   */
  readonly matchesToReplay: readonly AreaMatchCount[];
}

/** One match's events inside the selected area. */
export interface AreaMatchCount {
  readonly matchId: string;
  readonly eventCountInArea: number;
  /**
   * The same events per marker key; markers with no event inside are absent. They add up to
   * eventCountInArea, and across every match to AreaSummary.countsByMarker.
   */
  readonly countsByMarker: Record<string, number>;
}

function requireValidArea(area: WorldRect): void {
  const problems: string[] = [];
  for (const [minimumName, maximumName] of [
    ["minWorldX", "maxWorldX"],
    ["minWorldZ", "maxWorldZ"],
  ] as const) {
    const minimum = area[minimumName];
    const maximum = area[maximumName];
    if (!(Number.isFinite(minimum) && Number.isFinite(maximum))) {
      problems.push(
        `${minimumName} ${minimum} and ${maximumName} ${maximum} must be finite numbers`,
      );
    } else if (minimum > maximum) {
      problems.push(`${minimumName} ${minimum} is greater than ${maximumName} ${maximum}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Selected area is not a valid world rectangle: ${problems.join("; ")}`);
  }
}

function isPointInRect(point: WorldPoint, area: WorldRect): boolean {
  return (
    point.worldX >= area.minWorldX &&
    point.worldX <= area.maxWorldX &&
    point.worldZ >= area.minWorldZ &&
    point.worldZ <= area.maxWorldZ
  );
}

/**
 * True when any part of the segment from start to end lies inside the rectangle, edges included
 * (Liang-Barsky clipping). A zero-length segment is treated as a point.
 */
export function segmentIntersectsRect(
  start: WorldPoint,
  end: WorldPoint,
  area: WorldRect,
): boolean {
  requireValidArea(area);
  const deltaWorldX = end.worldX - start.worldX;
  const deltaWorldZ = end.worldZ - start.worldZ;
  let enterFraction = 0;
  let exitFraction = 1;
  // Each pair is (direction toward the boundary, distance from start to the boundary) for the
  // four half-planes x >= min, x <= max, z >= min, z <= max.
  const boundaryChecks: readonly (readonly [number, number])[] = [
    [-deltaWorldX, start.worldX - area.minWorldX],
    [deltaWorldX, area.maxWorldX - start.worldX],
    [-deltaWorldZ, start.worldZ - area.minWorldZ],
    [deltaWorldZ, area.maxWorldZ - start.worldZ],
  ];
  for (const [directionTowardBoundary, distanceInside] of boundaryChecks) {
    if (directionTowardBoundary === 0) {
      if (distanceInside < 0) {
        return false; // parallel to this boundary and outside it
      }
      continue;
    }
    const boundaryFraction = distanceInside / directionTowardBoundary;
    if (directionTowardBoundary < 0) {
      enterFraction = Math.max(enterFraction, boundaryFraction);
    } else {
      exitFraction = Math.min(exitFraction, boundaryFraction);
    }
    if (enterFraction > exitFraction) {
      return false;
    }
  }
  return true;
}

/**
 * True when a player trail of the match touches the area. Trails join every row of a track;
 * a track with a single row touches the area when that row is inside it.
 */
function doesMatchPassThrough(
  matchId: string,
  tracks: readonly ActorTrack[],
  area: WorldRect,
): boolean {
  for (const track of tracks) {
    if (!track.isPlayer) {
      continue; // valid path: "passing through" uses player tracks only, the same as traffic
    }
    const trackDescription = `Match "${matchId}", actor "${track.actorKey}"`;
    const rowCount = trackRowCount(track);
    if (rowCount === 1 && isPointInRect(readTrackRow(track, 0, trackDescription).position, area)) {
      return true;
    }
    for (let i = 1; i < rowCount; i++) {
      const start = readTrackRow(track, i - 1, trackDescription).position;
      const end = readTrackRow(track, i, trackDescription).position;
      if (segmentIntersectsRect(start, end, area)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Counts the given events inside the area (edges included) per marker key and per match, and lists
 * the matches whose player trails pass through it. Every row counts, including isSameTickRepeat rows.
 * `events` is whatever the caller passes: Overview passes its visible markers.
 */
export function summarizeArea(
  area: WorldRect,
  events: readonly MapEvent[],
  tracksByMatch: ReadonlyMap<string, readonly ActorTrack[]>,
): AreaSummary {
  requireValidArea(area);
  const countByMarkerKey = new Map<string, number>();
  const eventCountByMatchId = new Map<string, number>();
  const countByMarkerKeyByMatchId = new Map<string, Map<string, number>>();
  for (const mapEvent of events) {
    if (isPointInRect(mapEvent.position, area)) {
      if (!tracksByMatch.has(mapEvent.matchId)) {
        throw new Error(
          `An event inside the selected area belongs to match "${mapEvent.matchId}", which has no tracks loaded`,
        );
      }
      incrementCount(countByMarkerKey, mapEvent.markerKey);
      incrementCount(eventCountByMatchId, mapEvent.matchId);
      const matchCountByMarkerKey = countByMarkerKeyByMatchId.get(mapEvent.matchId);
      if (matchCountByMarkerKey === undefined) {
        // Absent means this is the match's first event inside the area.
        countByMarkerKeyByMatchId.set(mapEvent.matchId, new Map([[mapEvent.markerKey, 1]]));
      } else {
        incrementCount(matchCountByMarkerKey, mapEvent.markerKey);
      }
    }
  }
  const countsByMarker = Object.fromEntries(countByMarkerKey);
  const matchIdsPassingThrough: string[] = [];
  const matchesToReplay: AreaMatchCount[] = [];
  for (const [matchId, tracks] of tracksByMatch) {
    const isPassingThrough = doesMatchPassThrough(matchId, tracks, area);
    if (isPassingThrough) {
      matchIdsPassingThrough.push(matchId);
    }
    const eventCountInArea = eventCountByMatchId.get(matchId);
    const matchCountByMarkerKey = countByMarkerKeyByMatchId.get(matchId);
    // Absent means no counted event of this match is inside the area.
    if (eventCountInArea !== undefined || isPassingThrough) {
      matchesToReplay.push({
        matchId,
        eventCountInArea: eventCountInArea === undefined ? 0 : eventCountInArea,
        countsByMarker:
          matchCountByMarkerKey === undefined ? {} : Object.fromEntries(matchCountByMarkerKey),
      });
    }
  }
  // Array.prototype.sort is stable, so equal counts keep the order of tracksByMatch.
  matchesToReplay.sort((first, second) => second.eventCountInArea - first.eventCountInArea);
  return { countsByMarker, matchIdsPassingThrough, matchesToReplay };
}

function incrementCount<Key>(countByKey: Map<Key, number>, key: Key): void {
  const previousCount = countByKey.get(key);
  // Absent means this is the first event for the key inside the area.
  countByKey.set(key, previousCount === undefined ? 1 : previousCount + 1);
}
