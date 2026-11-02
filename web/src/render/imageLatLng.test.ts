import { describe, expect, it } from "vitest";
import type { MapConfig } from "../domain/types";
import { imageBoundsFor, imageLatLngToPixel, pixelToImageLatLng } from "./imageLatLng";

const grandRiftConfig: MapConfig = {
  mapId: "GrandRift",
  imageUrl: "data/minimaps/GrandRift.jpg",
  imageWidthPixels: 2160,
  imageHeightPixels: 2158,
  worldScale: 581,
  worldOriginX: -290,
  worldOriginZ: -290,
};

describe("image LatLng mapping (Leaflet CRS.Simple)", () => {
  it("bounds the non-square GrandRift image as [[0, 0], [height, width]]", () => {
    expect(imageBoundsFor(grandRiftConfig)).toEqual([
      [0, 0],
      [2158, 2160],
    ]);
  });

  it("flips the image y axis: latitude = height − pixelY, longitude = pixelX", () => {
    expect(pixelToImageLatLng({ pixelX: 0, pixelY: 0 }, grandRiftConfig)).toEqual([2158, 0]);
    expect(pixelToImageLatLng({ pixelX: 2160, pixelY: 2158 }, grandRiftConfig)).toEqual([0, 2160]);
    expect(pixelToImageLatLng({ pixelX: 100.25, pixelY: 58.5 }, grandRiftConfig)).toEqual([
      2099.5, 100.25,
    ]);
  });

  it("maps a LatLng back to the same pixel", () => {
    expect(imageLatLngToPixel(2099.5, 100.25, grandRiftConfig)).toEqual({
      pixelX: 100.25,
      pixelY: 58.5,
    });
  });
});
