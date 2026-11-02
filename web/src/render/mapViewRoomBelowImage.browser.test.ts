import { afterEach, describe, expect, it } from "vitest";
import type { MapConfig } from "../domain/types";
import { createMapView, type MapView } from "./mapView";

// Runs in headless Chromium: moving the map content up past the image's bottom edge (to keep a
// tapped marker above a phone's open sheet), through Leaflet's real pan limit.

/** A square minimap; a 1×1 PNG stands in for its image, which Leaflet stretches to the bounds. */
const fixtureMapConfig: MapConfig = {
  mapId: "Lockdown",
  imageUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  imageWidthPixels: 1024,
  imageHeightPixels: 1024,
  worldScale: 1000,
  worldOriginX: -500,
  worldOriginZ: -500,
};

const mountedContainers: HTMLElement[] = [];

afterEach(() => {
  for (const container of mountedContainers.splice(0)) {
    container.remove();
  }
});

function mountMapView(widthPixels: number, heightPixels: number): MapView {
  const container = document.createElement("div");
  container.style.width = `${widthPixels}px`;
  container.style.height = `${heightPixels}px`;
  document.body.appendChild(container);
  mountedContainers.push(container);
  const mapView = createMapView(container);
  mapView.showMap(fixtureMapConfig);
  return mapView;
}

/** Where the minimap image's top edge is on screen, relative to the map container. */
function imageTopCanvasY(mapView: MapView): number {
  return mapView.worldToCanvasPoint({
    worldX: fixtureMapConfig.worldOriginX,
    worldZ: fixtureMapConfig.worldOriginZ + fixtureMapConfig.worldScale,
  }).canvasY;
}

describe("MapView.moveContentUp and releaseRoomBelowImage", () => {
  it("moves a whole-image view up past the image's bottom edge, and stays there", () => {
    // Taller than wide: the fitted image is shorter than the view, so Leaflet centres it.
    const mapView = mountMapView(400, 700);
    const fittedTopCanvasY = imageTopCanvasY(mapView);
    // Without animation the move ends at once, so Leaflet's end-of-move pan limit check has run.
    mapView.moveContentUp(120, false);
    expect(imageTopCanvasY(mapView)).toBeCloseTo(fittedTopCanvasY - 120, 6);

    mapView.releaseRoomBelowImage(false);
    expect(imageTopCanvasY(mapView)).toBeCloseTo(fittedTopCanvasY, 6);
  });

  it("moves a view the image fills exactly, and adds to an earlier move", () => {
    // Wider than tall: the fitted image is exactly as tall as the view, so nothing could pan before.
    const mapView = mountMapView(700, 400);
    const fittedTopCanvasY = imageTopCanvasY(mapView);
    mapView.moveContentUp(80, false);
    mapView.moveContentUp(40, false);
    expect(imageTopCanvasY(mapView)).toBeCloseTo(fittedTopCanvasY - 120, 6);
    mapView.releaseRoomBelowImage(false);
    expect(imageTopCanvasY(mapView)).toBeCloseTo(fittedTopCanvasY, 6);
  });

  it("throws for a distance that is not a positive number", () => {
    const mapView = mountMapView(400, 700);
    expect(() => mapView.moveContentUp(0, false)).toThrow("positive distance, got 0");
    expect(() => mapView.moveContentUp(Number.NaN, false)).toThrow("got NaN");
  });
});
