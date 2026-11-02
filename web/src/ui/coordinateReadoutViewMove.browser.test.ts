import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldPoint } from "../domain/types";
import {
  createClipboardWriter,
  createCoordinateReadout,
  type CoordinateReadout,
  type CoordinateReadoutMapView,
} from "./coordinateReadout";
import { fixtureMapConfig } from "./overviewTestFixtures";

// Runs in headless Chromium (vitest.workspace.ts "browser" project). A stand-in map view whose
// redraw never fires, so the readout can only follow a view move through onViewMove; and the
// clipboard writer the app uses, on a page where the browser gives no clipboard.

const mountedElements: HTMLElement[] = [];

afterEach(() => {
  for (const element of mountedElements.splice(0)) {
    element.remove();
  }
});

function shownText(readout: CoordinateReadout, axis: "x" | "z"): string {
  const valueElement = readout.element.querySelector(`[data-world-axis="${axis}"]`);
  if (valueElement === null) {
    throw new Error(`The readout has no value element for axis ${axis}`);
  }
  return valueElement.textContent ?? "";
}

function statusText(readout: CoordinateReadout): string {
  const statusElement = readout.element.querySelector(".coordinate-readout-status");
  if (statusElement === null) {
    throw new Error("The readout has no status element");
  }
  return statusElement.textContent ?? "";
}

// A stand-in map view whose redraw never fires, so only onViewMove can update the readout.
function mountWithMovableView(
  isCrosshairMode: boolean,
  writeClipboardText: (text: string) => Promise<void> = () => Promise.resolve(),
): {
  readonly readout: CoordinateReadout;
  readonly container: HTMLElement;
  moveViewTo(worldPoint: WorldPoint): void;
} {
  const container = document.createElement("div");
  container.style.width = "600px";
  container.style.height = "400px";
  document.body.appendChild(container);
  mountedElements.push(container);
  let worldPointUnderEveryCanvasPoint: WorldPoint = { worldX: 1, worldZ: 2 };
  const viewMoveCallbacks: (() => void)[] = [];
  const movableMapView: CoordinateReadoutMapView = {
    container,
    canvasPointToWorld: () => worldPointUnderEveryCanvasPoint,
    pointerEventToCanvasPoint: () => ({ canvasX: 10, canvasY: 10 }),
    onViewMove: (callback) => viewMoveCallbacks.push(callback),
    onRedraw: () => undefined,
  };
  const readout = createCoordinateReadout({
    mapView: movableMapView,
    isCrosshairMode,
    writeClipboardText,
  });
  mountedElements.push(readout.element, readout.crosshairElement);
  readout.showMap(fixtureMapConfig);
  return {
    readout,
    container,
    moveViewTo: (worldPoint) => {
      worldPointUnderEveryCanvasPoint = worldPoint;
      for (const callback of viewMoveCallbacks) {
        callback();
      }
    },
  };
}

describe("coordinate readout during a view move, before the view settles", () => {
  it("follows the crosshair's spot on every move", () => {
    const { readout, moveViewTo } = mountWithMovableView(true);
    expect(shownText(readout, "x")).toBe("1.0");
    moveViewTo({ worldX: 30.25, worldZ: -40 });
    expect(`${shownText(readout, "x")}, ${shownText(readout, "z")}`).toBe("30.3, -40.0");
  });

  it("follows the spot under a still mouse on every move", () => {
    const { readout, container, moveViewTo } = mountWithMovableView(false);
    container.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse" }));
    expect(shownText(readout, "x")).toBe("1.0");
    moveViewTo({ worldX: -7, worldZ: 8.04 });
    expect(`${shownText(readout, "x")}, ${shownText(readout, "z")}`).toBe("-7.0, 8.0");
  });
});

describe("createClipboardWriter", () => {
  it("rejects in plain words where the browser has no clipboard (plain-http pages)", async () => {
    await expect(createClipboardWriter(undefined)("1.0, 2.0")).rejects.toThrow(
      "this browser allows copying only on https pages or on this computer",
    );
  });

  it("shows Copy failed with that reason in the readout", async () => {
    const { readout } = mountWithMovableView(true, createClipboardWriter(undefined));
    const copyButton = readout.element.querySelector("button");
    if (copyButton === null) {
      throw new Error("The crosshair readout has no Copy button");
    }
    copyButton.click();
    await vi.waitFor(() =>
      expect(statusText(readout)).toBe(
        "Copy failed: this browser allows copying only on https pages or on this computer",
      ),
    );
  });
});
