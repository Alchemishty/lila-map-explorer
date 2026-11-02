import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapConfig } from "../domain/types";
import { createMapView, type MapView } from "./mapView";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): Leaflet needs real layout.
// The zoom-out limit must follow the shown image and the container size both ways. Leaflet's
// getBoundsZoom never answers below the current minZoom, so a limit that only rose once locked a
// bigger image (or a smaller window) zoomed in with zoom-out disabled.

// A 1×1 PNG stands in for the minimap; Leaflet stretches it to the image bounds.
const onePixelPngUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Real configs: GrandRift's web image is 2160 × 2158, AmbroseValley's is 4096 × 4096.
const grandRiftConfig: MapConfig = {
  mapId: "GrandRift",
  imageUrl: onePixelPngUrl,
  imageWidthPixels: 2160,
  imageHeightPixels: 2158,
  worldScale: 581,
  worldOriginX: -290,
  worldOriginZ: -290,
};
const ambroseValleyConfig: MapConfig = {
  mapId: "AmbroseValley",
  imageUrl: onePixelPngUrl,
  imageWidthPixels: 4096,
  imageHeightPixels: 4096,
  worldScale: 900,
  worldOriginX: -370,
  worldOriginZ: -473,
};

const mountedContainers: HTMLElement[] = [];

function mountMapView(widthPixels: number, heightPixels: number): MapView {
  const container = document.createElement("div");
  container.style.width = `${widthPixels}px`;
  container.style.height = `${heightPixels}px`;
  document.body.appendChild(container);
  mountedContainers.push(container);
  return createMapView(container);
}

afterEach(() => {
  for (const container of mountedContainers.splice(0)) {
    container.remove();
  }
});

function requireZoomOutButton(mapView: MapView): HTMLElement {
  const zoomOutButton = mapView.container.querySelector<HTMLElement>(".leaflet-control-zoom-out");
  if (zoomOutButton === null) {
    throw new Error("The map view has no zoom-out button");
  }
  return zoomOutButton;
}

function isZoomOutDisabled(mapView: MapView): boolean {
  return requireZoomOutButton(mapView).classList.contains("leaflet-disabled");
}

/** Clicks zoom-out until Leaflet disables it (the zoom-out limit), with a bound so it cannot spin. */
function zoomOutToLimit(mapView: MapView): void {
  for (let i = 0; i < 40 && !isZoomOutDisabled(mapView); i += 1) {
    requireZoomOutButton(mapView).click();
  }
  expect(isZoomOutDisabled(mapView)).toBe(true);
}

/** The shown image's height on screen in canvas pixels, from its top and bottom world edges. */
function imageCanvasHeight(mapView: MapView, map: MapConfig): number {
  const topCanvasY = mapView.worldToCanvasPoint({
    worldX: map.worldOriginX,
    worldZ: map.worldOriginZ + map.worldScale,
  }).canvasY;
  const bottomCanvasY = mapView.worldToCanvasPoint({
    worldX: map.worldOriginX,
    worldZ: map.worldOriginZ,
  }).canvasY;
  return bottomCanvasY - topCanvasY;
}

describe("createMapView zoom-out limit (browser)", () => {
  it("fits a bigger image shown after a smaller one, and stops zoom-out exactly there", () => {
    const mapView = mountMapView(400, 300);
    mapView.showMap(grandRiftConfig);
    mapView.showMap(ambroseValleyConfig);
    // The square image fits the 300 px height, and zoom-out is already at its limit.
    expect(imageCanvasHeight(mapView, ambroseValleyConfig)).toBeCloseTo(300, 6);
    expect(isZoomOutDisabled(mapView)).toBe(true);
  });

  it("lets the user zoom out to fit again after the container gets smaller", async () => {
    const mapView = mountMapView(400, 300);
    mapView.showMap(grandRiftConfig);
    mapView.container.style.height = "150px";
    window.dispatchEvent(new Event("resize"));
    // Leaflet handles a window resize on a later animation frame; poll until zoom-out is allowed.
    await vi.waitFor(() => expect(isZoomOutDisabled(mapView)).toBe(false));
    zoomOutToLimit(mapView);
    expect(imageCanvasHeight(mapView, grandRiftConfig)).toBeCloseTo(150, 6);
  });
});
