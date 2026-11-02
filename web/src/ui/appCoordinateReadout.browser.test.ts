import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { startAppWithLoader } from "./app";
import { fixtureManifest, requireFixtureDayFile } from "./overviewTestFixtures";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): the world-position readout in
// the real app shell, with the app's CSS and media queries. Headless Chromium has a mouse (hover), so
// the app picks pointer mode; crosshair mode is covered by coordinateReadout.browser.test.ts.

const mountedRoots: HTMLElement[] = [];

async function startTestApp(): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.style.height = "600px";
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, {
    loadManifest: () => Promise.resolve(fixtureManifest),
    loadDayFile: (dayFile) => Promise.resolve(requireFixtureDayFile(dayFile)),
  });
  return root;
}

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
  await page.viewport(1280, 800);
});

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Nothing in the app matches "${selector}"`);
  }
  return element;
}

describe("world-position readout in the app", () => {
  it("sits over the map's bottom-left corner and shows the position under the mouse", async () => {
    await page.viewport(1280, 800);
    const root = await startTestApp();
    const mapContainer = requireElement(root, ".map-frame > .map-container");
    const readout = requireElement(root, ".map-frame > .coordinate-readout");
    expect(readout.getAttribute("aria-label")).toBe("World position under the pointer");
    const mapBox = mapContainer.getBoundingClientRect();
    const readoutBox = readout.getBoundingClientRect();
    expect(readoutBox.left).toBeGreaterThanOrEqual(mapBox.left);
    expect(readoutBox.bottom).toBeLessThanOrEqual(mapBox.bottom);
    expect(readoutBox.top).toBeGreaterThan(mapBox.top + mapBox.height / 2);
    expect(requireElement(readout, '[data-world-axis="x"]').textContent).toBe("—");

    mapContainer.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
        clientX: mapBox.left + mapBox.width / 2,
        clientY: mapBox.top + mapBox.height / 2,
      }),
    );
    expect(requireElement(readout, '[data-world-axis="x"]').textContent).toMatch(/^-?\d+\.\d$/);
    expect(requireElement(readout, '[data-world-axis="z"]').textContent).toMatch(/^-?\d+\.\d$/);
  });

  it("at 390 px wide, moves to the top-right corner, clear of the bottom sheet", async () => {
    await page.viewport(390, 844);
    const root = await startTestApp();
    const mapBox = requireElement(root, ".map-container").getBoundingClientRect();
    const readoutBox = requireElement(root, ".coordinate-readout").getBoundingClientRect();
    const sheetBox = requireElement(root, ".bottom-sheet").getBoundingClientRect();
    expect(readoutBox.right).toBeLessThanOrEqual(mapBox.right);
    expect(readoutBox.top).toBeGreaterThanOrEqual(mapBox.top);
    expect(readoutBox.bottom).toBeLessThan(sheetBox.top);
    expect(readoutBox.left).toBeGreaterThan(mapBox.left + mapBox.width / 2);
  });
});
