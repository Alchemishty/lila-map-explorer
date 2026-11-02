import { DataContractError } from "./contract";
import type { ActorTrack } from "./types";

/** Player trail colors, handed out in order of each player's first timestamp and cycled after the last. */
export const playerTrailPalette: readonly string[] = [
  "#22d3ee",
  "#f472b6",
  "#a3e635",
  "#fb923c",
  "#818cf8",
  "#2dd4bf",
];

export const botTrailColor = "#cbd5e1";

export interface ActorTrailColor {
  readonly color: string;
  readonly isDashed: boolean;
}

interface PlayerStart {
  readonly actorKey: string;
  readonly firstTimestampSeconds: number;
}

function comparePlayerStarts(firstPlayer: PlayerStart, secondPlayer: PlayerStart): number {
  if (firstPlayer.firstTimestampSeconds !== secondPlayer.firstTimestampSeconds) {
    return firstPlayer.firstTimestampSeconds - secondPlayer.firstTimestampSeconds;
  }
  return firstPlayer.actorKey < secondPlayer.actorKey ? -1 : 1;
}

/**
 * Trail color for each actor of one match, keyed by actorKey. Players get the palette in order of
 * their first timestamp (ties by actorKey), cycling after six. Bots are dashed grey.
 */
export function assignActorColors(tracks: readonly ActorTrack[]): Map<string, ActorTrailColor> {
  const actorColorsByKey = new Map<string, ActorTrailColor>();
  const seenActorKeys = new Set<string>();
  const playerStarts: PlayerStart[] = [];
  for (const track of tracks) {
    if (seenActorKeys.has(track.actorKey)) {
      throw new DataContractError(
        `Actor key "${track.actorKey}" appears in more than one track of the match`,
      );
    }
    seenActorKeys.add(track.actorKey);
    if (!track.isPlayer) {
      actorColorsByKey.set(track.actorKey, { color: botTrailColor, isDashed: true });
      continue;
    }
    const firstTimestampSeconds = track.timestampSeconds[0];
    if (firstTimestampSeconds === undefined) {
      throw new DataContractError(
        `Actor "${track.actorKey}" is a player with no rows, so it has no first timestamp to order its trail color by`,
      );
    }
    playerStarts.push({ actorKey: track.actorKey, firstTimestampSeconds });
  }
  playerStarts.sort(comparePlayerStarts);
  playerStarts.forEach((playerStart, playerIndex) => {
    const paletteColor = playerTrailPalette[playerIndex % playerTrailPalette.length];
    if (paletteColor === undefined) {
      throw new Error(
        `Player trail palette has no color at index ${playerIndex % playerTrailPalette.length}`,
      );
    }
    actorColorsByKey.set(playerStart.actorKey, { color: paletteColor, isDashed: false });
  });
  return actorColorsByKey;
}
