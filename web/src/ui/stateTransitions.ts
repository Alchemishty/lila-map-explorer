import type { MapEvent } from "../domain/events";
import { availableDays, selectMatches, type MatchFilter } from "../domain/filters";
import type { HeatmapKind } from "../domain/heatmap";
import { createPlayback, type PlaybackState } from "../domain/playback";
import type { Manifest, MatchSummary, WorldRect } from "../domain/types";
import { botOnlyMarkerKeys, playerMarkerKeys } from "./markerVisibility";

// Every reset rule of the app lives in transitionAppState, a pure function. The
// app always changes state through it, so a match, mode or filter change can never leave stale
// playback, a stale followed actor or a stale area behind.

export type AppMode = "overview" | "replay";

export interface OverviewState {
  /** The heatmap shown, or null when the heatmap is off. */
  readonly heatmapKind: HeatmapKind | null;
  /** The marker types drawn (legend marker keys); the inspector counts player types regardless. */
  readonly visibleMarkerKeys: ReadonlySet<string>;
  readonly selectedArea: WorldRect | null;
}

export interface ReplayState {
  /** The match being replayed; null when no match is selected. */
  readonly matchId: string | null;
  readonly followedActorKey: string | null;
  readonly shouldHideBots: boolean;
  /** Replay's own marker switches (legend marker keys); they never change the followed summary. */
  readonly visibleMarkerKeys: ReadonlySet<string>;
  /** The clock of matchId; null exactly when matchId is null. */
  readonly playback: PlaybackState | null;
  /** The tapped marker and any others at its exact spot, in time order; empty when none is. */
  readonly inspectedMarkerEvents: readonly MapEvent[];
}

export interface AppState {
  readonly appMode: AppMode;
  readonly filter: MatchFilter;
  readonly overview: OverviewState;
  readonly replay: ReplayState;
}

function areSetsEqual(firstSet: ReadonlySet<string>, secondSet: ReadonlySet<string>): boolean {
  if (firstSet.size !== secondSet.size) {
    return false;
  }
  for (const member of firstSet) {
    if (!secondSet.has(member)) {
      return false;
    }
  }
  return true;
}

function areFiltersEqual(firstFilter: MatchFilter, secondFilter: MatchFilter): boolean {
  if (firstFilter.mapId !== secondFilter.mapId) {
    return false;
  }
  if (!areSetsEqual(firstFilter.dayUtcSet, secondFilter.dayUtcSet)) {
    return false;
  }
  if (firstFilter.matchIdSet === null || secondFilter.matchIdSet === null) {
    return firstFilter.matchIdSet === secondFilter.matchIdSet;
  }
  return areSetsEqual(firstFilter.matchIdSet, secondFilter.matchIdSet);
}

/**
 * A map change selects every day the new map has and drops the match subset. A day
 * change keeps only the subset's matches still on the chosen days, and drops the subset when
 * none is left.
 */
function applyFilterRules(
  previousFilter: MatchFilter,
  requestedFilter: MatchFilter,
  matches: readonly MatchSummary[],
): MatchFilter {
  if (requestedFilter.mapId !== previousFilter.mapId) {
    return {
      mapId: requestedFilter.mapId,
      dayUtcSet: new Set(availableDays(matches, requestedFilter.mapId)),
      matchIdSet: null,
    };
  }
  const requestedMatchIdSet = requestedFilter.matchIdSet;
  if (
    requestedMatchIdSet === null ||
    areSetsEqual(requestedFilter.dayUtcSet, previousFilter.dayUtcSet)
  ) {
    return requestedFilter;
  }
  const remainingMatchIds = selectMatches(matches, { ...requestedFilter, matchIdSet: null })
    .map((match) => match.matchId)
    .filter((matchId) => requestedMatchIdSet.has(matchId));
  return {
    ...requestedFilter,
    matchIdSet: remainingMatchIds.length === 0 ? null : new Set(remainingMatchIds),
  };
}

/** The match a requested replay.matchId names; it must be one of the selected matches. */
function requireRequestedMatch(
  requestedMatchId: string | null,
  selectedMatches: readonly MatchSummary[],
): MatchSummary {
  if (requestedMatchId === null) {
    throw new Error(
      "The replayed match cannot be cleared directly: it follows the filters, so change them instead",
    );
  }
  const requestedMatch = selectedMatches.find((match) => match.matchId === requestedMatchId);
  if (requestedMatch === undefined) {
    throw new Error(
      `Match "${requestedMatchId}" cannot be replayed: it is not among the selected matches`,
    );
  }
  return requestedMatch;
}

/** The current match if it is still selected, else the earliest selected match, else null. */
function keepOrPickEarliestMatch(
  currentMatchId: string | null,
  selectedMatches: readonly MatchSummary[],
): MatchSummary | null {
  const currentMatch = selectedMatches.find((match) => match.matchId === currentMatchId);
  if (currentMatch !== undefined) {
    return currentMatch;
  }
  const earliestMatch = selectedMatches[0];
  // Valid path: no match passes the filters, so there is nothing to replay.
  return earliestMatch === undefined ? null : earliestMatch;
}

/**
 * The state after applying the patch (shallow, like the store) and every reset rule:
 * - a map or day change follows applyFilterRules, and any filter change clears the selected area
 * - a mode or filter change keeps the replayed match if still selected (else the earliest selected
 *   match, else null), restarts its playback and clears the followed actor and inspected marker
 * - a replay.matchId change (which must name a selected match) restarts playback at elapsed 0,
 *   paused, and clears the followed actor and inspected marker
 */
export function transitionAppState(
  previous: AppState,
  patch: Partial<AppState>,
  matches: readonly MatchSummary[],
): AppState {
  const mergedState: AppState = { ...previous, ...patch };
  const nextFilter =
    patch.filter === undefined
      ? previous.filter
      : applyFilterRules(previous.filter, patch.filter, matches);
  const isFilterChanged = !areFiltersEqual(previous.filter, nextFilter);
  const isModeChanged = mergedState.appMode !== previous.appMode;
  const isMatchRequested =
    patch.replay !== undefined && patch.replay.matchId !== previous.replay.matchId;

  if (!isFilterChanged && !isModeChanged && !isMatchRequested) {
    return { ...mergedState, filter: previous.filter };
  }

  const selectedMatches = selectMatches(matches, nextFilter);
  const resultingMatch = isMatchRequested
    ? requireRequestedMatch(mergedState.replay.matchId, selectedMatches)
    : keepOrPickEarliestMatch(mergedState.replay.matchId, selectedMatches);

  return {
    appMode: mergedState.appMode,
    filter: isFilterChanged ? nextFilter : previous.filter,
    overview: isFilterChanged
      ? { ...mergedState.overview, selectedArea: null }
      : mergedState.overview,
    replay: {
      ...mergedState.replay,
      matchId: resultingMatch === null ? null : resultingMatch.matchId,
      followedActorKey: null,
      playback: resultingMatch === null ? null : createPlayback(resultingMatch),
      inspectedMarkerEvents: [],
    },
  };
}

/** The id of the map with the most matches; on a tie, the one listed first in the manifest. */
function mapIdWithMostMatches(manifest: Manifest): string {
  let bestMapId: string | null = null;
  let bestMatchCount = -1;
  for (const map of manifest.maps) {
    const matchCount = manifest.matches.filter((match) => match.mapId === map.mapId).length;
    if (matchCount > bestMatchCount) {
      bestMapId = map.mapId;
      bestMatchCount = matchCount;
    }
  }
  if (bestMapId === null) {
    throw new Error("manifest.json lists no maps, so there is nothing to show");
  }
  return bestMapId;
}

/**
 * The state the app starts in: the map with the most matches, all of its days and all matches,
 * Overview mode on Kill zones with every marker type off (user decision 2026-11-02: the heatmap
 * answers first, and the designer switches on the markers they need), and nothing replayed.
 */
export function createInitialAppState(manifest: Manifest): AppState {
  const mapId = mapIdWithMostMatches(manifest);
  return {
    appMode: "overview",
    filter: {
      mapId,
      dayUtcSet: new Set(availableDays(manifest.matches, mapId)),
      matchIdSet: null,
    },
    overview: {
      heatmapKind: "kills",
      visibleMarkerKeys: new Set(),
      selectedArea: null,
    },
    replay: {
      matchId: null,
      followedActorKey: null,
      shouldHideBots: false,
      visibleMarkerKeys: new Set([
        ...playerMarkerKeys(manifest.eventConfig),
        ...botOnlyMarkerKeys(manifest.eventConfig),
      ]),
      playback: null,
      inspectedMarkerEvents: [],
    },
  };
}
