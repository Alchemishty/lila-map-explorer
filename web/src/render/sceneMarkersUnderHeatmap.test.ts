import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapEvent } from "../domain/events";
import { createHeatGrid } from "../domain/heatmap";
import { traceHeatContour } from "../domain/heatmapContour";
import type { MapConfig, MarkerStyle } from "../domain/types";
import { fullMarkerAppearance, markerUnderHeatmapAppearance } from "./drawMarkers";
import { createScene, emptySceneLayers, type SceneLayers } from "./scene";
import {
  buildFullLayers,
  buildLootEvent,
  createFakeMapView,
  createFakeOverlay as createFakeOverlayLoggingTo,
  lootMarker,
} from "./sceneTestFixtures";

// Every draw function is replaced by a spy that logs its name and arguments in one shared log, so
// the tests see the draw order, each marker's appearance and the outline the scene passes.
const drawLog = vi.hoisted(() => [] as { drawName: string; drawArguments: unknown[] }[]);
const contourCallCount = vi.hoisted(() => ({ value: 0 }));
vi.mock("./drawHeatmap", () => ({
  createHeatRaster: (grid: unknown) => ({ grid, image: "raster" }),
  drawHeatRaster: () => drawLog.push({ drawName: "heatmap", drawArguments: [] }),
}));
vi.mock("./drawHeatmapOutline", () => ({
  drawHeatmapOutline: (_context: unknown, segments: unknown) =>
    drawLog.push({ drawName: "outline", drawArguments: [segments] }),
}));
vi.mock("../domain/heatmapContour", async (importOriginal) => {
  const original = await importOriginal<typeof import("../domain/heatmapContour")>();
  return {
    ...original,
    traceHeatContour: (...contourArguments: Parameters<typeof original.traceHeatContour>) => {
      contourCallCount.value += 1;
      return original.traceHeatContour(...contourArguments);
    },
  };
});
vi.mock("./drawTrails", () => ({
  drawTrail: () => drawLog.push({ drawName: "trail", drawArguments: [] }),
}));
vi.mock("./drawMarkers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drawMarkers")>()),
  drawMarker: (_context: unknown, _at: unknown, style: { label: string }, appearance: unknown) =>
    drawLog.push({ drawName: "marker", drawArguments: [style.label, appearance] }),
}));
vi.mock("./drawSelection", () => ({
  drawSelectionArea: () => drawLog.push({ drawName: "selection", drawArguments: [] }),
}));

function createFakeOverlay() {
  return createFakeOverlayLoggingTo(() => drawLog.push({ drawName: "clear", drawArguments: [] }));
}

const tinyMap: MapConfig = {
  mapId: "Tiny",
  imageUrl: "data/minimaps/Tiny.jpg",
  imageWidthPixels: 100,
  imageHeightPixels: 100,
  worldScale: 40,
  worldOriginX: 0,
  worldOriginZ: 0,
};
const killMarker: MarkerStyle = {
  label: "Kill",
  shape: "square",
  fill: "#ef4444",
  cross: "#ffffff",
  outline: "solid",
};

function buildKillEvent(): MapEvent {
  return {
    ...buildLootEvent("player-a", { worldX: 12, worldZ: -10 }),
    eventCode: "BotKill",
    category: "kill",
    markerKey: "kill_bot",
  };
}

/** A 10 × 10 grid with one busy cell, and a colour top equal to it. */
function buildHotLayers(): SceneLayers {
  const heatGrid = createHeatGrid(tinyMap, 4);
  heatGrid.values[4 * heatGrid.columnCount + 5] = 10;
  return { ...emptySceneLayers, heatGrid, heatColorTopValue: 10 };
}

beforeEach(() => {
  drawLog.length = 0;
  contourCallCount.value = 0;
});

describe("markers over a heatmap", () => {
  it("draw full size without a heatmap and smaller and faded with one", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    const { markers } = buildFullLayers();
    scene.setLayers({ ...emptySceneLayers, markers });
    const appearancesWithout = drawLog.filter((entry) => entry.drawName === "marker");
    expect(appearancesWithout.map((entry) => entry.drawArguments[1])).toEqual([
      fullMarkerAppearance,
      fullMarkerAppearance,
    ]);
    drawLog.length = 0;
    scene.setLayers({ ...buildHotLayers(), markers });
    const appearancesWith = drawLog.filter((entry) => entry.drawName === "marker");
    expect(appearancesWith.map((entry) => entry.drawArguments[1])).toEqual([
      markerUnderHeatmapAppearance,
      markerUnderHeatmapAppearance,
    ]);
  });

  it("draw loot beneath every other marker, whatever order they arrive in", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    const lootEvent = buildLootEvent("player-a", { worldX: 10, worldZ: -10 });
    scene.setLayers({
      ...emptySceneLayers,
      markers: [
        { event: buildKillEvent(), style: killMarker },
        { event: lootEvent, style: lootMarker },
        { event: buildKillEvent(), style: killMarker },
      ],
    });
    const drawnLabels = drawLog
      .filter((entry) => entry.drawName === "marker")
      .map((entry) => entry.drawArguments[0]);
    expect(drawnLabels).toEqual(["Loot", "Kill", "Kill"]);
  });
});

describe("the busiest zones' outline", () => {
  it("traces the grid at 0.65 of the colour top, drawn over the markers and under the selection", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    const fullLayers = buildFullLayers();
    const hotLayers = buildHotLayers();
    scene.setLayers({ ...fullLayers, heatGrid: hotLayers.heatGrid, heatColorTopValue: 10 });
    expect(drawLog.map((entry) => entry.drawName)).toEqual([
      "clear",
      "heatmap",
      "trail",
      "trail",
      "trail",
      "marker",
      "marker",
      "outline",
      "selection",
    ]);
    const outlineEntry = drawLog.find((entry) => entry.drawName === "outline");
    if (hotLayers.heatGrid === null) {
      throw new Error("The hot layers have no heat grid");
    }
    expect(outlineEntry?.drawArguments[0]).toEqual(traceHeatContour(hotLayers.heatGrid, 6.5));
  });

  it("traces once per grid and colour top, however many redraws follow", () => {
    const fakeMapView = createFakeMapView();
    const scene = createScene(fakeMapView, createFakeOverlay());
    const hotLayers = buildHotLayers();
    scene.setLayers(hotLayers);
    fakeMapView.fireRedraw();
    scene.setLayers(hotLayers);
    expect(contourCallCount.value).toBe(1);
    expect(drawLog.filter((entry) => entry.drawName === "outline")).toHaveLength(3);
    scene.setLayers({ ...hotLayers, heatColorTopValue: 20 });
    expect(contourCallCount.value).toBe(2);
  });

  it("is not drawn for an empty grid, a grid with no busiest zone, or no heatmap", () => {
    const scene = createScene(createFakeMapView(), createFakeOverlay());
    const emptyGrid = createHeatGrid(tinyMap, 4);
    scene.setLayers({ ...emptySceneLayers, heatGrid: emptyGrid, heatColorTopValue: 0 });
    // A raised colour top: the busiest cell (10) is below 0.65 of the top (50).
    scene.setLayers({ ...buildHotLayers(), heatColorTopValue: 50 });
    scene.setLayers(emptySceneLayers);
    expect(drawLog.filter((entry) => entry.drawName === "outline")).toEqual([]);
  });
});
