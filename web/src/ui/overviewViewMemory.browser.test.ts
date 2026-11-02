import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import type { Manifest } from "../domain/types";
import { startAppWithLoader } from "./app";
import { fixtureMapConfig } from "./overviewTestFixtures";
import { replayManifest, requireReplayDayFile } from "./replayTestFixtures";

// Runs in headless Chromium: Overview keeps its own view. Replay frames each match it loads, and
// coming back to Overview puts back the view the designer left Overview at: the whole map if they
// never zoomed, their zoomed-in spot if they did. A map changed in Replay shows the whole new map.

const otherMapId = "OtherMap";
const twoMapManifest: Manifest = {
  ...replayManifest,
  maps: [...replayManifest.maps, { ...fixtureMapConfig, mapId: otherMapId }],
};

function loaderFor(manifest: Manifest): DataLoader {
  return {
    loadManifest: () => Promise.resolve(manifest),
    loadDayFile: (dayFile) => Promise.resolve(requireReplayDayFile(dayFile)),
  };
}

const mountedRoots: HTMLElement[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
});

function requireElement<Found extends Element>(root: ParentNode, selector: string): Found {
  const element = root.querySelector<Found>(selector);
  if (element === null) {
    throw new Error(`Nothing in the app matches "${selector}"`);
  }
  return element;
}

async function startDesktop(manifest: Manifest): Promise<HTMLElement> {
  await page.viewport(1280, 800);
  const root = document.createElement("div");
  root.style.height = "800px";
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, loaderFor(manifest));
  await vi.waitFor(() =>
    expect(requireElement<HTMLElement>(root, ".overview-status").hidden).toBe(true),
  );
  return root;
}

/** Where the minimap image is on screen: it moves and scales with every pan and zoom. */
function imageBox(root: HTMLElement): { left: number; top: number; width: number } {
  const box = requireElement(root, ".leaflet-image-layer").getBoundingClientRect();
  return { left: box.left, top: box.top, width: box.width };
}

function expectSameBox(
  actual: { left: number; top: number; width: number },
  expected: { left: number; top: number; width: number },
): void {
  expect(actual.left).toBeCloseTo(expected.left, 0);
  expect(actual.top).toBeCloseTo(expected.top, 0);
  expect(actual.width).toBeCloseTo(expected.width, 0);
}

async function visitReplayAndComeBack(
  root: HTMLElement,
  boxBefore: { width: number },
): Promise<void> {
  requireElement<HTMLButtonElement>(root, ".mode-switch button:last-child").click();
  await vi.waitFor(() => expect(root.querySelectorAll(".actor-button")).toHaveLength(5));
  // Replay framed its match, so the view really did change.
  expect(imageBox(root).width).not.toBeCloseTo(boxBefore.width, 0);
  requireElement<HTMLButtonElement>(root, ".mode-switch button:first-child").click();
}

describe("Overview's view after a visit to Replay", () => {
  it("is the whole map again when the designer never zoomed", async () => {
    const root = await startDesktop(replayManifest);
    const wholeMapBox = imageBox(root);
    await visitReplayAndComeBack(root, wholeMapBox);
    expectSameBox(imageBox(root), wholeMapBox);
  });

  it("is the designer's own zoomed-in view when they had zoomed", async () => {
    const root = await startDesktop(replayManifest);
    requireElement<HTMLAnchorElement>(root, ".leaflet-control-zoom-in").click();
    requireElement<HTMLAnchorElement>(root, ".leaflet-control-zoom-in").click();
    const zoomedBox = imageBox(root);
    await visitReplayAndComeBack(root, zoomedBox);
    expectSameBox(imageBox(root), zoomedBox);
  });

  it("is the whole new map when the map was changed in Replay", async () => {
    const root = await startDesktop(twoMapManifest);
    const wholeMapBox = imageBox(root);
    requireElement<HTMLAnchorElement>(root, ".leaflet-control-zoom-in").click();
    requireElement<HTMLButtonElement>(root, ".mode-switch button:last-child").click();
    await vi.waitFor(() => expect(root.querySelectorAll(".actor-button")).toHaveLength(5));
    const mapSelect = requireElement<HTMLSelectElement>(root, ".map-field select");
    mapSelect.value = otherMapId;
    mapSelect.dispatchEvent(new Event("change", { bubbles: true }));
    requireElement<HTMLButtonElement>(root, ".mode-switch button:first-child").click();
    // The other map uses the same image size, so its whole-map box is the first map's.
    expectSameBox(imageBox(root), wholeMapBox);
  });
});
