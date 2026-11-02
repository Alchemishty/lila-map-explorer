import { afterEach, describe, expect, it } from "vitest";
import type { MapConfig } from "../domain/types";
import { createMapView, type MapView } from "./mapView";

// Runs in headless Chromium: MapView.saveView and restoreView bring a view back exactly, even after
// the container changed size, and refuse a view saved on another minimap. showWholeMap fits the
// whole image again.

const onePixelPngUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** GrandRift's real config: its web image is 2160 × 2158, not square. */
const grandRiftConfig: MapConfig = {
  mapId: "GrandRift",
  imageUrl: onePixelPngUrl,
  imageWidthPixels: 2160,
  imageHeightPixels: 2158,
  worldScale: 581,
  worldOriginX: -290,
  worldOriginZ: -290,
};

const mountedContainers: HTMLElement[] = [];

afterEach(() => {
  for (const container of mountedContainers.splice(0)) {
    container.remove();
  }
});

function mountMapView(): { mapView: MapView; container: HTMLElement } {
  const container = document.createElement("div");
  container.style.width = "600px";
  container.style.height = "400px";
  document.body.appendChild(container);
  mountedContainers.push(container);
  const mapView = createMapView(container);
  mapView.showMap(grandRiftConfig);
  return { mapView, container };
}

describe("MapView view memory", () => {
  it("restores the saved centre and zoom after other moves and a container resize", () => {
    const { mapView, container } = mountMapView();
    const spot = { worldX: 120, worldZ: -40 };
    mapView.fitWorldRect(
      { minWorldX: 100, maxWorldX: 140, minWorldZ: -60, maxWorldZ: -20 },
      { topCssPixels: 0, rightCssPixels: 0, bottomCssPixels: 0, leftCssPixels: 0 },
    );
    const savedView = mapView.saveView();
    const spotCanvasPointBefore = mapView.worldToCanvasPoint(spot);
    mapView.showWholeMap();
    container.style.height = "340px";
    mapView.restoreView(savedView);
    const spotCanvasPointAfter = mapView.worldToCanvasPoint(spot);
    // The centre is kept, so on a 60 px shorter map the spot sits 30 px higher.
    expect(spotCanvasPointAfter.canvasX).toBeCloseTo(spotCanvasPointBefore.canvasX, 6);
    expect(spotCanvasPointAfter.canvasY).toBeCloseTo(spotCanvasPointBefore.canvasY - 30, 6);
    expect(mapView.saveView().zoomLevel).toBeCloseTo(savedView.zoomLevel, 9);
  });

  it("shows the whole image again", () => {
    const { mapView } = mountMapView();
    const wholeMapView = mapView.saveView();
    mapView.fitWorldRect(
      { minWorldX: 100, maxWorldX: 140, minWorldZ: -60, maxWorldZ: -20 },
      { topCssPixels: 0, rightCssPixels: 0, bottomCssPixels: 0, leftCssPixels: 0 },
    );
    mapView.showWholeMap();
    expect(mapView.saveView().zoomLevel).toBeCloseTo(wholeMapView.zoomLevel, 9);
    expect(mapView.saveView().centerWorld.worldX).toBeCloseTo(wholeMapView.centerWorld.worldX, 6);
    expect(mapView.saveView().centerWorld.worldZ).toBeCloseTo(wholeMapView.centerWorld.worldZ, 6);
  });

  it("refuses a view saved on another minimap", () => {
    const { mapView } = mountMapView();
    const otherMapView = { ...mapView.saveView(), mapId: "Lockdown" };
    expect(() => mapView.restoreView(otherMapView)).toThrow(
      'A view saved on map "Lockdown" cannot be restored while map "GrandRift" is shown',
    );
  });
});
