import { describe, expect, it } from "vitest";
import { pixelToWorld, worldToPixel } from "./coordinates";
import type { MapConfig, WorldPoint } from "./types";

function buildAmbroseValleyConfig(imageSizePixels: number): MapConfig {
  return {
    mapId: "AmbroseValley",
    imageUrl: "data/minimaps/AmbroseValley.jpg",
    imageWidthPixels: imageSizePixels,
    imageHeightPixels: imageSizePixels,
    worldScale: 900,
    worldOriginX: -370,
    worldOriginZ: -473,
  };
}

const grandRiftConfig: MapConfig = {
  mapId: "GrandRift",
  imageUrl: "data/minimaps/GrandRift.jpg",
  imageWidthPixels: 2160,
  imageHeightPixels: 2158,
  worldScale: 581,
  worldOriginX: -290,
  worldOriginZ: -290,
};

const readmeWorldPoint: WorldPoint = { worldX: -301.45, worldZ: -355.55 };

describe("worldToPixel", () => {
  it("maps the README example on a 1024 px AmbroseValley image to (78, 890)", () => {
    const pixelPoint = worldToPixel(readmeWorldPoint, buildAmbroseValleyConfig(1024));
    expect(pixelPoint.pixelX).toBeCloseTo(77.995, 2);
    expect(pixelPoint.pixelY).toBeCloseTo(890.37, 2);
  });

  it("scales the same point to a 4320 px image", () => {
    const pixelPoint = worldToPixel(readmeWorldPoint, buildAmbroseValleyConfig(4320));
    expect(pixelPoint.pixelX).toBeCloseTo(329.04, 2);
    expect(pixelPoint.pixelY).toBeCloseTo(3756.24, 2);
  });

  it("uses width and height separately on the non-square GrandRift image, edges included", () => {
    const bottomLeftPixel = worldToPixel({ worldX: -290, worldZ: -290 }, grandRiftConfig);
    expect(bottomLeftPixel.pixelX).toBeCloseTo(0, 6);
    expect(bottomLeftPixel.pixelY).toBeCloseTo(2158, 6);

    const topRightPixel = worldToPixel({ worldX: 291, worldZ: 291 }, grandRiftConfig);
    expect(topRightPixel.pixelX).toBeCloseTo(2160, 6);
    expect(topRightPixel.pixelY).toBeCloseTo(0, 6);
  });
});

describe("pixelToWorld", () => {
  it("inverts worldToPixel on square and non-square images", () => {
    const roundTripWorldPointsAndMapConfigs: readonly [WorldPoint, MapConfig][] = [
      [readmeWorldPoint, buildAmbroseValleyConfig(4096)],
      [{ worldX: 12.5, worldZ: -100.25 }, grandRiftConfig],
      [{ worldX: 291, worldZ: -290 }, grandRiftConfig],
    ];
    for (const [worldPoint, mapConfig] of roundTripWorldPointsAndMapConfigs) {
      const roundTripWorldPoint = pixelToWorld(worldToPixel(worldPoint, mapConfig), mapConfig);
      expect(roundTripWorldPoint.worldX).toBeCloseTo(worldPoint.worldX, 9);
      expect(roundTripWorldPoint.worldZ).toBeCloseTo(worldPoint.worldZ, 9);
    }
  });

  it("maps the image's top-left pixel to the world's minimum x and maximum z", () => {
    const worldPoint = pixelToWorld({ pixelX: 0, pixelY: 0 }, grandRiftConfig);
    expect(worldPoint.worldX).toBeCloseTo(-290, 9);
    expect(worldPoint.worldZ).toBeCloseTo(291, 9);
  });
});
