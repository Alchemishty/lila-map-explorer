import { afterEach, describe, expect, it } from "vitest";
import type { MapConfig, WorldPoint, WorldRect } from "../domain/types";
import type { ContainerInsetsCssPixels } from "./fitBoundsInsideInsets";
import { createMapView, type MapView } from "./mapView";

// Runs in headless Chromium: MapView.fitWorldRect frames a world rectangle in the part of the
// container its insets leave free, through Leaflet's real zoom and pan limits. It must never lock
// the zoom-out limit, and must keep content near the image's bottom edge clear of a bottom cover.

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

const evenInsets: ContainerInsetsCssPixels = {
  topCssPixels: 32,
  rightCssPixels: 32,
  bottomCssPixels: 32,
  leftCssPixels: 32,
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
  mapView.showMap(grandRiftConfig);
  return mapView;
}

function cornersOf(rect: WorldRect): WorldPoint[] {
  return [
    { worldX: rect.minWorldX, worldZ: rect.minWorldZ },
    { worldX: rect.maxWorldX, worldZ: rect.maxWorldZ },
  ];
}

/** Expects every corner of rect inside the container less insets (0.5 px for float rounding). */
function expectInsideInsets(
  mapView: MapView,
  rect: WorldRect,
  insets: ContainerInsetsCssPixels,
): void {
  const { width, height } = mapView.container.getBoundingClientRect();
  for (const corner of cornersOf(rect)) {
    const canvasPoint = mapView.worldToCanvasPoint(corner);
    expect(canvasPoint.canvasX).toBeGreaterThanOrEqual(insets.leftCssPixels - 0.5);
    expect(canvasPoint.canvasX).toBeLessThanOrEqual(width - insets.rightCssPixels + 0.5);
    expect(canvasPoint.canvasY).toBeGreaterThanOrEqual(insets.topCssPixels - 0.5);
    expect(canvasPoint.canvasY).toBeLessThanOrEqual(height - insets.bottomCssPixels + 0.5);
  }
}

/** The rect's on-screen width and height in canvas pixels. */
function canvasSizeOf(mapView: MapView, rect: WorldRect): { width: number; height: number } {
  const [firstCorner, oppositeCorner] = cornersOf(rect).map((corner) =>
    mapView.worldToCanvasPoint(corner),
  );
  if (firstCorner === undefined || oppositeCorner === undefined) {
    throw new Error("A rect has two corners");
  }
  return {
    width: Math.abs(oppositeCorner.canvasX - firstCorner.canvasX),
    height: Math.abs(oppositeCorner.canvasY - firstCorner.canvasY),
  };
}

function requireZoomOutButton(mapView: MapView): HTMLElement {
  const zoomOutButton = mapView.container.querySelector<HTMLElement>(".leaflet-control-zoom-out");
  if (zoomOutButton === null) {
    throw new Error("The map view has no zoom-out button");
  }
  return zoomOutButton;
}

/** A corner of the image in the middle third: far from every edge. */
const middleRect: WorldRect = { minWorldX: -50, maxWorldX: 70, minWorldZ: 0, maxWorldZ: 40 };

describe("MapView.fitWorldRect", () => {
  it("fits the rect in the free part exactly, filling it on the tighter axis (GrandRift)", () => {
    const mapView = mountMapView(800, 600);
    mapView.fitWorldRect(middleRect, evenInsets);
    expectInsideInsets(mapView, middleRect, evenInsets);
    // 120 × 40 world units into 736 × 536 px: the width is the tighter axis, so it fills it.
    const fittedSize = canvasSizeOf(mapView, middleRect);
    expect(fittedSize.width).toBeCloseTo(800 - 64, 1);
    // GrandRift is not square: its pixels per world unit differ on each axis.
    const pixelsPerWorldUnitX = fittedSize.width / 120;
    const pixelsPerWorldUnitZ = fittedSize.height / 40;
    expect(pixelsPerWorldUnitZ / pixelsPerWorldUnitX).toBeCloseTo(2158 / 2160, 6);
  });

  it("keeps the zoom-out limit: after a fit the designer can still zoom out to the whole image", () => {
    const mapView = mountMapView(800, 600);
    mapView.fitWorldRect(middleRect, evenInsets);
    const zoomOutButton = requireZoomOutButton(mapView);
    expect(zoomOutButton.classList.contains("leaflet-disabled")).toBe(false);
    for (let i = 0; i < 40 && !zoomOutButton.classList.contains("leaflet-disabled"); i += 1) {
      zoomOutButton.click();
    }
    // At the limit the whole image fits: its height (the tighter axis here) fills the container.
    const imageRect: WorldRect = {
      minWorldX: grandRiftConfig.worldOriginX,
      maxWorldX: grandRiftConfig.worldOriginX + grandRiftConfig.worldScale,
      minWorldZ: grandRiftConfig.worldOriginZ,
      maxWorldZ: grandRiftConfig.worldOriginZ + grandRiftConfig.worldScale,
    };
    expect(zoomOutButton.classList.contains("leaflet-disabled")).toBe(true);
    expect(canvasSizeOf(mapView, imageRect).height).toBeCloseTo(600, 1);
  });

  it("lifts content at the image's bottom edge clear of a bottom cover", () => {
    const mapView = mountMapView(390, 600);
    // A phone's open sheet over the lower 300 px, plus the margin.
    const coveredInsets: ContainerInsetsCssPixels = { ...evenInsets, bottomCssPixels: 332 };
    const bottomEdgeRect: WorldRect = {
      minWorldX: 0,
      maxWorldX: 60,
      minWorldZ: grandRiftConfig.worldOriginZ,
      maxWorldZ: grandRiftConfig.worldOriginZ + 40,
    };
    mapView.fitWorldRect(bottomEdgeRect, coveredInsets);
    expectInsideInsets(mapView, bottomEdgeRect, coveredInsets);
  });

  it("gives back room an earlier fit made below the image, so lifts never add up", () => {
    const mapView = mountMapView(390, 600);
    const coveredInsets: ContainerInsetsCssPixels = { ...evenInsets, bottomCssPixels: 332 };
    const bottomEdgeRect: WorldRect = {
      minWorldX: 0,
      maxWorldX: 60,
      minWorldZ: grandRiftConfig.worldOriginZ,
      maxWorldZ: grandRiftConfig.worldOriginZ + 40,
    };
    mapView.fitWorldRect(bottomEdgeRect, coveredInsets);
    const firstBottomCanvasY = mapView.worldToCanvasPoint({
      worldX: 0,
      worldZ: grandRiftConfig.worldOriginZ,
    }).canvasY;
    mapView.fitWorldRect(bottomEdgeRect, coveredInsets);
    expect(
      mapView.worldToCanvasPoint({ worldX: 0, worldZ: grandRiftConfig.worldOriginZ }).canvasY,
    ).toBeCloseTo(firstBottomCanvasY, 6);
  });

  it("frames a single point (a zero-size rect) without failing", () => {
    const mapView = mountMapView(800, 600);
    const lonePointRect: WorldRect = { minWorldX: 10, maxWorldX: 10, minWorldZ: 20, maxWorldZ: 20 };
    mapView.fitWorldRect(lonePointRect, evenInsets);
    const canvasPoint = mapView.worldToCanvasPoint({ worldX: 10, worldZ: 20 });
    // Centred, to within Leaflet's whole-pixel rounding of the view centre.
    expect(canvasPoint.canvasX).toBeCloseTo(400, 0);
    expect(canvasPoint.canvasY).toBeCloseTo(300, 0);
  });

  it("measures a container that changed size without a window resize", () => {
    const mapView = mountMapView(800, 600);
    mapView.container.style.height = "400px"; // as when Replay's timeline docks under the map
    mapView.fitWorldRect(middleRect, evenInsets);
    expectInsideInsets(mapView, middleRect, evenInsets);
  });

  it("throws for a negative inset, and when the insets leave no room", () => {
    const mapView = mountMapView(400, 300);
    expect(() => mapView.fitWorldRect(middleRect, { ...evenInsets, topCssPixels: -1 })).toThrow(
      "A fit inset must be 0 or more CSS pixels, but topCssPixels is -1",
    );
    expect(() => mapView.fitWorldRect(middleRect, { ...evenInsets, bottomCssPixels: 268 })).toThrow(
      "The map has no free room to frame the match in",
    );
  });
});
