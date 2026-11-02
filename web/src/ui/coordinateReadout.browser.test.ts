import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasPoint, MapConfig } from "../domain/types";
import { formatWorldPointForCopy } from "../domain/coordinateReadout";
import { createMapView, type MapView } from "../render/mapView";
import { createCoordinateReadout, type CoordinateReadout } from "./coordinateReadout";
import { fixtureMapConfig } from "./overviewTestFixtures";
import "./theme.css";
import "./coordinateReadout.css";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): pointer positions go through
// Leaflet's real container geometry. The 600×400 container shows the square fixture map with empty
// margins left and right, which are off the minimap.

const mountedElements: HTMLElement[] = [];

interface MountedReadout {
  readonly mapView: MapView;
  readonly readout: CoordinateReadout;
  readonly copiedTexts: string[];
}

function mountReadout(
  isCrosshairMode: boolean,
  writeClipboardText?: (text: string) => Promise<void>,
): MountedReadout {
  const container = document.createElement("div");
  container.style.width = "600px";
  container.style.height = "400px";
  document.body.appendChild(container);
  mountedElements.push(container);
  const mapView = createMapView(container);
  mapView.showMap(fixtureMapConfig);
  const copiedTexts: string[] = [];
  const readout = createCoordinateReadout({
    mapView,
    isCrosshairMode,
    writeClipboardText:
      writeClipboardText ??
      ((text) => {
        copiedTexts.push(text);
        return Promise.resolve();
      }),
  });
  document.body.append(readout.element, readout.crosshairElement);
  mountedElements.push(readout.element, readout.crosshairElement);
  readout.showMap(fixtureMapConfig);
  return { mapView, readout, copiedTexts };
}

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

function movePointer(mapView: MapView, at: CanvasPoint, pointerType = "mouse"): void {
  const containerBox = mapView.container.getBoundingClientRect();
  mapView.container.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerType,
      clientX: containerBox.left + at.canvasX,
      clientY: containerBox.top + at.canvasY,
    }),
  );
}

function clickZoomIn(mapView: MapView): void {
  const zoomInButton = mapView.container.querySelector(".leaflet-control-zoom-in");
  if (!(zoomInButton instanceof HTMLElement)) {
    throw new Error("The map view has no zoom-in control");
  }
  zoomInButton.click();
}

function expectedCopyText(mapView: MapView, at: CanvasPoint): string {
  return formatWorldPointForCopy(mapView.canvasPointToWorld(at));
}

const insideMinimap: CanvasPoint = { canvasX: 250, canvasY: 120 };
const leftMarginOffMinimap: CanvasPoint = { canvasX: 20, canvasY: 200 };

describe("coordinate readout with a mouse (desktop)", () => {
  it("shows the world X and Z under the pointer, to one decimal place", () => {
    const { mapView, readout } = mountReadout(false);
    movePointer(mapView, insideMinimap);
    expect(`${shownText(readout, "x")}, ${shownText(readout, "z")}`).toBe(
      expectedCopyText(mapView, insideMinimap),
    );
    expect(shownText(readout, "x")).toMatch(/^-?\d+\.\d$/);
  });

  it("shows a dash before any pointer move, past the minimap edge and after the pointer leaves", () => {
    const { mapView, readout } = mountReadout(false);
    expect(shownText(readout, "x")).toBe("—");
    movePointer(mapView, leftMarginOffMinimap);
    expect(shownText(readout, "x")).toBe("—");
    expect(shownText(readout, "z")).toBe("—");
    movePointer(mapView, insideMinimap);
    mapView.container.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    expect(shownText(readout, "x")).toBe("—");
  });

  it("copies exactly the shown text when C is pressed, and says Copied", async () => {
    const { mapView, readout, copiedTexts } = mountReadout(false);
    movePointer(mapView, insideMinimap);
    await userEvent.keyboard("c");
    expect(copiedTexts).toEqual([`${shownText(readout, "x")}, ${shownText(readout, "z")}`]);
    await vi.waitFor(() => expect(statusText(readout)).toBe("Copied"));
  });

  it("does not copy on Cmd+C or Ctrl+C, while typing in a field, or with no position shown", async () => {
    const { mapView, copiedTexts } = mountReadout(false);
    await userEvent.keyboard("c");
    movePointer(mapView, insideMinimap);
    await userEvent.keyboard("{Meta>}c{/Meta}{Control>}c{/Control}");
    const textField = document.createElement("input");
    document.body.appendChild(textField);
    mountedElements.push(textField);
    textField.focus();
    await userEvent.keyboard("c");
    expect(copiedTexts).toEqual([]);
  });

  it("says Copy failed with the reason when the browser refuses the clipboard", async () => {
    const { mapView, readout } = mountReadout(false, () =>
      Promise.reject(new Error("clipboard blocked")),
    );
    movePointer(mapView, insideMinimap);
    await userEvent.keyboard("c");
    await vi.waitFor(() => expect(statusText(readout)).toBe("Copy failed: clipboard blocked"));
  });

  it("follows the map under a still pointer when the view zooms", () => {
    const { mapView, readout } = mountReadout(false);
    movePointer(mapView, insideMinimap);
    const beforeZoomText = shownText(readout, "x");
    clickZoomIn(mapView);
    expect(shownText(readout, "x")).not.toBe(beforeZoomText);
    expect(`${shownText(readout, "x")}, ${shownText(readout, "z")}`).toBe(
      expectedCopyText(mapView, insideMinimap),
    );
  });

  it("hints at the C key instead of a Copy button, and hides the crosshair", () => {
    const { readout } = mountReadout(false);
    expect(readout.element.querySelector("button")).toBeNull();
    expect(readout.element.textContent).toContain("Press C to copy");
    expect(readout.crosshairElement.hidden).toBe(true);
    expect(readout.element.getAttribute("aria-label")).toBe("World position under the pointer");
  });
});

describe("coordinate readout with the centre crosshair (touch)", () => {
  function mapCentre(mapView: MapView): CanvasPoint {
    return {
      canvasX: mapView.container.clientWidth / 2,
      canvasY: mapView.container.clientHeight / 2,
    };
  }

  it("shows the world position at the centre of the map, with the crosshair visible", () => {
    const { mapView, readout } = mountReadout(true);
    expect(readout.crosshairElement.hidden).toBe(false);
    expect(`${shownText(readout, "x")}, ${shownText(readout, "z")}`).toBe(
      expectedCopyText(mapView, mapCentre(mapView)),
    );
    expect(readout.element.getAttribute("aria-label")).toBe("World position at the crosshair");
  });

  it("ignores finger moves and updates while the map pans", async () => {
    const { mapView, readout } = mountReadout(true);
    // Zoomed in, so the edge limit leaves room to pan.
    clickZoomIn(mapView);
    // The zoomed image is still narrower than the container, so the map pans up and down only.
    const beforePanText = shownText(readout, "z");
    movePointer(mapView, insideMinimap, "touch");
    expect(shownText(readout, "z")).toBe(beforePanText);
    mapView.container.focus();
    await userEvent.keyboard("{ArrowDown}");
    await vi.waitFor(() => expect(shownText(readout, "z")).not.toBe(beforePanText));
    expect(`${shownText(readout, "x")}, ${shownText(readout, "z")}`).toBe(
      expectedCopyText(mapView, mapCentre(mapView)),
    );
  });

  it("copies the shown position with the Copy button", async () => {
    const { readout, copiedTexts } = mountReadout(true);
    const copyButton = readout.element.querySelector("button");
    if (copyButton === null) {
      throw new Error("The crosshair readout has no Copy button");
    }
    expect(copyButton.textContent).toContain("Copy");
    copyButton.click();
    expect(copiedTexts).toEqual([`${shownText(readout, "x")}, ${shownText(readout, "z")}`]);
    await vi.waitFor(() => expect(statusText(readout)).toBe("Copied"));
  });
});

describe("coordinate readout across maps", () => {
  it("uses the new map's bounds after showMap", () => {
    const { mapView, readout } = mountReadout(false);
    movePointer(mapView, insideMinimap);
    expect(shownText(readout, "x")).not.toBe("—");
    // A map whose world area lies far from the shown image's: the same world point is off it.
    const distantMap: MapConfig = { ...fixtureMapConfig, worldOriginX: 5000, worldOriginZ: 5000 };
    readout.showMap(distantMap);
    expect(shownText(readout, "x")).toBe("—");
  });
});
