// Test-only fixtures for playback.test.ts and playbackEvents.test.ts; never imported by app code.
import type { MatchSummary } from "./types";

export const matchStartTimestampSeconds = 1_770_000_000;

export const testMatch: MatchSummary = {
  matchId: "match-1",
  mapId: "Lockdown",
  dayUtc: "2026-02-10",
  startTimestampSeconds: matchStartTimestampSeconds,
  durationSeconds: 600,
  playerCount: 2,
  botCount: 1,
  eventCountsByMarker: {},
  dayFile: "days/Lockdown/2026-02-10.json",
};
