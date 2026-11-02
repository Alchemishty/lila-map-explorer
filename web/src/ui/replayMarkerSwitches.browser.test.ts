import { page } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import { startAppWithLoader } from "./app";
import { replayManifest, requireReplayDayFile } from "./replayTestFixtures";

// Runs in headless Chromium: Replay's own marker switches.

const immediateLoader: DataLoader = {
  loadManifest: () => Promise.resolve(replayManifest),
  loadDayFile: (dayFile) => Promise.resolve(requireReplayDayFile(dayFile)),
};

const mountedRoots: HTMLElement[] = [];
// Desktop size, so the panels are on screen rather than in the closed phone bottom sheet.
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

async function startReplay(): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.style.height = "700px";
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, immediateLoader);
  requireElement<HTMLButtonElement>(root, ".mode-switch button:last-child").click();
  await vi.waitFor(() => expect(root.querySelectorAll(".actor-button")).toHaveLength(5));
  return root;
}

function lootTickCount(root: HTMLElement): number {
  return root.querySelectorAll('.timeline-tick[data-marker-key="loot"]').length;
}

function replaySwitch(root: HTMLElement, markerKey: string): HTMLInputElement {
  return requireElement<HTMLInputElement>(
    root,
    `.replay-panel .legend-entry[data-marker-key="${markerKey}"] input`,
  );
}

describe("Replay marker switches", () => {
  it("start all on, and the Player looted switch removes the loot ticks", async () => {
    const root = await startReplay();
    const switchStates = [
      ...root.querySelectorAll<HTMLInputElement>(".replay-panel .legend-entry input"),
    ].map((checkbox) => checkbox.checked);
    expect(switchStates).toEqual([true, true, true, true, true, true, true, true]);
    expect(lootTickCount(root)).toBeGreaterThan(0);
    replaySwitch(root, "loot").click();
    expect(replaySwitch(root, "loot").checked).toBe(false);
    expect(lootTickCount(root)).toBe(0);
  });

  it("drop the bot rows and their Only buttons while bots are hidden", async () => {
    const root = await startReplay();
    requireElement<HTMLInputElement>(root, ".hide-bots-switch input").click();
    const visibleRowKeys = [...root.querySelectorAll<HTMLElement>(".replay-panel .legend-entry")]
      .filter((row) => row.checkVisibility())
      .map((row) => row.dataset.markerKey);
    expect(visibleRowKeys).toEqual([
      "kill_player",
      "kill_bot",
      "death_by_player",
      "death_by_bot",
      "storm_death",
      "loot",
    ]);
  });

  it("leave the Overview's switches as they were", async () => {
    const root = await startReplay();
    const overviewButton = requireElement<HTMLButtonElement>(
      root,
      ".mode-switch button:first-child",
    );
    const replayButton = requireElement<HTMLButtonElement>(root, ".mode-switch button:last-child");
    const overviewLootSwitch = requireElement<HTMLInputElement>(
      root,
      '.overview-panel .legend-entry[data-marker-key="loot"] input',
    );
    // Overview starts with loot off, so turn it on there first: a leak from Replay would show.
    overviewButton.click();
    overviewLootSwitch.click();
    await vi.waitFor(() => expect(overviewLootSwitch.checked).toBe(true));
    replayButton.click();
    await vi.waitFor(() => expect(replaySwitch(root, "loot").checked).toBe(true));
    replaySwitch(root, "loot").click();
    expect(replaySwitch(root, "loot").checked).toBe(false);
    overviewButton.click();
    await vi.waitFor(() => expect(overviewLootSwitch.checked).toBe(true));
  });
});
