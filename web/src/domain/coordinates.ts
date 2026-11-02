import type { MapConfig, PixelPoint, WorldPoint } from "./types";

// The only crossing between world and image-pixel space (enforcement/coordinate-spaces.md).
// u and v are fractions of the minimap (0 to 1, edges included); image y grows downward, so v flips.

export function worldToPixel(point: WorldPoint, map: MapConfig): PixelPoint {
  const minimapFractionX = (point.worldX - map.worldOriginX) / map.worldScale;
  const minimapFractionZ = (point.worldZ - map.worldOriginZ) / map.worldScale;
  return {
    pixelX: minimapFractionX * map.imageWidthPixels,
    pixelY: (1 - minimapFractionZ) * map.imageHeightPixels,
  };
}

export function pixelToWorld(point: PixelPoint, map: MapConfig): WorldPoint {
  const minimapFractionX = point.pixelX / map.imageWidthPixels;
  const minimapFractionZ = 1 - point.pixelY / map.imageHeightPixels;
  return {
    worldX: minimapFractionX * map.worldScale + map.worldOriginX,
    worldZ: minimapFractionZ * map.worldScale + map.worldOriginZ,
  };
}
