import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldPoint } from "../domain/types";
import { createScene, emptySceneLayers } from "./scene";
import {
  buildFullLayers,
  buildLootEvent,
  createFakeMapView,
  createFakeOverlay as createFakeOverlayLoggingTo,
  farLoot,
  lootMarker,
  nearLoot,
} from "./sceneTestFixtures";

// Every draw function is replaced by a spy that records its name and canvas arguments in one shared
// log, so the tests see the draw order and the canvas positions the scene computed.
const drawLog = vi.hoisted(() => [] as { drawName: string; canvasArguments: unknown[] }[]);
vi.mock("./drawHeatmap", () => ({
  createHeatRaster: (grid: unknown) => ({ grid, image: "raster" }),
  drawHeatRaster: (_context: unknown, raster: { grid: unknown }) =>
    drawLog.push({ drawName: "heatmap", canvasArguments: [raster.grid] }),
}));
vi.mock("./drawTrails", () => ({
  drawTrail: (_context: unknown, points: unknown, head: unknown) =>
    drawLog.push({ drawName: "trail", canvasArguments: [points, head] }),
}));
vi.mock("./drawMarkers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drawMarkers")>()),
  drawMarker: (_context: unknown, at: unknown, style: { label: string }) =>
    drawLog.push({ drawName: "marker", canvasArguments: [at, style.label] }),
}));
vi.mock("./drawSelection", () => ({
  drawSelectionArea: (_context: unknown, firstCorner: unknown, oppositeCorner: unknown) =>
    drawLog.push({ drawName: "selection", canvasArguments: [firstCorner, oppositeCorner] }),
}));

/** A fake overlay whose clears go into the shared draw log. */
function createFakeOverlay() {
  return createFakeOverlayLoggingTo(() => drawLog.push({ drawName: "clear", canvasArguments: [] }));
}

beforeEach(() => {
  drawLog.length = 0;
});

describe("createScene", () => {
  it("clears once, then draws heatmap, trails, markers and selection in that order", () => {
    const fakeOverlay = createFakeOverlay();
    const scene = createScene(createFakeMapView(), fakeOverlay);
    scene.setLayers(buildFullLayers());
    expect(drawLog.map((entry) => entry.drawName)).toEqual([
      "clear",
      "heatmap",
      "trail",
      "trail",
      "trail",
      "marker",
      "marker",
      "selection",
    ]);
    expect(fakeOverlay.clearCount).toBe(1);
  });

  it("converts trails, heads, markers and the selection to canvas points", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    scene.setLayers(buildFullLayers());
    const trailArguments = drawLog
      .filter((entry) => entry.drawName === "trail")
      .map((entry) => entry.canvasArguments);
    expect(trailArguments).toEqual([
      [
        [
          { canvasX: 2, canvasY: 2 },
          { canvasX: 4, canvasY: 6 },
        ],
        { at: { canvasX: 6, canvasY: 8 }, state: "moving" },
      ],
      [[], { at: { canvasX: 80, canvasY: 80 }, state: "last_seen" }],
      [[], null],
    ]);
    const selectionEntry = drawLog.find((entry) => entry.drawName === "selection");
    expect(selectionEntry?.canvasArguments).toEqual([
      { canvasX: 10, canvasY: 40 },
      { canvasX: 30, canvasY: 20 },
    ]);
  });

  it("redraws everything at the new canvas positions when the view moves", () => {
    const fakeMapView = createFakeMapView();
    const fakeOverlay = createFakeOverlay();
    const scene = createScene(fakeMapView, fakeOverlay);
    scene.setLayers(buildFullLayers());
    drawLog.length = 0;
    fakeMapView.canvasPixelsPerWorldUnit = 3;
    fakeMapView.canvasOffsetX = 100;
    fakeMapView.fireRedraw();
    expect(fakeOverlay.clearCount).toBe(2);
    expect(drawLog.map((entry) => entry.drawName)).toEqual([
      "clear",
      "heatmap",
      "trail",
      "trail",
      "trail",
      "marker",
      "marker",
      "selection",
    ]);
    const markerPositions = drawLog
      .filter((entry) => entry.drawName === "marker")
      .map((entry) => entry.canvasArguments[0]);
    expect(markerPositions).toEqual([
      { canvasX: 142, canvasY: 30 },
      { canvasX: 130, canvasY: 30 },
    ]);
  });

  it("converts marker positions with one converter per redraw, not one map call per marker", () => {
    const fakeMapView = createFakeMapView();
    const scene = createScene(fakeMapView, createFakeOverlay());
    scene.setLayers({ ...emptySceneLayers, markers: buildFullLayers().markers });
    fakeMapView.fireRedraw();
    expect(fakeMapView.converterCount).toBe(2);
    expect(fakeMapView.worldToCanvasPointCallCount).toBe(0);
  });

  it("draws each marker as its own style's shape", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    scene.setLayers({ ...emptySceneLayers, markers: buildFullLayers().markers });
    const markerEntries = drawLog.filter((entry) => entry.drawName === "marker");
    expect(markerEntries.map((entry) => entry.canvasArguments[1])).toEqual(["Loot", "Loot"]);
  });

  it("asks for no converter when there are no markers, as before any map is shown", () => {
    const fakeMapView = createFakeMapView();
    const scene = createScene(fakeMapView, createFakeOverlay());
    scene.setLayers(emptySceneLayers);
    expect(fakeMapView.converterCount).toBe(0);
  });

  it("skips markers that lie wholly outside the 200 × 200 canvas", () => {
    // A marker reaches 10 px from its center (half its 20 px swatch), so centers from -10 to 210 draw.
    const markerPositions: readonly WorldPoint[] = [
      { worldX: -5.5, worldZ: -50 }, // canvas (-11, 100): skipped
      { worldX: -4.5, worldZ: -50 }, // canvas (-9, 100)
      { worldX: 104.5, worldZ: -50 }, // canvas (209, 100)
      { worldX: 105.5, worldZ: -50 }, // canvas (211, 100): skipped
      { worldX: 50, worldZ: 5.5 }, // canvas (100, -11): skipped
      { worldX: 50, worldZ: -104.5 }, // canvas (100, 209)
      { worldX: 50, worldZ: -105.5 }, // canvas (100, 211): skipped
    ];
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    scene.setLayers({
      ...emptySceneLayers,
      markers: markerPositions.map((position) => ({
        event: buildLootEvent("player-a", position),
        style: lootMarker,
      })),
    });
    expect(
      drawLog
        .filter((entry) => entry.drawName === "marker")
        .map((entry) => entry.canvasArguments[0]),
    ).toEqual([
      { canvasX: -9, canvasY: 100 },
      { canvasX: 209, canvasY: 100 },
      { canvasX: 100, canvasY: 209 },
    ]);
  });

  it("replaces every layer on setLayers, so empty layers draw nothing after a clear", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    scene.setLayers(buildFullLayers());
    drawLog.length = 0;
    scene.setLayers(emptySceneLayers);
    expect(drawLog.map((entry) => entry.drawName)).toEqual(["clear"]);
  });
});

describe("Scene hit tests", () => {
  it("findMarkersNear returns the nearest marker within the radius and nothing outside it", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    scene.setLayers(buildFullLayers());
    expect(scene.findMarkersNear({ canvasX: 23, canvasY: 20 }, 12)).toEqual([nearLoot]);
    expect(scene.findMarkersNear({ canvasX: 26, canvasY: 21 }, 12)).toEqual([farLoot]);
    expect(scene.findMarkersNear({ canvasX: 20, canvasY: 33 }, 12)).toEqual([]);
    expect(scene.findMarkersNear({ canvasX: 20, canvasY: 32 }, 12)).toEqual([nearLoot]);
  });

  it("findMarkersNear returns every marker at the nearest one's world position, in time order", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    const stackSpot = { worldX: 10, worldZ: -10 }; // canvas (20, 20)
    const lateLoot = { ...buildLootEvent("player-a", stackSpot), timestampSeconds: 1_770_000_030 };
    const earlyLoot = { ...buildLootEvent("player-b", stackSpot), timestampSeconds: 1_770_000_005 };
    const middleLoot = buildLootEvent("player-c", stackSpot);
    const nearbyLoot = buildLootEvent("player-d", { worldX: 10.5, worldZ: -10 }); // canvas (21, 20)
    const markers = [lateLoot, nearbyLoot, earlyLoot, middleLoot].map((event) => ({
      event,
      style: lootMarker,
    }));
    scene.setLayers({ ...emptySceneLayers, markers });
    const stackTap = { canvasX: 20, canvasY: 21 };
    expect(scene.findMarkersNear(stackTap, 12)).toEqual([earlyLoot, middleLoot, lateLoot]);
    expect(scene.findMarkersNear({ canvasX: 22, canvasY: 20 }, 12)).toEqual([nearbyLoot]);
    expect(scene.findMarkersNear({ canvasX: 100, canvasY: 100 }, 12)).toEqual([]);
  });

  it("hit tests at the canvas positions after the view moves", () => {
    const fakeMapView = createFakeMapView();
    const scene = createScene(fakeMapView, createFakeOverlay());
    scene.setLayers(buildFullLayers());
    fakeMapView.canvasOffsetX = 100;
    expect(scene.findMarkersNear({ canvasX: 20, canvasY: 20 }, 12)).toEqual([]);
    expect(scene.findMarkersNear({ canvasX: 120, canvasY: 20 }, 12)).toEqual([nearLoot]);
  });

  it("findTrailHeadNear returns the nearest actor key and skips trails without a head", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    scene.setLayers(buildFullLayers());
    expect(scene.findTrailHeadNear({ canvasX: 7, canvasY: 8 }, 12)).toBe("player-a");
    expect(scene.findTrailHeadNear({ canvasX: 78, canvasY: 82 }, 12)).toBe("bot:7");
    expect(scene.findTrailHeadNear({ canvasX: 0, canvasY: 0 }, 2)).toBeNull();
  });

  it("refuses a radius that is negative or not a number", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    expect(() => scene.findMarkersNear({ canvasX: 0, canvasY: 0 }, -1)).toThrow("radius");
    expect(() => scene.findTrailHeadNear({ canvasX: 0, canvasY: 0 }, Number.NaN)).toThrow("radius");
  });
});
