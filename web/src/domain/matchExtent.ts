import type { ActorTrack, WorldRect } from "./types";

// The part of the map a Replay match covers, so the map can open framed on that match.

/**
 * The smallest span (world units) on each axis that Replay frames. A match whose rows all sit at one
 * spot, or along one line, would otherwise give a rectangle with no width or height.
 */
export const minimumFramedSpanWorldUnits = 40;

/**
 * The smallest rectangle holding every row of every track: each trail point and each event, since
 * every event is a row of its actor's track. Throws when the tracks hold no rows at all, because a
 * match with nothing recorded is broken data. A track with no rows is valid and adds nothing.
 */
export function worldRectOfTracks(tracks: readonly ActorTrack[], matchId: string): WorldRect {
  let minWorldX = Number.POSITIVE_INFINITY;
  let maxWorldX = Number.NEGATIVE_INFINITY;
  let minWorldZ = Number.POSITIVE_INFINITY;
  let maxWorldZ = Number.NEGATIVE_INFINITY;
  for (const track of tracks) {
    if (track.worldX.length !== track.worldZ.length) {
      throw new Error(
        `Actor "${track.actorKey}" in match "${matchId}" has ${track.worldX.length} x values but ` +
          `${track.worldZ.length} z values`,
      );
    }
    for (const worldX of track.worldX) {
      minWorldX = Math.min(minWorldX, worldX);
      maxWorldX = Math.max(maxWorldX, worldX);
    }
    for (const worldZ of track.worldZ) {
      minWorldZ = Math.min(minWorldZ, worldZ);
      maxWorldZ = Math.max(maxWorldZ, worldZ);
    }
  }
  if (!(Number.isFinite(minWorldX) && Number.isFinite(minWorldZ))) {
    throw new Error(`Match "${matchId}" has no recorded rows to frame on the map`);
  }
  return { minWorldX, maxWorldX, minWorldZ, maxWorldZ };
}

/** Grows rect about its centre until each axis spans at least minimumSpanWorldUnits. */
export function widenToMinimumSpan(rect: WorldRect, minimumSpanWorldUnits: number): WorldRect {
  if (!(Number.isFinite(minimumSpanWorldUnits) && minimumSpanWorldUnits > 0)) {
    throw new Error(
      `A framed span must be a positive number of world units, got ${minimumSpanWorldUnits}`,
    );
  }
  const halfSpanXWorldUnits = Math.max(rect.maxWorldX - rect.minWorldX, minimumSpanWorldUnits) / 2;
  const halfSpanZWorldUnits = Math.max(rect.maxWorldZ - rect.minWorldZ, minimumSpanWorldUnits) / 2;
  const centreWorldX = (rect.minWorldX + rect.maxWorldX) / 2;
  const centreWorldZ = (rect.minWorldZ + rect.maxWorldZ) / 2;
  return {
    minWorldX: Math.min(rect.minWorldX, centreWorldX - halfSpanXWorldUnits),
    maxWorldX: Math.max(rect.maxWorldX, centreWorldX + halfSpanXWorldUnits),
    minWorldZ: Math.min(rect.minWorldZ, centreWorldZ - halfSpanZWorldUnits),
    maxWorldZ: Math.max(rect.maxWorldZ, centreWorldZ + halfSpanZWorldUnits),
  };
}
