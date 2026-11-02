import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import type { DayFile } from "../domain/types";
import { startAppWithLoader } from "./app";
import { fixtureManifest, requireFixtureDayFile } from "./overviewTestFixtures";

// Runs in headless Chromium: the marker switches work before the first day files have loaded
// (the e2e smoke test once clicked "Hide all" during the first load and the click was lost).

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

describe("Overview marker switches during the first load", () => {
  it("apply Show all clicked while the day files are still loading", async () => {
    const pendingLoads: (() => void)[] = [];
    const holdingLoader: DataLoader = {
      loadManifest: () => Promise.resolve(fixtureManifest),
      loadDayFile: (dayFile) =>
        new Promise<DayFile>((resolve) => {
          pendingLoads.push(() => resolve(requireFixtureDayFile(dayFile)));
        }),
    };
    const root = document.createElement("div");
    root.style.height = "700px";
    document.body.appendChild(root);
    mountedRoots.push(root);
    await startAppWithLoader(root, holdingLoader);
    expect(pendingLoads.length).toBeGreaterThan(0);

    const lootSwitch = requireElement<HTMLInputElement>(
      root,
      '.overview-panel .legend-entry[data-marker-key="loot"] input',
    );
    expect(lootSwitch.checked).toBe(false); // every marker type starts off
    const showAllButton = [
      ...root.querySelectorAll<HTMLButtonElement>(".overview-panel button"),
    ].find((button) => button.textContent === "Show all");
    if (showAllButton === undefined) {
      throw new Error("The Overview has no Show all button");
    }
    showAllButton.click();
    expect(lootSwitch.checked).toBe(true);

    for (const resolveLoad of pendingLoads.splice(0)) {
      resolveLoad();
    }
    await vi.waitFor(() =>
      expect(requireElement<HTMLElement>(root, ".overview-status").hidden).toBe(true),
    );
    expect(lootSwitch.checked).toBe(true);
  });
});
