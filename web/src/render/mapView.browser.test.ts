import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { worldToPixel } from "../domain/coordinates";
import type { CanvasPoint, MapConfig, WorldPoint } from "../domain/types";
import { createCanvasOverlay } from "./canvasOverlay";
import { createMapView, type MapView } from "./mapView";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): Leaflet needs real layout.

// A 1×1 PNG stands in for the minimap; Leaflet stretches it to the image bounds.
const onePixelPngUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// GrandRift's real config: the image is not square (2160 × 2158).
const grandRiftConfig: MapConfig = {
  mapId: "GrandRift",
  imageUrl: onePixelPngUrl,
  imageWidthPixels: 2160,
  imageHeightPixels: 2158,
  worldScale: 581,
  worldOriginX: -290,
  worldOriginZ: -290,
};

const sampleWorldPoints: readonly WorldPoint[] = [
  { worldX: -290, worldZ: -290 },
  { worldX: 291, worldZ: 291 },
  { worldX: 12.345678, worldZ: -101.987654 },
  { worldX: -151.25, worldZ: 200.125 },
];

const mountedContainers: HTMLElement[] = [];

function mountMapView(widthPixels: number, heightPixels: number): MapView {
  const container = document.createElement("div");
  container.style.width = `${widthPixels}px`;
  container.style.height = `${heightPixels}px`;
  document.body.appendChild(container);
  mountedContainers.push(container);
  const mapView = createMapView(container);
  mapView.showMap(grandRiftConfig);
  return mapView;
}

afterEach(() => {
  for (const container of mountedContainers.splice(0)) {
    container.remove();
  }
});

/** Where the image element really is on screen, as the expected canvas point of a world point. */
function canvasPointFromImageElement(mapView: MapView, point: WorldPoint): CanvasPoint {
  const imageElement = mapView.container.querySelector("img.leaflet-image-layer");
  if (imageElement === null) {
    throw new Error("The map view has no Leaflet image layer");
  }
  const imageBox = imageElement.getBoundingClientRect();
  const containerBox = mapView.container.getBoundingClientRect();
  const pixelPoint = worldToPixel(point, grandRiftConfig);
  return {
    canvasX:
      imageBox.left -
      containerBox.left +
      (pixelPoint.pixelX / grandRiftConfig.imageWidthPixels) * imageBox.width,
    canvasY:
      imageBox.top -
      containerBox.top +
      (pixelPoint.pixelY / grandRiftConfig.imageHeightPixels) * imageBox.height,
  };
}

function expectExactRoundTrip(mapView: MapView): void {
  for (const point of sampleWorldPoints) {
    const roundTripPoint = mapView.canvasPointToWorld(mapView.worldToCanvasPoint(point));
    expect(Math.abs(roundTripPoint.worldX - point.worldX)).toBeLessThan(1e-9);
    expect(Math.abs(roundTripPoint.worldZ - point.worldZ)).toBeLessThan(1e-9);
  }
}

function expectCanvasPointsOnImage(mapView: MapView): void {
  // Leaflet places the image element on whole pixels, so allow one CSS pixel.
  for (const point of sampleWorldPoints) {
    const canvasPoint = mapView.worldToCanvasPoint(point);
    const expectedCanvasPoint = canvasPointFromImageElement(mapView, point);
    expect(Math.abs(canvasPoint.canvasX - expectedCanvasPoint.canvasX)).toBeLessThanOrEqual(1);
    expect(Math.abs(canvasPoint.canvasY - expectedCanvasPoint.canvasY)).toBeLessThanOrEqual(1);
  }
}

/** Canvas pixels per world unit at the current zoom. */
function canvasPixelsPerWorldUnit(mapView: MapView): number {
  const leftCanvasPoint = mapView.worldToCanvasPoint({ worldX: -100, worldZ: 0 });
  const rightCanvasPoint = mapView.worldToCanvasPoint({ worldX: 100, worldZ: 0 });
  return (rightCanvasPoint.canvasX - leftCanvasPoint.canvasX) / 200;
}

/** The one-step converter for the current view gives the same canvas points as worldToCanvasPoint. */
function expectConverterMatchesWorldToCanvasPoint(mapView: MapView): void {
  const convertWorldToCanvas = mapView.worldToCanvasConverter();
  for (const point of sampleWorldPoints) {
    const expectedCanvasPoint = mapView.worldToCanvasPoint(point);
    const convertedCanvasPoint = convertWorldToCanvas(point);
    expect(Math.abs(convertedCanvasPoint.canvasX - expectedCanvasPoint.canvasX)).toBeLessThan(1e-9);
    expect(Math.abs(convertedCanvasPoint.canvasY - expectedCanvasPoint.canvasY)).toBeLessThan(1e-9);
  }
}

function clickZoomIn(mapView: MapView): void {
  const zoomInButton = mapView.container.querySelector<HTMLElement>(".leaflet-control-zoom-in");
  if (zoomInButton === null) {
    throw new Error("The map view has no zoom-in button");
  }
  zoomInButton.click();
}

describe("createMapView (browser)", () => {
  it("fits the whole image on showMap, with every world point on the image", () => {
    const mapView = mountMapView(400, 300);
    const topLeftCanvasPoint = mapView.worldToCanvasPoint({ worldX: -290, worldZ: 291 });
    const bottomRightCanvasPoint = mapView.worldToCanvasPoint({ worldX: 291, worldZ: -290 });
    expect(topLeftCanvasPoint.canvasY).toBeCloseTo(0, 6);
    expect(bottomRightCanvasPoint.canvasY).toBeCloseTo(300, 6);
    expect(topLeftCanvasPoint.canvasX).toBeGreaterThanOrEqual(0);
    expect(bottomRightCanvasPoint.canvasX).toBeLessThanOrEqual(400);
    expectCanvasPointsOnImage(mapView);
  });

  it("converts world → canvas → world exactly, with no whole-pixel rounding", () => {
    const mapView = mountMapView(400, 300);
    expectExactRoundTrip(mapView);
    clickZoomIn(mapView);
    expectExactRoundTrip(mapView);
  });

  it("gives the new canvas positions after a zoom and a pan, and calls onRedraw", async () => {
    const mapView = mountMapView(400, 300);
    let redrawCount = 0;
    mapView.onRedraw(() => {
      redrawCount += 1;
    });
    const fittedPixelsPerWorldUnit = canvasPixelsPerWorldUnit(mapView);
    clickZoomIn(mapView);
    expect(canvasPixelsPerWorldUnit(mapView)).toBeCloseTo(fittedPixelsPerWorldUnit * Math.SQRT2, 6);
    expectCanvasPointsOnImage(mapView);

    const beforePanCanvasPoint = mapView.worldToCanvasPoint({ worldX: 0, worldZ: 0 });
    mapView.container.focus();
    await userEvent.keyboard("{ArrowRight}");
    // Leaflet animates the keyboard pan; poll until it has moved rather than sleeping a fixed time.
    await vi.waitFor(() => {
      const movedCanvasPoint = mapView.worldToCanvasPoint({ worldX: 0, worldZ: 0 });
      expect(movedCanvasPoint.canvasX).toBeLessThan(beforePanCanvasPoint.canvasX - 10);
    });
    const afterPanCanvasPoint = mapView.worldToCanvasPoint({ worldX: 0, worldZ: 0 });
    expect(afterPanCanvasPoint.canvasY).toBeCloseTo(beforePanCanvasPoint.canvasY, 6);
    expectCanvasPointsOnImage(mapView);
    expectExactRoundTrip(mapView);
    // One redraw for the zoom step and one when the pan comes to rest, none during the pan.
    await vi.waitFor(() => expect(redrawCount).toBe(2));
  });

  it("worldToCanvasConverter matches worldToCanvasPoint after a fit, a zoom and a pan", async () => {
    const mapView = mountMapView(400, 300);
    expectConverterMatchesWorldToCanvasPoint(mapView);
    clickZoomIn(mapView);
    expectConverterMatchesWorldToCanvasPoint(mapView);
    const beforePanCanvasPoint = mapView.worldToCanvasPoint({ worldX: 0, worldZ: 0 });
    mapView.container.focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => {
      const movedCanvasPoint = mapView.worldToCanvasPoint({ worldX: 0, worldZ: 0 });
      expect(movedCanvasPoint.canvasX).toBeLessThan(beforePanCanvasPoint.canvasX - 10);
    });
    expectConverterMatchesWorldToCanvasPoint(mapView);
  });

  it("calls onRedraw once per zoom step, not once per Leaflet event", () => {
    const mapView = mountMapView(400, 300);
    let redrawCount = 0;
    mapView.onRedraw(() => {
      redrawCount += 1;
    });
    clickZoomIn(mapView);
    expect(redrawCount).toBe(1);
  });

  it("calls onViewMove during a pan, before the view settles, and on each zoom step", async () => {
    const mapView = mountMapView(400, 300);
    let viewMoveCount = 0;
    let redrawCount = 0;
    mapView.onViewMove(() => {
      viewMoveCount += 1;
    });
    mapView.onRedraw(() => {
      redrawCount += 1;
    });
    clickZoomIn(mapView);
    expect(viewMoveCount).toBeGreaterThanOrEqual(1);
    const movesBeforePan = viewMoveCount;
    mapView.container.focus();
    await userEvent.keyboard("{ArrowRight}");
    // The animated keyboard pan reports moves while it runs; the redraw comes once it settles.
    await vi.waitFor(() => expect(redrawCount).toBe(2));
    expect(viewMoveCount - movesBeforePan).toBeGreaterThan(1);
  });

  it("keeps the user's zoom when the container is resized", async () => {
    const mapView = mountMapView(400, 300);
    clickZoomIn(mapView);
    const zoomedPixelsPerWorldUnit = canvasPixelsPerWorldUnit(mapView);
    mapView.container.style.height = "400px";
    window.dispatchEvent(new Event("resize"));
    // Leaflet handles a window resize on a later animation frame; poll until the map has grown.
    await vi.waitFor(() => {
      const bottomCanvasY = mapView.worldToCanvasPoint({ worldX: 291, worldZ: -290 }).canvasY;
      expect(bottomCanvasY).toBeGreaterThan(300);
    });
    expect(canvasPixelsPerWorldUnit(mapView)).toBeCloseTo(zoomedPixelsPerWorldUnit, 6);
  });

  it("finds the canvas point of a mouse event relative to the container", () => {
    const mapView = mountMapView(400, 300);
    const containerBox = mapView.container.getBoundingClientRect();
    const mouseEvent = new MouseEvent("mousedown", {
      clientX: containerBox.left + 37,
      clientY: containerBox.top + 52,
    });
    expect(mapView.pointerEventToCanvasPoint(mouseEvent)).toEqual({ canvasX: 37, canvasY: 52 });
  });

  it("throws in plain words when asked for a point before any map is shown", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountedContainers.push(container);
    const mapView = createMapView(container);
    expect(() => mapView.worldToCanvasPoint({ worldX: 0, worldZ: 0 })).toThrow(
      "no minimap shown yet",
    );
    expect(() => mapView.worldToCanvasConverter()).toThrow("no minimap shown yet");
  });

  it("calls the image-load-failure callback once, naming the URL, when the minimap is missing", async () => {
    const container = document.createElement("div");
    container.style.width = "400px";
    container.style.height = "300px";
    document.body.appendChild(container);
    mountedContainers.push(container);
    const mapView = createMapView(container);
    const failureMessages: string[] = [];
    mapView.onImageLoadFailure((message) => failureMessages.push(message));
    const missingImageUrl = "/missing-minimap-for-browser-test.jpg";
    mapView.showMap({ ...grandRiftConfig, imageUrl: missingImageUrl });
    await vi.waitFor(() => expect(failureMessages).toHaveLength(1));
    expect(failureMessages[0]).toContain(missingImageUrl);
    expect(failureMessages[0]).toContain('"GrandRift"');
  });
});

describe("createCanvasOverlay (browser)", () => {
  it("pre-scales the context by the device pixel ratio and shifts it past the margin", () => {
    const mapView = mountMapView(400, 300);
    const overlay = createCanvasOverlay(mapView);
    overlay.clear();
    const transform = overlay.context.getTransform();
    expect(transform.a).toBe(window.devicePixelRatio);
    expect(transform.d).toBe(window.devicePixelRatio);
    expect(transform.e).toBe(40 * window.devicePixelRatio);
    expect(transform.f).toBe(30 * window.devicePixelRatio);
  });

  it("resizes the backing store on the next clear after the container grows", () => {
    const mapView = mountMapView(400, 300);
    const overlay = createCanvasOverlay(mapView);
    overlay.clear();
    mapView.container.style.width = "500px";
    overlay.clear();
    expect(overlay.context.canvas.width).toBe(Math.round(600 * window.devicePixelRatio));
  });
});
