import { page } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import type { WorldPoint } from "../domain/types";
import { startAppWithLoader } from "./app";
import { fixtureMapConfig } from "./overviewTestFixtures";
import { replayManifest, requireReplayDayFile } from "./replayTestFixtures";

// Runs in headless Chromium: Replay's trail heads in the real app shell. The "Trail heads" key
// (telemetry audit issue 9) with each swatch drawn on a real canvas, and tapping a head to follow.

const immediateLoader: DataLoader = {
  loadManifest: () => Promise.resolve(replayManifest),
  loadDayFile: (dayFile) => Promise.resolve(requireReplayDayFile(dayFile)),
};

const mountedRoots: HTMLElement[] = [];

// Desktop size, so the map is fully visible and taps land where the tests compute.
beforeEach(async () => {
  await page.viewport(1280, 800);
});

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

function seekTo(root: HTMLElement, elapsedSeconds: number): void {
  const scrubber = requireElement<HTMLInputElement>(root, ".timeline-scrubber");
  scrubber.value = String(elapsedSeconds);
  scrubber.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Where a world point is on screen, from the minimap image's own on-screen box (Leaflet's image layer). */
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

function tapMapAt(root: HTMLElement, point: WorldPoint): void {
  const mapContainer = requireElement(root, ".map-container");
  const clientPoint = worldToClientPoint(root, point);
  const pointerInit = {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    isPrimary: true,
    pointerType: "mouse",
    clientX: clientPoint.clientX,
    clientY: clientPoint.clientY,
  };
  mapContainer.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  mapContainer.dispatchEvent(new PointerEvent("pointerup", pointerInit));
}

/** The text of each heading, line and hint in the Replay inspector (the panel's first section). */
function inspectorText(root: HTMLElement): (string | null)[] {
  const inspectorSection = requireElement(root, ".replay-panel .panel-section");
  expect(requireElement(inspectorSection, "h2").textContent).toBe("Inspector");
  return [...inspectorSection.querySelectorAll("h3, li, p")].map((element) => element.textContent);
}

/** Starts the app, enters Replay and waits for the multiplayer match's 5 actors. */
async function startReplay(): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.style.height = "700px";
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, immediateLoader);
  const replayButton = root.querySelector<HTMLButtonElement>(".mode-switch button:last-child");
  if (replayButton === null) {
    throw new Error("The app has no Replay mode button");
  }
  replayButton.click();
  await vi.waitFor(() => expect(root.querySelectorAll(".actor-button")).toHaveLength(5));
  return root;
}

describe("Replay trail heads", () => {
  it("explains every trail head state in the legend, with a drawn swatch for each", async () => {
    const root = await startReplay();
    const keyRows = [...root.querySelectorAll<HTMLElement>(".replay-panel .trail-head-key-row")];
    expect(keyRows.map((row) => row.dataset.headState)).toEqual([
      "moving",
      "waiting",
      "dead",
      "last_seen",
    ]);
    expect(keyRows.map((row) => row.querySelector("strong")?.textContent)).toEqual([
      "Moving",
      "Waiting (alive)",
      "Dead here",
      "Last seen here",
    ]);
    expect(keyRows[3]?.textContent).toContain("What happened next is unknown.");
    for (const row of keyRows) {
      const swatch = row.querySelector("canvas");
      expect(swatch?.getAttribute("aria-hidden")).toBe("true");
      const swatchContext = swatch?.getContext("2d");
      const swatchPixels = swatchContext?.getImageData(
        0,
        0,
        swatch?.width ?? 0,
        swatch?.height ?? 0,
      );
      expect(swatchPixels?.data.some((channelValue) => channelValue > 0)).toBe(true);
    }
  });

  it("tapping a marker shows its details; tapping a trail head follows that actor", async () => {
    const root = await startReplay();
    seekTo(root, 30);
    tapMapAt(root, { worldX: 71, worldZ: 81 });
    expect(inspectorText(root)).toEqual([
      "Bot died (killer not recorded)",
      "Time into match: 0:30",
      "Bot: bot-2",
      "Killer: not recorded",
    ]);
    // player-c walks from (-5, -6) at 2 s to (-5, 10) at 100 s: at 30 s it is 28/98 of the way.
    tapMapAt(root, { worldX: -5, worldZ: -6 + (16 * 28) / 98 });
    expect(
      requireElement(root, '.actor-button[data-actor-key="player-c"]').getAttribute("aria-pressed"),
    ).toBe("true");
    expect(inspectorText(root)).toEqual([
      "Player player-c",
      "Now: Moving",
      "Kills of players: 0",
      "Kills of bots: 0",
      "Loot events: 0",
    ]);
  });
});
