import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasPoint, WorldRect } from "../domain/types";
import { createMapView, type MapView } from "../render/mapView";
import { attachAreaSelection } from "./areaSelection";
import { fixtureMapConfig } from "./overviewTestFixtures";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): pointer positions go through
// Leaflet's real container geometry.

const mountedContainers: HTMLElement[] = [];

function mountMapView(): MapView {
  const container = document.createElement("div");
  container.style.width = "600px";
  container.style.height = "400px";
  document.body.appendChild(container);
  mountedContainers.push(container);
  const mapView = createMapView(container);
  mapView.showMap(fixtureMapConfig);
  return mapView;
}

afterEach(() => {
  for (const container of mountedContainers.splice(0)) {
    container.remove();
  }
});

interface PointerOptions {
  readonly isShiftPressed?: boolean;
  readonly pointerType?: "mouse" | "touch";
}

/** Dispatches a pointer event at a canvas point and returns it (to read defaultPrevented). */
function dispatchPointer(
  target: Element,
  mapView: MapView,
  eventType: "pointerdown" | "pointermove" | "pointerup",
  at: CanvasPoint,
  options: PointerOptions = {},
): PointerEvent {
  const containerBox = mapView.container.getBoundingClientRect();
  const pointerEvent = new PointerEvent(eventType, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    isPrimary: true,
    button: 0,
    pointerType: options.pointerType === undefined ? "mouse" : options.pointerType,
    shiftKey: options.isShiftPressed === true,
    clientX: containerBox.left + at.canvasX,
    clientY: containerBox.top + at.canvasY,
  });
  target.dispatchEvent(pointerEvent);
  return pointerEvent;
}

function dragAcross(
  mapView: MapView,
  path: readonly CanvasPoint[],
  options: PointerOptions = {},
): PointerEvent {
  const [startPoint, ...laterPoints] = path;
  if (startPoint === undefined) {
    throw new Error("A drag needs at least one point");
  }
  const downEvent = dispatchPointer(mapView.container, mapView, "pointerdown", startPoint, options);
  for (const point of laterPoints) {
    dispatchPointer(mapView.container, mapView, "pointermove", point, options);
  }
  const endPoint = laterPoints.length === 0 ? startPoint : laterPoints[laterPoints.length - 1];
  if (endPoint === undefined) {
    throw new Error("A drag needs an end point");
  }
  dispatchPointer(mapView.container, mapView, "pointerup", endPoint, options);
  return downEvent;
}

function expectedArea(mapView: MapView, first: CanvasPoint, opposite: CanvasPoint): WorldRect {
  const firstWorldPoint = mapView.canvasPointToWorld(first);
  const oppositeWorldPoint = mapView.canvasPointToWorld(opposite);
  return {
    minWorldX: Math.min(firstWorldPoint.worldX, oppositeWorldPoint.worldX),
    maxWorldX: Math.max(firstWorldPoint.worldX, oppositeWorldPoint.worldX),
    minWorldZ: Math.min(firstWorldPoint.worldZ, oppositeWorldPoint.worldZ),
    maxWorldZ: Math.max(firstWorldPoint.worldZ, oppositeWorldPoint.worldZ),
  };
}

const dragStart: CanvasPoint = { canvasX: 320, canvasY: 120 };
const dragMiddle: CanvasPoint = { canvasX: 360, canvasY: 160 };
const dragEnd: CanvasPoint = { canvasX: 250, canvasY: 300 };

describe("attachAreaSelection", () => {
  it("reports the world rectangle of a shift-drag, live and on release, and stops Leaflet", () => {
    const mapView = mountMapView();
    const reportedSteps: string[] = [];
    const onChange = vi.fn<(area: WorldRect | null) => void>(() => {
      reportedSteps.push("area");
    });
    attachAreaSelection(mapView, onChange, () => reportedSteps.push("draw end"));
    const downEvent = dragAcross(mapView, [dragStart, dragMiddle, dragEnd], {
      isShiftPressed: true,
    });
    // Preventing pointerdown suppresses the mousedown that Leaflet pans and box-zooms from.
    expect(downEvent.defaultPrevented).toBe(true);
    expect(onChange.mock.calls).toEqual([
      [expectedArea(mapView, dragStart, dragMiddle)],
      [expectedArea(mapView, dragStart, dragEnd)],
      [expectedArea(mapView, dragStart, dragEnd)],
    ]);
    // The drawing's end is reported once, after the final area.
    expect(reportedSteps).toEqual(["area", "area", "area", "draw end"]);
    const finalArea = onChange.mock.calls[2]?.[0] as WorldRect;
    expect(finalArea.minWorldX).toBeLessThan(finalArea.maxWorldX);
    expect(finalArea.minWorldZ).toBeLessThan(finalArea.maxWorldZ);
  });

  it("leaves a plain drag to Leaflet's pan, and a tap clears the area", () => {
    const mapView = mountMapView();
    const onChange = vi.fn();
    const onDrawEnd = vi.fn();
    attachAreaSelection(mapView, onChange, onDrawEnd);
    const downEvent = dragAcross(mapView, [dragStart, dragMiddle, dragEnd]);
    expect(downEvent.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    dragAcross(mapView, [
      dragStart,
      { canvasX: dragStart.canvasX + 3, canvasY: dragStart.canvasY },
    ]);
    expect(onChange.mock.calls).toEqual([[null]]);
    expect(onDrawEnd).not.toHaveBeenCalled(); // neither a pan nor a tap draws an area
  });

  it("Select area mode draws with a one-finger touch drag and turns panning off while on", () => {
    const mapView = mountMapView();
    const setPanEnabled = vi.spyOn(mapView, "setPanEnabled");
    const onChange = vi.fn();
    const areaSelection = attachAreaSelection(mapView, onChange, () => undefined);
    areaSelection.setSelecting(true);
    expect(setPanEnabled).toHaveBeenLastCalledWith(false);
    expect(mapView.container.style.touchAction).toBe("none");

    dragAcross(mapView, [dragStart, dragEnd], { pointerType: "touch" });
    expect(onChange).toHaveBeenLastCalledWith(expectedArea(mapView, dragStart, dragEnd));

    areaSelection.setSelecting(false);
    expect(setPanEnabled).toHaveBeenLastCalledWith(true);
    expect(mapView.container.style.touchAction).toBe("");
    onChange.mockClear();
    dragAcross(mapView, [dragStart, dragEnd], { pointerType: "touch" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a shift-drag that starts on a map control such as the zoom buttons", () => {
    const mapView = mountMapView();
    const onChange = vi.fn();
    attachAreaSelection(mapView, onChange, () => undefined);
    const zoomInButton = mapView.container.querySelector(".leaflet-control-zoom-in");
    if (zoomInButton === null) {
      throw new Error("The map has no zoom-in button");
    }
    const downEvent = dispatchPointer(zoomInButton, mapView, "pointerdown", dragStart, {
      isShiftPressed: true,
    });
    dispatchPointer(mapView.container, mapView, "pointerup", dragEnd, { isShiftPressed: true });
    expect(downEvent.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
