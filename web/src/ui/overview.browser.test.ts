import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import type { DayFile } from "../domain/types";
import { startAppWithLoader } from "./app";
import { errorViewHeading } from "./errorView";
import { fixtureManifest, requireFixtureDayFile } from "./overviewTestFixtures";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): the Overview panel in the real
// app shell, with Leaflet, the canvas overlay and pointer events.

interface PendingDayFile {
  readonly dayFile: string;
  resolve(): void;
}

/** A loader whose day files load only when the test resolves them. */
function createControlledLoader(): { loader: DataLoader; pendingDayFiles: PendingDayFile[] } {
  const pendingDayFiles: PendingDayFile[] = [];
  const loader: DataLoader = {
    loadManifest: () => Promise.resolve(fixtureManifest),
    loadDayFile: (dayFile) =>
      new Promise<DayFile>((resolve) => {
        pendingDayFiles.push({ dayFile, resolve: () => resolve(requireFixtureDayFile(dayFile)) });
      }),
  };
  return { loader, pendingDayFiles };
}

const immediateLoader: DataLoader = {
  loadManifest: () => Promise.resolve(fixtureManifest),
  loadDayFile: (dayFile) => Promise.resolve(requireFixtureDayFile(dayFile)),
};

const mountedRoots: HTMLElement[] = [];

async function startOverview(loader: DataLoader): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.style.height = "700px";
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, loader);
  return root;
}

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

async function waitForPanel(root: HTMLElement): Promise<void> {
  await vi.waitFor(() =>
    expect(requireElement<HTMLElement>(root, ".overview-status").hidden).toBe(true),
  );
}

function radioLabelled(root: HTMLElement, labelText: string): HTMLInputElement {
  const label = [...root.querySelectorAll(".heatmap-choice label")].find(
    (candidate) => candidate.textContent === labelText,
  );
  if (label === undefined) {
    throw new Error(`The heatmap choice has no option "${labelText}"`);
  }
  return requireElement<HTMLInputElement>(label, "input");
}

function buttonNamed(root: HTMLElement, buttonText: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === buttonText,
  );
  if (button === undefined) {
    throw new Error(`The app has no button "${buttonText}"`);
  }
  return button;
}

/** The number of overlay canvas pixels with any paint on them. */
function countPaintedOverlayPixels(root: HTMLElement): number {
  const overlayCanvas = requireElement<HTMLCanvasElement>(root, ".map-container canvas");
  const context = overlayCanvas.getContext("2d");
  if (context === null) {
    throw new Error("The overlay canvas has no 2D context");
  }
  const { data } = context.getImageData(0, 0, overlayCanvas.width, overlayCanvas.height);
  let paintedPixelCount = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) {
      paintedPixelCount += 1;
    }
  }
  return paintedPixelCount;
}

function shiftDragAcrossMapCenter(root: HTMLElement, halfSidePixels: number): void {
  const mapContainer = requireElement<HTMLElement>(root, ".map-container");
  const containerBox = mapContainer.getBoundingClientRect();
  const centerClientX = containerBox.left + containerBox.width / 2;
  const centerClientY = containerBox.top + containerBox.height / 2;
  const pointerInit = { bubbles: true, cancelable: true, pointerId: 3, isPrimary: true };
  const firstCorner = {
    clientX: centerClientX - halfSidePixels,
    clientY: centerClientY - halfSidePixels,
  };
  const oppositeCorner = {
    clientX: centerClientX + halfSidePixels,
    clientY: centerClientY + halfSidePixels,
  };
  mapContainer.dispatchEvent(
    new PointerEvent("pointerdown", {
      ...pointerInit,
      ...firstCorner,
      shiftKey: true,
      pointerType: "mouse",
    }),
  );
  mapContainer.dispatchEvent(
    new PointerEvent("pointermove", { ...pointerInit, ...oppositeCorner }),
  );
  mapContainer.dispatchEvent(new PointerEvent("pointerup", { ...pointerInit, ...oppositeCorner }));
}

describe("Overview panel loading", () => {
  it('shows "Loading…" while the day files load in parallel, then the layers', async () => {
    const { loader, pendingDayFiles } = createControlledLoader();
    const root = await startOverview(loader);
    const statusElement = requireElement<HTMLElement>(root, ".overview-status");
    expect(statusElement.textContent).toBe("Loading…");
    expect(pendingDayFiles.map((pending) => pending.dayFile)).toEqual([
      "days/Lockdown/2026-02-10.json",
      "days/Lockdown/2026-02-11.json",
    ]);
    for (const pending of pendingDayFiles) {
      pending.resolve();
    }
    await waitForPanel(root);
    expect(radioLabelled(root, "Kill zones").checked).toBe(true);
    expect(countPaintedOverlayPixels(root)).toBeGreaterThan(0);
  });

  it("ignores a load that finishes after the filters went back to already-loaded days", async () => {
    const { loader, pendingDayFiles } = createControlledLoader();
    const root = await startOverview(loader);
    for (const pending of pendingDayFiles.splice(0)) {
      pending.resolve();
    }
    await waitForPanel(root);
    const dayCheckbox = requireElement<HTMLInputElement>(root, 'input[value="2026-02-10"]');
    dayCheckbox.click(); // only Feb 11: its day file starts loading
    expect(pendingDayFiles.map((pending) => pending.dayFile)).toEqual([
      "days/Lockdown/2026-02-11.json",
    ]);
    dayCheckbox.click(); // back to both days, which are already loaded
    for (const pending of pendingDayFiles.splice(0)) {
      pending.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector("h1")).toBeNull();
    expect(requireElement(root, ".overview-panel .marker-switch-bot-heading").textContent).toBe(
      "Bot events (2 of 3 matches have bot data)",
    );
    expect(countPaintedOverlayPixels(root)).toBeGreaterThan(0);
  });

  it("shows the error view, naming the file, when a day file fails to load", async () => {
    const root = await startOverview({
      loadManifest: () => Promise.resolve(fixtureManifest),
      loadDayFile: (dayFile) =>
        Promise.reject(new Error(`Could not load data/${dayFile}: HTTP 404`)),
    });
    await vi.waitFor(() => expect(root.querySelector("h1")?.textContent).toBe(errorViewHeading));
    expect(root.textContent).toContain(
      "Could not load data/days/Lockdown/2026-02-10.json: HTTP 404",
    );
  });
});

describe("Overview layers and legend", () => {
  it("lists 8 marker switches, all off at the start, under a bot heading that counts bot data", async () => {
    const root = await startOverview(immediateLoader);
    await waitForPanel(root);
    expect(root.querySelector(".markers-switch")).toBeNull();
    expect(root.querySelector(".bot-events-switch")).toBeNull();
    expect(requireElement(root, ".marker-position-explanation").textContent).toBe(
      "Kill markers show the killer’s position. Death markers show where the actor died.",
    );
    expect(
      [...root.querySelectorAll(".heatmap-choice label")].map((label) => label.textContent),
    ).toEqual(["Off", "Kill zones", "Combat death zones", "Storm death zones", "Traffic"]);
    expect(
      [...root.querySelectorAll(".heatmap-choice p")].map((description) => description.textContent),
    ).toEqual([
      "Where players stood when they made a kill",
      "Where players were killed by a player or a bot",
      "Where players died to the storm",
      "Where players spent the most time",
    ]);
    for (const input of root.querySelectorAll<HTMLInputElement>(
      ".heatmap-choice input:not([value=off])",
    )) {
      const descriptionId = input.getAttribute("aria-describedby");
      expect(descriptionId).not.toBeNull();
      expect(root.querySelector(`[id="${descriptionId}"]`)?.textContent).not.toBe("");
    }
    expect(requireElement(root, ".overview-panel .marker-switch-bot-heading").textContent).toBe(
      "Bot events (2 of 3 matches have bot data)",
    );
    const switchStates = [...root.querySelectorAll(".overview-panel .legend-entry label")].map(
      (label) => [label.textContent, requireElement<HTMLInputElement>(label, "input").checked],
    );
    expect(switchStates).toHaveLength(8);
    expect(switchStates.filter(([, isChecked]) => isChecked)).toEqual([]);
    expect(switchStates.slice(6)).toEqual([
      ["Bot made a kill (victim not recorded)", false],
      ["Bot died (killer not recorded)", false],
    ]);
  });

  it("draws the storm-death heatmap alone, and nothing with heatmap off and all markers hidden", async () => {
    const root = await startOverview(immediateLoader);
    await waitForPanel(root);
    buttonNamed(root, "Hide all").click();
    radioLabelled(root, "Storm death zones").click();
    expect(countPaintedOverlayPixels(root)).toBeGreaterThan(0);
    radioLabelled(root, "Off").click();
    expect(countPaintedOverlayPixels(root)).toBe(0);
  });

  it("hides only loot when the Player looted switch is turned off", async () => {
    const root = await startOverview(immediateLoader);
    await waitForPanel(root);
    radioLabelled(root, "Off").click();
    buttonNamed(root, "Show all").click(); // every marker type starts off
    const allMarkersPixels = countPaintedOverlayPixels(root);
    const lootRow = requireElement(root, '.overview-panel .legend-entry[data-marker-key="loot"]');
    requireElement<HTMLInputElement>(lootRow, "input").click();
    const withoutLootPixels = countPaintedOverlayPixels(root);
    expect(withoutLootPixels).toBeGreaterThan(0);
    expect(withoutLootPixels).toBeLessThan(allMarkersPixels);
    buttonNamed(root, "Hide all").click();
    expect(countPaintedOverlayPixels(root)).toBe(0);
  });
});

describe("Overview area inspector", () => {
  it("shows the area's counts and opens Replay on the chosen match from the list", async () => {
    const root = await startOverview(immediateLoader);
    await waitForPanel(root);
    expect(requireElement(root, ".panel-hint").textContent).toContain("Shift-drag");
    shiftDragAcrossMapCenter(root, 20);
    expect(requireElement(root, ".area-passing-through").textContent).toBe(
      "Player paths crossed this area in 2 matches",
    );
    expect(
      requireElement(root, '.area-counts [data-marker-key="loot"] .marker-count').textContent,
    ).toBe("0");
    const matchRowButtons = root.querySelectorAll<HTMLButtonElement>(".replay-match-button");
    expect([...matchRowButtons].map((button) => button.dataset.matchId)).toEqual(["early", "last"]);
    requireElement<HTMLButtonElement>(root, '.replay-match-button[data-match-id="last"]').click();
    expect(
      requireElement(root, ".mode-switch button:last-child").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(requireElement<HTMLSelectElement>(root, ".replay-match-field select").value).toBe(
      "last",
    );
    expect(requireElement<HTMLElement>(root, ".overview-panel").hidden).toBe(true);
    expect(countPaintedOverlayPixels(root)).toBe(0);
  });
});

describe("Overview with no matches (Review Focus 1)", () => {
  it('shows "No matches for these filters" and an empty map when no day is chosen', async () => {
    const root = await startOverview(immediateLoader);
    await waitForPanel(root);
    expect(countPaintedOverlayPixels(root)).toBeGreaterThan(0);
    for (const dayUtc of ["2026-02-10", "2026-02-11"]) {
      requireElement<HTMLInputElement>(root, `input[type="checkbox"][value="${dayUtc}"]`).click();
    }
    const statusElement = requireElement<HTMLElement>(root, ".overview-status");
    expect(statusElement.hidden).toBe(false);
    expect(statusElement.textContent).toBe("No matches for these filters");
    expect(countPaintedOverlayPixels(root)).toBe(0);
    expect(requireElement(root, ".overview-panel .marker-switch-bot-heading").textContent).toBe(
      "Bot events (0 of 0 matches have bot data)",
    );
  });
});
