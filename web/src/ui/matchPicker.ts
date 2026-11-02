import type { MatchSummary } from "../domain/types";

// Labels for days and matches, and the pure rule behind the match-subset checkbox list.
// Every time is shown in UTC, because the data's days are UTC days.

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const millisecondsPerSecond = 1000;
const secondsPerMinute = 60;
const dayUtcPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function monthName(monthIndex: number): string {
  const name = monthNames[monthIndex];
  if (name === undefined) {
    throw new Error(`Month number ${monthIndex + 1} is not between 1 and 12`);
  }
  return name;
}

function padToTwoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** "2026-02-10" → "Feb 10". */
export function formatDayLabel(dayUtc: string): string {
  const dayMatch = dayUtcPattern.exec(dayUtc);
  if (dayMatch === null) {
    throw new Error(`"${dayUtc}" is not a UTC day in YYYY-MM-DD form`);
  }
  const [, , monthText, dayText] = dayMatch;
  return `${monthName(Number(monthText) - 1)} ${Number(dayText)}`;
}

function formatStartDayText(startDate: Date): string {
  return `${monthName(startDate.getUTCMonth())} ${startDate.getUTCDate()}`;
}

function formatStartTimeText(startDate: Date): string {
  return `${padToTwoDigits(startDate.getUTCHours())}:${padToTwoDigits(startDate.getUTCMinutes())} UTC`;
}

/** UTC start day and time, for example "Feb 12 · 14:05 UTC". */
export function formatMatchStartLabel(match: MatchSummary): string {
  const startDate = new Date(match.startTimestampSeconds * millisecondsPerSecond);
  return `${formatStartDayText(startDate)} · ${formatStartTimeText(startDate)}`;
}

/**
 * A match's row under its day heading: the full label without the day, for example
 * "14:05 UTC · 6m 22s · 1 player, 14 recorded bot tracks".
 */
export function formatMatchRowLabel(match: MatchSummary): string {
  const startDate = new Date(match.startTimestampSeconds * millisecondsPerSecond);
  const lengthMinutes = Math.floor(match.durationSeconds / secondsPerMinute);
  const lengthRemainderSeconds = match.durationSeconds % secondsPerMinute;
  return (
    `${formatStartTimeText(startDate)} · ${lengthMinutes}m ${lengthRemainderSeconds}s · ` +
    `${match.playerCount} ${match.playerCount === 1 ? "player" : "players"}, ` +
    `${match.botCount} recorded bot ${match.botCount === 1 ? "track" : "tracks"}`
  );
}

/** UTC start day, then the row label: time, elapsed duration, players and recorded bot tracks. */
export function formatMatchLabel(match: MatchSummary): string {
  const startDate = new Date(match.startTimestampSeconds * millisecondsPerSecond);
  return `${formatStartDayText(startDate)} · ${formatMatchRowLabel(match)}`;
}

/**
 * The match subset after one checkbox changes. matchIdSet null means "All matches" (every available
 * match is checked). Unchecking the last checked match goes back to null rather than selecting none.
 * The input set is never changed.
 */
export function toggleMatchInSubset(
  matchIdSet: ReadonlySet<string> | null,
  availableMatchIds: readonly string[],
  matchId: string,
  isChecked: boolean,
): ReadonlySet<string> | null {
  if (!availableMatchIds.includes(matchId)) {
    throw new Error(`Match "${matchId}" is not one of the matches for the chosen map and days`);
  }
  const nextMatchIdSet = new Set(matchIdSet === null ? availableMatchIds : matchIdSet);
  if (isChecked) {
    nextMatchIdSet.add(matchId);
  } else {
    nextMatchIdSet.delete(matchId);
  }
  return nextMatchIdSet.size === 0 ? null : nextMatchIdSet;
}
