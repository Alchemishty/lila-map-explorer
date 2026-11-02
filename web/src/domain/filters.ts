import type { MatchSummary } from "./types";

/** Which matches the app shows: one map, a set of UTC start days, and optionally a hand-picked subset. */
export interface MatchFilter {
  readonly mapId: string;
  /** UTC start days ("YYYY-MM-DD") to include. An empty set selects nothing. */
  readonly dayUtcSet: ReadonlySet<string>;
  /** Match ids to include, or null for every match that passes the map and day filters. */
  readonly matchIdSet: ReadonlySet<string> | null;
}

function compareMatchesByStart(firstMatch: MatchSummary, secondMatch: MatchSummary): number {
  if (firstMatch.startTimestampSeconds !== secondMatch.startTimestampSeconds) {
    return firstMatch.startTimestampSeconds - secondMatch.startTimestampSeconds;
  }
  if (firstMatch.matchId === secondMatch.matchId) {
    return 0;
  }
  return firstMatch.matchId < secondMatch.matchId ? -1 : 1;
}

/** The matches that pass the filter, as a new list sorted by start time (then match id). */
export function selectMatches(
  matches: readonly MatchSummary[],
  filter: MatchFilter,
): MatchSummary[] {
  const { mapId, dayUtcSet, matchIdSet } = filter;
  return matches
    .filter(
      (match) =>
        match.mapId === mapId &&
        dayUtcSet.has(match.dayUtc) &&
        (matchIdSet === null || matchIdSet.has(match.matchId)),
    )
    .sort(compareMatchesByStart);
}

/**
 * Each UTC start day with at least one match on the map, ascending. "YYYY-MM-DD" strings sort
 * chronologically. A map with no matches yields an empty list, which is a valid state.
 */
export function availableDays(matches: readonly MatchSummary[], mapId: string): string[] {
  const dayUtcSet = new Set<string>();
  for (const match of matches) {
    if (match.mapId === mapId) {
      dayUtcSet.add(match.dayUtc);
    }
  }
  return [...dayUtcSet].sort();
}

/** One UTC start day's matches, for a picker's day heading. */
export interface MatchDayGroup {
  /** The UTC start day ("YYYY-MM-DD") the filters use, so a match is never filed under another day. */
  readonly dayUtc: string;
  readonly matches: readonly MatchSummary[];
}

/**
 * Splits a start-time-ordered match list (as selectMatches returns it) into runs of one UTC start
 * day, keeping the order. A day that comes back after another day means the list is not in time
 * order, which would split one day under two headings, so it throws.
 */
export function groupMatchesByStartDay(sortedMatches: readonly MatchSummary[]): MatchDayGroup[] {
  const groups: { dayUtc: string; matches: MatchSummary[] }[] = [];
  for (const match of sortedMatches) {
    const lastGroup = groups.at(-1);
    if (lastGroup !== undefined && lastGroup.dayUtc === match.dayUtc) {
      lastGroup.matches.push(match);
      continue;
    }
    if (groups.some((group) => group.dayUtc === match.dayUtc)) {
      throw new Error(
        `Match "${match.matchId}" starts on ${match.dayUtc} after a later day's match: the match list is not in start-time order`,
      );
    }
    groups.push({ dayUtc: match.dayUtc, matches: [match] });
  }
  return groups;
}
