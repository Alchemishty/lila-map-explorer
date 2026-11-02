import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHeatGrid } from "../domain/heatmap";
import type { MapConfig } from "../domain/types";
import { createScene, emptySceneLayers } from "./scene";
import { createFakeMapView, createFakeOverlay } from "./sceneTestFixtures";

// The heat raster is built from a grid once and reused on every redraw: the scene redraws
// on every pan and zoom step, and rebuilding then would stall.
const rasterLog = vi.hoisted(() => ({ createdFor: [] as unknown[], drawnCount: 0 }));
vi.mock("./drawHeatmap", () => ({
  createHeatRaster: (grid: unknown, colorTopValue: number) => {
    rasterLog.createdFor.push(grid);
    return { grid, colorTopValue, image: "raster" };
  },
  drawHeatRaster: () => {
    rasterLog.drawnCount += 1;
  },
}));

vi.mock("./drawMarkers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drawMarkers")>()),
  drawMarker: () => undefined,
}));

const testMap: MapConfig = {
  mapId: "Test",
  imageUrl: "data/minimaps/Test.jpg",
  imageWidthPixels: 100,
  imageHeightPixels: 100,
  worldScale: 40,
  worldOriginX: 0,
  worldOriginZ: 0,
};

beforeEach(() => {
  rasterLog.createdFor.length = 0;
  rasterLog.drawnCount = 0;
});

describe("createScene heat raster cache", () => {
  it("builds the raster once for a grid, however many redraws and repeated setLayers follow", () => {
    const fakeMapView = createFakeMapView();
    const scene = createScene(
      fakeMapView,
      createFakeOverlay(() => undefined),
    );
    const heatGrid = createHeatGrid(testMap, 4);
    scene.setLayers({ ...emptySceneLayers, heatGrid, heatColorTopValue: 3 });
    fakeMapView.fireRedraw();
    fakeMapView.fireRedraw();
    fakeMapView.fireRedraw();
    scene.setLayers({ ...emptySceneLayers, heatGrid, heatColorTopValue: 3 });

    expect(rasterLog.createdFor).toEqual([heatGrid]);
    expect(rasterLog.drawnCount).toBe(5);
  });

  it("builds a new raster when a different grid arrives, and none when the heatmap is off", () => {
    const fakeMapView = createFakeMapView();
    const scene = createScene(
      fakeMapView,
      createFakeOverlay(() => undefined),
    );
    const firstGrid = createHeatGrid(testMap, 4);
    const secondGrid = createHeatGrid(testMap, 4);
    scene.setLayers({ ...emptySceneLayers, heatGrid: firstGrid, heatColorTopValue: 3 });
    scene.setLayers({ ...emptySceneLayers, heatGrid: secondGrid, heatColorTopValue: 3 });
    scene.setLayers(emptySceneLayers);
    fakeMapView.fireRedraw();

    expect(rasterLog.createdFor).toEqual([firstGrid, secondGrid]);
    expect(rasterLog.drawnCount).toBe(2);
  });

  it("builds a new raster for the same grid when its colour top changes", () => {
    const scene = createScene(
      createFakeMapView(),
      createFakeOverlay(() => undefined),
    );
    const heatGrid = createHeatGrid(testMap, 4);
    scene.setLayers({ ...emptySceneLayers, heatGrid, heatColorTopValue: 3 });
    scene.setLayers({ ...emptySceneLayers, heatGrid, heatColorTopValue: 5 });

    expect(rasterLog.createdFor).toEqual([heatGrid, heatGrid]);
  });

  it("throws when a heat grid comes without a colour top, or the reverse", () => {
    const scene = createScene(
      createFakeMapView(),
      createFakeOverlay(() => undefined),
    );
    const heatGrid = createHeatGrid(testMap, 4);
    expect(() =>
      scene.setLayers({ ...emptySceneLayers, heatGrid, heatColorTopValue: null }),
    ).toThrowError(/a heat grid or a heat colour top, but not both/);
    expect(() => scene.setLayers({ ...emptySceneLayers, heatColorTopValue: 3 })).toThrowError(
      /not both/,
    );
  });
});
