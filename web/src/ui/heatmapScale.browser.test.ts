import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import type { DayFile } from "../domain/types";
import { heatRampCssGradient } from "../render/heatRamp";
import { startAppWithLoader } from "./app";
import { createHeatmapScale, raisedColorTopNoteText } from "./heatmapChoices";
import { fixtureManifest, requireFixtureDayFile } from "./overviewTestFixtures";

// Runs in headless Chromium: the colour scale under the heatmap choices, in the real app
// shell.

const immediateLoader: DataLoader = {
  loadManifest: () => Promise.resolve(fixtureManifest),
  loadDayFile: (dayFile) => Promise.resolve(requireFixtureDayFile(dayFile)),
};

const mountedRoots: HTMLElement[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
});

async function startOverview(): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.style.height = "700px";
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, immediateLoader);
  await vi.waitFor(() => expect(requireElement(root, ".overview-status").hidden).toBe(true));
  return root;
}

function requireElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`Nothing in the app matches "${selector}"`);
  }
  return element;
}

function chooseHeatmap(root: HTMLElement, labelText: string): HTMLInputElement {
  const label = [...root.querySelectorAll(".heatmap-choice label")].find(
    (candidate) => candidate.textContent === labelText,
  );
  if (label === undefined) {
    throw new Error(`The heatmap choice has no option "${labelText}"`);
  }
  const input = label.querySelector("input");
  if (input === null) {
    throw new Error(`The heatmap choice "${labelText}" has no input`);
  }
  input.click();
  return input;
}

describe("the heatmap colour scale", () => {
  it("hides while new day files load, so it never shows a total the map no longer draws", async () => {
    const pendingLoads: (() => void)[] = [];
    let isHoldingLoads = false;
    const holdingLoader: DataLoader = {
      loadManifest: () => Promise.resolve(fixtureManifest),
      loadDayFile: (dayFile) =>
        isHoldingLoads
          ? new Promise<DayFile>((resolve) => {
              pendingLoads.push(() => resolve(requireFixtureDayFile(dayFile)));
            })
          : Promise.resolve(requireFixtureDayFile(dayFile)),
    };
    const root = document.createElement("div");
    root.style.height = "700px";
    document.body.appendChild(root);
    mountedRoots.push(root);
    await startAppWithLoader(root, holdingLoader);
    await vi.waitFor(() => expect(requireElement(root, ".overview-status").hidden).toBe(true));
    chooseHeatmap(root, "Storm death zones");
    expect(requireElement(root, ".heatmap-scale").hidden).toBe(false);

    isHoldingLoads = true;
    const dayCheckbox = root.querySelector<HTMLInputElement>('input[value="2026-02-10"]');
    if (dayCheckbox === null) {
      throw new Error("The fixture has no Feb 10 day checkbox");
    }
    dayCheckbox.click(); // only Feb 11: its day file starts loading
    expect(pendingLoads).toHaveLength(1);
    expect(requireElement(root, ".heatmap-scale").hidden).toBe(true);

    for (const resolveLoad of pendingLoads.splice(0)) {
      resolveLoad();
    }
    await vi.waitFor(() => expect(requireElement(root, ".heatmap-scale").hidden).toBe(false));
  });

  it("opens on Kill zones, with its scale showing and every marker switch off", async () => {
    const root = await startOverview();
    const killZonesInput = root.querySelector<HTMLInputElement>('input[value="kills"]');
    expect(killZonesInput?.checked).toBe(true);
    expect(requireElement(root, ".heatmap-scale").hidden).toBe(false);
    expect(requireElement(root, ".heatmap-scale-title").textContent).toMatch(
      /^Kill zones · \d+ kills?$/,
    );
    const markerSwitches = [
      ...root.querySelectorAll<HTMLInputElement>('.overview-panel input[type="checkbox"]'),
    ];
    expect(markerSwitches.length).toBeGreaterThan(0);
    expect(markerSwitches.filter((markerSwitch) => markerSwitch.checked)).toEqual([]);
  });

  it("outlines the busiest part of the bar, from the ramp's red stop to its end, with no caption", async () => {
    await page.viewport(1280, 800); // desktop: the side panel is laid out, so the bar has a width
    const root = await startOverview();
    const bar = requireElement(root, ".heatmap-scale-bar");
    const outline = requireElement(bar, ".heatmap-scale-busiest-outline");
    const barBox = bar.getBoundingClientRect();
    const outlineBox = outline.getBoundingClientRect();
    expect(barBox.width).toBeGreaterThan(100);
    expect(outlineBox.left).toBeCloseTo(barBox.left + 0.75 * barBox.width, 0);
    expect(outlineBox.right).toBeCloseTo(barBox.right + 2, 0);
    expect(getComputedStyle(outline).borderTopColor).toBe("rgb(255, 255, 255)");
    // The outlined end sits over "busiest zone", which explains it, so no caption is added.
    expect(requireElement(root, ".heatmap-scale").textContent).not.toContain("outline");
  });

  it("refuses a busiest-zone start outside the bar", () => {
    expect(() => createHeatmapScale("none", 100)).toThrow(
      "The busiest zones must start inside the colour scale, got 100%",
    );
    expect(() => createHeatmapScale("none", Number.NaN)).toThrow("got NaN%");
  });

  it("is hidden while the heatmap is off", async () => {
    const root = await startOverview();
    chooseHeatmap(root, "Off");
    expect(requireElement(root, ".heatmap-scale").hidden).toBe(true);
  });

  it("shows the chosen heatmap's name, its exact total, the ramp and the end words", async () => {
    const root = await startOverview();
    chooseHeatmap(root, "Storm death zones");
    const scale = requireElement(root, ".heatmap-scale");
    expect(scale.hidden).toBe(false);
    expect(requireElement(scale, ".heatmap-scale-title").textContent).toBe(
      "Storm death zones · 2 storm deaths",
    );
    const bar = requireElement(scale, ".heatmap-scale-bar");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    // The browser rounds fractional colour channels when it stores the gradient, so compare with
    // the ramp's gradient as the browser stores it.
    const expectedBar = document.createElement("div");
    expectedBar.style.backgroundImage = heatRampCssGradient();
    expect(bar.style.backgroundImage).toBe(expectedBar.style.backgroundImage);
    expect(bar.style.backgroundImage).toContain("rgba(110, 0, 30, 0.92)");
    expect(requireElement(scale, ".heatmap-scale-fewer").textContent).toBe("fewer");
    expect(requireElement(scale, ".heatmap-scale-busiest").textContent).toBe("busiest zone");
  });

  it("follows the heatmap choice, so switching kind changes the title", async () => {
    const root = await startOverview();
    chooseHeatmap(root, "Storm death zones");
    chooseHeatmap(root, "Kill zones");
    expect(requireElement(root, ".heatmap-scale-title").textContent).toMatch(
      /^Kill zones · \d+ kills?$/,
    );
  });

  it("notes when so few events are shown that none reaches the darkest colour", async () => {
    const root = await startOverview();
    chooseHeatmap(root, "Storm death zones");
    const note = requireElement(root, ".heatmap-scale-note");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(raisedColorTopNoteText);
    expect(note.textContent).toBe(
      "Few events here, so dark red is kept for 5 or more in one spot.",
    );
    chooseHeatmap(root, "Traffic");
    expect(note.hidden).toBe(true);
  });
});
