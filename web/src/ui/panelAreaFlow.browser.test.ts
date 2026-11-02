import { cdp, page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import type { WorldPoint } from "../domain/types";
import { startAppWithLoader } from "./app";
import { markerClearanceAboveSheetPixels } from "./keepMarkerAboveSheet";
import { fixtureManifest, fixtureMapConfig, requireFixtureDayFile } from "./overviewTestFixtures";
import { replayManifest, requireReplayDayFile } from "./replayTestFixtures";

// Runs in headless Chromium: the panel area follows the designer's map actions. A drawn area's
// result comes into view; on a phone, Select area closes the sheet and the drag's end opens it on
// the result, and a Replay marker tap opens it on the details with the marker kept above it.

const mountedRoots: HTMLElement[] = [];

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

async function startAt(
  loader: DataLoader,
  widthPixels: number,
  heightPixels: number,
): Promise<HTMLElement> {
  await page.viewport(widthPixels, heightPixels);
  const root = document.createElement("div");
  root.style.height = `${heightPixels}px`;
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, loader);
  return root;
}

function requireElement<Found extends Element>(root: ParentNode, selector: string): Found {
  const element = root.querySelector<Found>(selector);
  if (element === null) {
    throw new Error(`Nothing in the app matches "${selector}"`);
  }
  return element;
}

/** True when the element is wholly inside the panel area's scrolled view and shown. */
function isInPanelView(root: HTMLElement, selector: string): boolean {
  const element = requireElement<HTMLElement>(root, selector);
  const contentBox = requireElement(root, ".bottom-sheet-content").getBoundingClientRect();
  const elementBox = element.getBoundingClientRect();
  return (
    element.checkVisibility() &&
    elementBox.top >= contentBox.top - 0.5 &&
    elementBox.bottom <= contentBox.bottom + 0.5
  );
}

function sheetHandle(root: HTMLElement): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(root, ".bottom-sheet-handle");
}

function dispatchDrag(
  root: HTMLElement,
  firstClientPoint: { clientX: number; clientY: number },
  oppositeClientPoint: { clientX: number; clientY: number },
  options: { pointerType: "mouse" | "touch"; isShiftPressed: boolean },
): void {
  const mapContainer = requireElement<HTMLElement>(root, ".map-container");
  const pointerInit = {
    bubbles: true,
    cancelable: true,
    pointerId: 5,
    isPrimary: true,
    button: 0,
    pointerType: options.pointerType,
    shiftKey: options.isShiftPressed,
  };
  mapContainer.dispatchEvent(
    new PointerEvent("pointerdown", { ...pointerInit, ...firstClientPoint }),
  );
  mapContainer.dispatchEvent(
    new PointerEvent("pointermove", { ...pointerInit, ...oppositeClientPoint }),
  );
  mapContainer.dispatchEvent(
    new PointerEvent("pointerup", { ...pointerInit, ...oppositeClientPoint }),
  );
}

/** A drag across the middle of the map's visible part (above any open sheet). */
function dragAcrossMapMiddle(root: HTMLElement, pointerType: "mouse" | "touch"): void {
  const mapBox = requireElement(root, ".map-container").getBoundingClientRect();
  const middleClientX = mapBox.left + mapBox.width / 2;
  const middleClientY = mapBox.top + mapBox.height * 0.4;
  dispatchDrag(
    root,
    { clientX: middleClientX - 20, clientY: middleClientY - 20 },
    { clientX: middleClientX + 20, clientY: middleClientY + 20 },
    { pointerType, isShiftPressed: pointerType === "mouse" },
  );
}

const overviewLoader: DataLoader = {
  loadManifest: () => Promise.resolve(fixtureManifest),
  loadDayFile: (dayFile) => Promise.resolve(requireFixtureDayFile(dayFile)),
};

async function waitForOverview(root: HTMLElement): Promise<void> {
  await vi.waitFor(() =>
    expect(requireElement<HTMLElement>(root, ".overview-status").hidden).toBe(true),
  );
}

describe("Overview area result", () => {
  it("comes into view in the side panel when a drag draws an area (desktop)", async () => {
    const root = await startAt(overviewLoader, 1440, 600);
    await waitForOverview(root);
    // Under Layers and Legend, the Area section starts out of view.
    expect(isInPanelView(root, ".overview-panel .select-area-button")).toBe(false);
    dragAcrossMapMiddle(root, "mouse");
    expect(isInPanelView(root, ".area-counts")).toBe(true);
    expect(isInPanelView(root, ".area-passing-through")).toBe(true);
  });

  it("phone: Select area closes the sheet, and the drag's end opens it on the result", async () => {
    const root = await startAt(overviewLoader, 390, 844);
    await waitForOverview(root);
    sheetHandle(root).click(); // the designer opens the sheet to reach Select area
    requireElement<HTMLButtonElement>(root, ".select-area-button").click();
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("false");
    expect(requireElement<HTMLElement>(root, ".bottom-sheet-content").checkVisibility()).toBe(
      false,
    );
    dragAcrossMapMiddle(root, "touch");
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("true");
    expect(isInPanelView(root, ".area-counts")).toBe(true);
  });

  it("phone: turning Select area off leaves the sheet as it is", async () => {
    const root = await startAt(overviewLoader, 390, 844);
    await waitForOverview(root);
    sheetHandle(root).click();
    const selectAreaButton = requireElement<HTMLButtonElement>(root, ".select-area-button");
    selectAreaButton.click(); // on: the sheet closes
    sheetHandle(root).click(); // the designer opens it again
    selectAreaButton.click(); // off
    expect(selectAreaButton.getAttribute("aria-pressed")).toBe("false");
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("true");
  });
});

const replayLoader: DataLoader = {
  loadManifest: () => Promise.resolve(replayManifest),
  loadDayFile: (dayFile) => Promise.resolve(requireReplayDayFile(dayFile)),
};

/** player-b's death, low enough on a phone's map framed on the match that the open sheet would cover it. */
const coveredMarkerPosition: WorldPoint = { worldX: 31, worldZ: 41 };

/** Where a world point is on screen, from the minimap image's own on-screen box. */
function worldToClientPoint(
  root: HTMLElement,
  point: WorldPoint,
): { clientX: number; clientY: number } {
  const imageBox = requireElement(root, ".leaflet-image-layer").getBoundingClientRect();
  const fractionX = (point.worldX - fixtureMapConfig.worldOriginX) / fixtureMapConfig.worldScale;
  const fractionZ = (point.worldZ - fixtureMapConfig.worldOriginZ) / fixtureMapConfig.worldScale;
  return {
    clientX: imageBox.left + fractionX * imageBox.width,
    clientY: imageBox.top + (1 - fractionZ) * imageBox.height,
  };
}

async function startPhoneReplayAt30Seconds(): Promise<HTMLElement> {
  const root = await startAt(replayLoader, 390, 844);
  requireElement<HTMLButtonElement>(root, ".mode-switch button:last-child").click();
  await vi.waitFor(() => expect(root.querySelectorAll(".actor-button")).toHaveLength(5));
  const scrubber = requireElement<HTMLInputElement>(root, ".timeline-scrubber");
  scrubber.value = "30";
  scrubber.dispatchEvent(new Event("input", { bubbles: true }));
  return root;
}

function tapAt(root: HTMLElement, clientPoint: { clientX: number; clientY: number }): void {
  const mapContainer = requireElement(root, ".map-container");
  const pointerInit = { bubbles: true, cancelable: true, pointerId: 9, isPrimary: true };
  const touchInit = { ...pointerInit, pointerType: "touch", ...clientPoint };
  mapContainer.dispatchEvent(new PointerEvent("pointerdown", touchInit));
  mapContainer.dispatchEvent(new PointerEvent("pointerup", touchInit));
}

/** How far the marker sits above the sheet's top edge (negative: under the sheet). */
function markerHeightAboveSheet(root: HTMLElement): number {
  const sheetTopClientY = requireElement(root, ".bottom-sheet").getBoundingClientRect().top;
  return sheetTopClientY - worldToClientPoint(root, coveredMarkerPosition).clientY;
}

/**
 * How far the marker's clearance above the sheet is from the intended clearance. Leaflet pans by
 * whole pixels, so at the match's fractional zoom it lands within a pixel of it.
 */
function clearanceErrorPixels(root: HTMLElement): number {
  return Math.abs(markerHeightAboveSheet(root) - markerClearanceAboveSheetPixels);
}

describe("Replay marker tap on a phone", () => {
  it("opens the closed sheet on the details and keeps the marker above it, without motion when asked", async () => {
    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const root = await startPhoneReplayAt30Seconds();
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("false");
    const markerClientPointBefore = worldToClientPoint(root, coveredMarkerPosition);
    tapAt(root, markerClientPointBefore);

    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("true");
    expect(isInPanelView(root, ".inspected-marker h3")).toBe(true);
    expect(requireElement(root, ".inspected-marker h3").textContent).toBe(
      "Player killed by a player",
    );
    // Moved at once (no animation), up just far enough to clear the sheet.
    expect(clearanceErrorPixels(root)).toBeLessThan(1);
    expect(worldToClientPoint(root, coveredMarkerPosition).clientY).toBeLessThan(
      markerClientPointBefore.clientY,
    );

    // Closing the sheet gives the map its usual limits back. On the map framed on the match the
    // lift stayed inside the image, so nothing is outside those limits and the marker stays put.
    const markerClientYAfterLift = worldToClientPoint(root, coveredMarkerPosition).clientY;
    sheetHandle(root).click();
    expect(worldToClientPoint(root, coveredMarkerPosition).clientY).toBeCloseTo(
      markerClientYAfterLift,
      6,
    );
  });

  it("glides the marker above the sheet when motion is allowed", async () => {
    const root = await startPhoneReplayAt30Seconds();
    tapAt(root, worldToClientPoint(root, coveredMarkerPosition));
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("true");
    await vi.waitFor(() => expect(clearanceErrorPixels(root)).toBeLessThan(1));
  });
});
