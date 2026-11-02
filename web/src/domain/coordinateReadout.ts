import { worldToPixel } from "./coordinates";
import type { MapConfig, WorldPoint } from "./types";

// The world-position readout: what the designer reads off the map and pastes into their level
// editor. The point itself stays at full precision; only the text shown and copied is rounded, to one
// decimal place, because a pointer position is not more exact than that (about one world unit per
// screen pixel at the default zoom).

export interface WorldReadout {
  readonly worldXText: string;
  readonly worldZText: string;
  /** "X, Z", exactly as shown, so what the designer sees is what they paste. */
  readonly copyText: string;
}

const shownDecimalPlaces = 1;

export function formatWorldCoordinate(worldValue: number): string {
  if (!Number.isFinite(worldValue)) {
    throw new Error(
      `The world coordinate ${worldValue} is not a finite number, so it cannot be shown`,
    );
  }
  const shownText = worldValue.toFixed(shownDecimalPlaces);
  // -0.04 rounds to "-0.0": a minus sign on zero would be pasted into the editor as-is.
  return Number(shownText) === 0 ? (0).toFixed(shownDecimalPlaces) : shownText;
}

export function formatWorldPointForCopy(point: WorldPoint): string {
  return `${formatWorldCoordinate(point.worldX)}, ${formatWorldCoordinate(point.worldZ)}`;
}

/** True when the point lies on the minimap image, edges included (enforcement/coordinate-spaces.md). */
export function isWorldPointOnMinimap(point: WorldPoint, map: MapConfig): boolean {
  const pixelPoint = worldToPixel(point, map);
  return (
    pixelPoint.pixelX >= 0 &&
    pixelPoint.pixelX <= map.imageWidthPixels &&
    pixelPoint.pixelY >= 0 &&
    pixelPoint.pixelY <= map.imageHeightPixels
  );
}

/** The readout for a point, or null past the minimap edge, where the data has nothing to say. */
export function describeWorldReadout(point: WorldPoint, map: MapConfig): WorldReadout | null {
  if (!isWorldPointOnMinimap(point, map)) {
    return null;
  }
  return {
    worldXText: formatWorldCoordinate(point.worldX),
    worldZText: formatWorldCoordinate(point.worldZ),
    copyText: formatWorldPointForCopy(point),
  };
}
