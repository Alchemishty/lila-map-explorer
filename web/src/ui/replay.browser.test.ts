import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import { startAppWithLoader } from "./app";
import { replayInspectorHintText } from "./replayInspector";
import { replayManifest, requireReplayDayFile } from "./replayTestFixtures";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): the Replay panel in the real
// app shell, with Leaflet, the canvas overlay, requestAnimationFrame and pointer events.

const immediateLoader: DataLoader = {
  loadManifest: () => Promise.resolve(replayManifest),
  loadDayFile: (dayFile) => Promise.resolve(requireReplayDayFile(dayFile)),
};

const mountedRoots: HTMLElement[] = [];

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
  await page.viewport(1280, 800);
});

function requireElement<Found extends Element>(root: ParentNode, selector: string): Found {
  const element = root.querySelector<Found>(selector);
  if (element === null) {
    throw new Error(`Nothing in the app matches "${selector}"`);
  }
  return element;
}

/** Starts the app in a 700 px tall root, enters Replay and waits for the multiplayer match. */
async function startReplay(): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.style.height = "700px";
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, immediateLoader);
  requireElement<HTMLButtonElement>(root, ".mode-switch button:last-child").click();
  await vi.waitFor(() => expect(actorKeysListed(root)).toHaveLength(5));
  return root;
}

function actorKeysListed(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(".actor-button")].map((actorButton) => {
    const actorKey = actorButton.dataset.actorKey;
    if (actorKey === undefined) {
      throw new Error("An actor button has no actor key");
    }
    return actorKey;
  });
}

function clockText(root: HTMLElement): string | null {
  return requireElement(root, ".timeline-clock").textContent;
}

/** The playback clock exactly, in elapsed seconds (the scrubber holds it unrounded). */
function scrubberElapsedSeconds(root: HTMLElement): number {
  return Number(requireElement<HTMLInputElement>(root, ".timeline-scrubber").value);
}

/** Resolves after the browser has drawn a few more animation frames. */
function waitForAnimationFrames(frameCount: number): Promise<void> {
  return new Promise((resolve) => {
    let framesLeft = frameCount;
    const countFrame = (): void => {
      framesLeft -= 1;
      if (framesLeft === 0) {
        resolve();
      } else {
        requestAnimationFrame(countFrame);
      }
    };
    requestAnimationFrame(countFrame);
  });
}

function playButton(root: HTMLElement): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(root, ".timeline-play-button");
}

function seekTo(root: HTMLElement, elapsedSeconds: number): void {
  const scrubber = requireElement<HTMLInputElement>(root, ".timeline-scrubber");
  scrubber.value = String(elapsedSeconds);
  scrubber.dispatchEvent(new Event("input", { bubbles: true }));
}

function chooseReplayMatch(root: HTMLElement, matchId: string): void {
  const replaySelect = requireElement<HTMLSelectElement>(root, ".replay-match-field select");
  replaySelect.value = matchId;
  replaySelect.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The text of each heading, line and hint in the Replay inspector (the panel's first section). */
function inspectorText(root: HTMLElement): (string | null)[] {
  const inspectorSection = requireElement(root, ".replay-panel .panel-section");
  expect(requireElement(inspectorSection, "h2").textContent).toBe("Inspector");
  return [...inspectorSection.querySelectorAll("h3, li, p")].map((element) => element.textContent);
}

describe("Replay panel", () => {
  it("lists every actor, shows the legend with bot events and starts paused at 0:00", async () => {
    const root = await startReplay();
    expect(actorKeysListed(root)).toEqual([
      "player-a-0f3c9e2d",
      "player-b",
      "player-c",
      "bot-1",
      "bot-2",
    ]);
    expect(
      [...root.querySelectorAll(".actor-button .actor-key")].map((key) => key.textContent),
    ).toEqual(["player-a", "player-b", "player-c", "bot-1", "bot-2"]);
    expect(root.querySelectorAll(".replay-panel .legend-entry")).toHaveLength(8);
    expect(clockText(root)).toBe("0:00 / 1:40");
    expect(playButton(root).getAttribute("aria-label")).toBe("Play");
    expect(requireElement<HTMLElement>(root, ".no-bot-files-note").hidden).toBe(true);
    expect(root.querySelectorAll(".timeline-tick")).toHaveLength(6);
    expect(inspectorText(root)).toEqual([replayInspectorHintText]);
  });

  it("plays with requestAnimationFrame, and pauses", async () => {
    const root = await startReplay();
    requireElement<HTMLButtonElement>(root, ".timeline-speeds button:last-child").click();
    playButton(root).click();
    expect(playButton(root).getAttribute("aria-label")).toBe("Pause");
    await vi.waitFor(() => expect(clockText(root)).not.toBe("0:00 / 1:40"), { timeout: 3000 });
    playButton(root).click();
    const pausedElapsedSeconds = scrubberElapsedSeconds(root);
    await waitForAnimationFrames(5);
    expect(scrubberElapsedSeconds(root)).toBe(pausedElapsedSeconds);
  });

  it("switching match mid-playback stops at 0:00 and lists only the new match's actors", async () => {
    const root = await startReplay();
    requireElement<HTMLButtonElement>(root, ".timeline-speeds button:last-child").click();
    playButton(root).click();
    requireElement<HTMLButtonElement>(root, '.actor-button[data-actor-key="bot-1"]').click();
    await vi.waitFor(() => expect(clockText(root)).not.toBe("0:00 / 1:40"), { timeout: 3000 });
    chooseReplayMatch(root, "quiet");
    await vi.waitFor(() => expect(actorKeysListed(root)).toEqual(["player-d"]));
    expect(clockText(root)).toBe("0:00 / 1:20");
    expect(playButton(root).getAttribute("aria-label")).toBe("Play");
    expect(root.querySelector('.actor-button[aria-pressed="true"]')).toBeNull();
    expect(requireElement(root, ".no-bot-files-note").textContent).toBe(
      "No bot tracks were recorded. Player events involving bots are still shown.",
    );
    await waitForAnimationFrames(5);
    expect(scrubberElapsedSeconds(root)).toBe(0);
  });

  it("leaving Replay mid-playback stops the clock; coming back starts at 0:00", async () => {
    const root = await startReplay();
    playButton(root).click();
    seekTo(root, 50);
    requireElement<HTMLButtonElement>(root, ".mode-switch button:first-child").click();
    requireElement<HTMLButtonElement>(root, ".mode-switch button:last-child").click();
    expect(clockText(root)).toBe("0:00 / 1:40");
    expect(playButton(root).getAttribute("aria-label")).toBe("Play");
    await waitForAnimationFrames(5);
    expect(scrubberElapsedSeconds(root)).toBe(0);
  });

  it("seeks with the scrubber and with an event tick, and changes speed", async () => {
    const root = await startReplay();
    seekTo(root, 42.5);
    expect(clockText(root)).toBe("0:42 / 1:40");
    requireElement<HTMLButtonElement>(
      root,
      '.timeline-tick[aria-label="Player looted at 0:15"]',
    ).click();
    expect(clockText(root)).toBe("0:15 / 1:40");
    const fourTimesButton = requireElement<HTMLButtonElement>(
      root,
      ".timeline-speeds button:nth-child(2)",
    );
    fourTimesButton.click();
    expect(fourTimesButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("follows an actor from the list, and Hide bots hides bots and their legend entries", async () => {
    const root = await startReplay();
    seekTo(root, 100);
    expect(requireElement(root, ".hide-bots-switch").textContent).toBe(
      "Hide bot tracks and bot events",
    );
    expect(requireElement(root, "#bot-visibility-hint").textContent).toBe(
      "Player events involving bots remain visible.",
    );
    expect(requireElement(root, ".actor-list").getAttribute("aria-label")).toBe("Players and bots");
    expect(requireElement(root, ".replay-panel .marker-position-explanation").textContent).toBe(
      "Kill markers show the killer’s position. Death markers show where the actor died.",
    );
    requireElement<HTMLButtonElement>(
      root,
      '.actor-button[data-actor-key="player-a-0f3c9e2d"]',
    ).click();
    expect(inspectorText(root)).toEqual([
      "Player player-a",
      "Now: Last seen here",
      "Kills of players: 1",
      "Kills of bots: 1",
      "Loot events: 1",
    ]);
    requireElement<HTMLInputElement>(root, ".hide-bots-switch input").click();
    expect(actorKeysListed(root)).toEqual(["player-a-0f3c9e2d", "player-b", "player-c"]);
    // The visible legend rows with bots hidden: replayMarkerSwitches.browser.test.ts.
    expect(root.querySelectorAll(".timeline-tick")).toHaveLength(4);
  });
});

describe("Replay layout", () => {
  it("docks the timeline under the map on desktop, and hides it in Overview", async () => {
    const root = await startReplay();
    const mapBox = requireElement(root, ".map-container").getBoundingClientRect();
    const timelineBox = requireElement(root, ".timeline").getBoundingClientRect();
    expect(timelineBox.top).toBe(mapBox.bottom);
    expect(timelineBox.left).toBe(mapBox.left);
    requireElement<HTMLButtonElement>(root, ".mode-switch button:first-child").click();
    expect(requireElement<HTMLElement>(root, ".timeline").hidden).toBe(true);
  });

  it("at 390 px wide, keeps the timeline on screen under the bottom sheet", async () => {
    await page.viewport(390, 844);
    const root = await startReplay();
    const rootBox = root.getBoundingClientRect();
    const sheetBox = requireElement(root, ".bottom-sheet").getBoundingClientRect();
    const timelineBox = requireElement(root, ".timeline").getBoundingClientRect();
    expect(timelineBox.top).toBeGreaterThanOrEqual(sheetBox.bottom);
    expect(timelineBox.bottom).toBeLessThanOrEqual(rootBox.bottom);
    expect(timelineBox.width).toBe(rootBox.width);
  });

  it("at 390 px wide, shows the whole Replay match picker on screen", async () => {
    await page.viewport(390, 844);
    const root = await startReplay();
    const rootBox = root.getBoundingClientRect();
    const pickerBox = requireElement(root, ".replay-match-field select").getBoundingClientRect();
    expect(pickerBox.left).toBeGreaterThanOrEqual(rootBox.left);
    expect(pickerBox.right).toBeLessThanOrEqual(rootBox.right);
    expect(pickerBox.width).toBeGreaterThan(rootBox.width / 2);
  });
});
