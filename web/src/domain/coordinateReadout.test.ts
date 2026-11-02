import { describe, expect, it } from "vitest";
import {
  describeWorldReadout,
  formatWorldCoordinate,
  formatWorldPointForCopy,
  isWorldPointOnMinimap,
} from "./coordinateReadout";
import type { MapConfig } from "./types";

// GrandRift's real config: the image is not square (2160 × 2158).
const grandRiftConfig: MapConfig = {
  mapId: "GrandRift",
  imageUrl: "unused.png",
  imageWidthPixels: 2160,
  imageHeightPixels: 2158,
  worldScale: 581,
  worldOriginX: -290,
  worldOriginZ: -290,
};

describe("formatWorldCoordinate", () => {
  it("shows one decimal place", () => {
    expect(formatWorldCoordinate(-142.64)).toBe("-142.6");
    expect(formatWorldCoordinate(318)).toBe("318.0");
    expect(formatWorldCoordinate(12.96)).toBe("13.0");
  });

  it("never shows a minus sign on zero", () => {
    expect(formatWorldCoordinate(-0.04)).toBe("0.0");
    expect(formatWorldCoordinate(-0)).toBe("0.0");
  });

  it("throws for a value that is not a finite number", () => {
    expect(() => formatWorldCoordinate(Number.NaN)).toThrow(/not a finite number/);
    expect(() => formatWorldCoordinate(Number.POSITIVE_INFINITY)).toThrow(/not a finite number/);
  });
});

describe("formatWorldPointForCopy", () => {
  it("gives X then Z exactly as the readout shows them", () => {
    expect(formatWorldPointForCopy({ worldX: -142.64, worldZ: 318 })).toBe("-142.6, 318.0");
  });
});

describe("isWorldPointOnMinimap", () => {
  it("counts points exactly on each edge as on the minimap (non-square GrandRift)", () => {
    expect(isWorldPointOnMinimap({ worldX: -290, worldZ: -290 }, grandRiftConfig)).toBe(true);
    expect(isWorldPointOnMinimap({ worldX: 291, worldZ: 291 }, grandRiftConfig)).toBe(true);
    expect(isWorldPointOnMinimap({ worldX: 0, worldZ: 0 }, grandRiftConfig)).toBe(true);
  });

  it("rejects points just past any edge", () => {
    expect(isWorldPointOnMinimap({ worldX: -290.01, worldZ: 0 }, grandRiftConfig)).toBe(false);
    expect(isWorldPointOnMinimap({ worldX: 291.01, worldZ: 0 }, grandRiftConfig)).toBe(false);
    expect(isWorldPointOnMinimap({ worldX: 0, worldZ: -290.01 }, grandRiftConfig)).toBe(false);
    expect(isWorldPointOnMinimap({ worldX: 0, worldZ: 291.01 }, grandRiftConfig)).toBe(false);
  });
});

describe("describeWorldReadout", () => {
  it("gives the shown X and Z text and the copy text for a point on the minimap", () => {
    expect(describeWorldReadout({ worldX: -142.64, worldZ: 218 }, grandRiftConfig)).toEqual({
      worldXText: "-142.6",
      worldZText: "218.0",
      copyText: "-142.6, 218.0",
    });
  });

  it("gives null for a point past the minimap edge, so no number is shown", () => {
    expect(describeWorldReadout({ worldX: 400, worldZ: 0 }, grandRiftConfig)).toBeNull();
  });
});
