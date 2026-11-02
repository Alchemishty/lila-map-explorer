/// <reference types="@vitest/browser/providers/playwright" />
import { cdp, userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasPoint, MapConfig } from "../domain/types";
import { createCanvasOverlay } from "./canvasOverlay";
import { createMapView, type MapView } from "./mapView";

// Runs in headless Chromium: the overlay must ride along with Leaflet's real panes during gestures,
// so it is redrawn once when a gesture ends instead of on every frame.

const onePixelPngUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

function createAnchorableBox(mapView: MapView): HTMLElement {
  const box = document.createElement("div");
  box.style.width = "100px";
  box.style.height = "50px";
  mapView.attachOverlayElement(box);
  return box;
}

/** The element's top-left corner on screen, in canvas space (relative to the container). */
function topLeftOnScreen(mapView: MapView, element: HTMLElement): CanvasPoint {
  const elementBox = element.getBoundingClientRect();
  const containerBox = mapView.container.getBoundingClientRect();
  return {
    canvasX: elementBox.left - containerBox.left,
    canvasY: elementBox.top - containerBox.top,
  };
}

function expectSameCanvasPoint(actual: CanvasPoint, expected: CanvasPoint): void {
  expect(Math.abs(actual.canvasX - expected.canvasX)).toBeLessThan(0.01);
  expect(Math.abs(actual.canvasY - expected.canvasY)).toBeLessThan(0.01);
}

/** Canvas pixels per world unit at the current zoom. */
function canvasPixelsPerWorldUnit(mapView: MapView): number {
  const leftCanvasPoint = mapView.worldToCanvasPoint({ worldX: -100, worldZ: 0 });
  const rightCanvasPoint = mapView.worldToCanvasPoint({ worldX: 100, worldZ: 0 });
  return (rightCanvasPoint.canvasX - leftCanvasPoint.canvasX) / 200;
}

function clickZoomIn(mapView: MapView): void {
  const zoomInButton = mapView.container.querySelector<HTMLElement>(".leaflet-control-zoom-in");
  if (zoomInButton === null) {
    throw new Error("The map view has no zoom-in button");
  }
  zoomInButton.click();
}

/** Presses the right arrow and waits until Leaflet's animated pan has moved and come to rest. */
async function panOneKeyboardStep(mapView: MapView): Promise<void> {
  const centerBeforeCanvasX = mapView.worldToCanvasPoint({ worldX: 0, worldZ: 0 }).canvasX;
  mapView.container.focus();
  await userEvent.keyboard("{ArrowRight}");
  let previousCenterCanvasX = Number.NaN;
  await vi.waitFor(
    () => {
      const centerCanvasX = mapView.worldToCanvasPoint({ worldX: 0, worldZ: 0 }).canvasX;
      const hasComeToRest = centerCanvasX === previousCenterCanvasX;
      previousCenterCanvasX = centerCanvasX;
      expect(centerBeforeCanvasX - centerCanvasX).toBeGreaterThan(1);
      expect(hasComeToRest).toBe(true);
    },
    { interval: 100, timeout: 3000 },
  );
}

describe("map view overlay elements (browser)", () => {
  it("redraws once when a pan ends, not on every frame of it", async () => {
    const mapView = mountMapView(400, 300);
    clickZoomIn(mapView); // room to pan
    let redrawCount = 0;
    mapView.onRedraw(() => {
      redrawCount += 1;
    });
    await panOneKeyboardStep(mapView);
    expect(redrawCount).toBe(1);
  });

  it("keeps an anchored element over its map spot while the map pans", async () => {
    const mapView = mountMapView(400, 300);
    clickZoomIn(mapView);
    const box = createAnchorableBox(mapView);
    mapView.anchorOverlayElement(box, { canvasX: 10, canvasY: 20 });
    const anchorWorldPoint = mapView.canvasPointToWorld({ canvasX: 10, canvasY: 20 });
    await panOneKeyboardStep(mapView);
    expectSameCanvasPoint(
      topLeftOnScreen(mapView, box),
      mapView.worldToCanvasPoint(anchorWorldPoint),
    );
  });

  it("scales an anchored element about its map spot on a zoom step", () => {
    const mapView = mountMapView(400, 300);
    const box = createAnchorableBox(mapView);
    mapView.anchorOverlayElement(box, { canvasX: 10, canvasY: 20 });
    const anchorWorldPoint = mapView.canvasPointToWorld({ canvasX: 10, canvasY: 20 });
    clickZoomIn(mapView); // zoomDelta 0.5: everything grows by √2
    expectSameCanvasPoint(
      topLeftOnScreen(mapView, box),
      mapView.worldToCanvasPoint(anchorWorldPoint),
    );
    expect(box.getBoundingClientRect().width).toBeCloseTo(100 * Math.SQRT2, 6);
  });

  it("scales an anchored element on every frame of a two-finger pinch, redrawing only at its end", async () => {
    const mapView = mountMapView(400, 300);
    const box = createAnchorableBox(mapView);
    mapView.anchorOverlayElement(box, { canvasX: 10, canvasY: 20 });
    const anchorWorldPoint = mapView.canvasPointToWorld({ canvasX: 10, canvasY: 20 });
    const pixelsPerWorldUnitBefore = canvasPixelsPerWorldUnit(mapView);
    let redrawCount = 0;
    mapView.onRedraw(() => {
      redrawCount += 1;
    });
    const containerBox = mapView.container.getBoundingClientRect();
    const pinchCenterX = containerBox.left + 200;
    const pinchCenterY = containerBox.top + 150;
    const twoFingers = (spreadPixels: number) => [
      { x: pinchCenterX - spreadPixels, y: pinchCenterY, id: 1 },
      { x: pinchCenterX + spreadPixels, y: pinchCenterY, id: 2 },
    ];
    const browserSession = cdp();
    await browserSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: twoFingers(40),
    });
    for (let step = 1; step <= 5; step += 1) {
      await browserSession.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: twoFingers(40 + step * 12),
      });
    }
    // Leaflet applies pinch frames on animation frames; wait until the zoom has grown.
    await vi.waitFor(() =>
      expect(canvasPixelsPerWorldUnit(mapView)).toBeGreaterThan(pixelsPerWorldUnitBefore * 1.2),
    );
    expect(redrawCount).toBe(0);
    expectSameCanvasPoint(
      topLeftOnScreen(mapView, box),
      mapView.worldToCanvasPoint(anchorWorldPoint),
    );
    expect(box.getBoundingClientRect().width / 100).toBeCloseTo(
      canvasPixelsPerWorldUnit(mapView) / pixelsPerWorldUnitBefore,
      6,
    );
    await browserSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await vi.waitFor(() => expect(redrawCount).toBe(1));
  });

  it("anchoring again places the element unscaled at the new point", () => {
    const mapView = mountMapView(400, 300);
    const box = createAnchorableBox(mapView);
    mapView.anchorOverlayElement(box, { canvasX: 10, canvasY: 20 });
    clickZoomIn(mapView);
    mapView.anchorOverlayElement(box, { canvasX: -40, canvasY: -30 });
    expectSameCanvasPoint(topLeftOnScreen(mapView, box), { canvasX: -40, canvasY: -30 });
    expect(box.getBoundingClientRect().width).toBeCloseTo(100, 6);
  });

  it("puts overlay elements inside the moving map, above the minimap, letting pointer events through", () => {
    const mapView = mountMapView(400, 300);
    const box = createAnchorableBox(mapView);
    const overlayPane = box.parentElement;
    if (overlayPane === null) {
      throw new Error("The attached element has no parent pane");
    }
    expect(overlayPane.closest(".leaflet-map-pane")).not.toBeNull();
    expect(getComputedStyle(overlayPane).zIndex).toBe("450");
    expect(getComputedStyle(overlayPane).pointerEvents).toBe("none");
    const imagePane = mapView.container.querySelector(".leaflet-overlay-pane");
    if (imagePane === null) {
      throw new Error("The map view has no Leaflet overlay pane for the minimap");
    }
    expect(Number(getComputedStyle(imagePane).zIndex)).toBeLessThan(450);
  });

  it("refuses to anchor an element that was never attached", () => {
    const mapView = mountMapView(400, 300);
    expect(() =>
      mapView.anchorOverlayElement(document.createElement("div"), { canvasX: 0, canvasY: 0 }),
    ).toThrow("not attached");
  });
});

describe("createCanvasOverlay margins (browser)", () => {
  it("covers the container plus a 10% margin on each side, at the device pixel ratio", () => {
    const mapView = mountMapView(400, 300);
    const overlay = createCanvasOverlay(mapView);
    expect(overlay.clear()).toEqual({
      leftCanvasX: -40,
      topCanvasY: -30,
      rightCanvasX: 440,
      bottomCanvasY: 330,
    });
    const canvas = overlay.context.canvas;
    expect(canvas.width).toBe(Math.round(480 * window.devicePixelRatio));
    expect(canvas.height).toBe(Math.round(360 * window.devicePixelRatio));
    expectSameCanvasPoint(topLeftOnScreen(mapView, canvas), { canvasX: -40, canvasY: -30 });
  });

  it("draws a canvas point at that point on screen, margin or not", () => {
    const mapView = mountMapView(400, 300);
    const overlay = createCanvasOverlay(mapView);
    overlay.clear();
    overlay.context.fillStyle = "#ff0000";
    overlay.context.fillRect(5, 5, 1, 1); // canvas point (5, 5)
    const devicePixelRatio = window.devicePixelRatio;
    const alphaAt = (backingX: number, backingY: number): number | undefined =>
      overlay.context.getImageData(backingX, backingY, 1, 1).data[3];
    expect(
      alphaAt(Math.round((5 + 40) * devicePixelRatio), Math.round((5 + 30) * devicePixelRatio)),
    ).toBe(255);
    expect(alphaAt(Math.round(5 * devicePixelRatio), Math.round(5 * devicePixelRatio))).toBe(0);
  });
});
