import { page } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import type { ActorTrack, DayFile, Manifest, WorldPoint } from "../domain/types";
import { startAppWithLoader } from "./app";
import { fixtureEventConfig, fixtureMapConfig } from "./overviewTestFixtures";
import { replayInspectorHintText, sameTickRepeatNoteText } from "./replayInspector";

// Runs in headless Chromium: markers stacked at one world position. A tap lists every visible
// event at the tapped marker's exact spot, each as a collapsed row that opens to its details.

const matchStartSeconds = 1_770_854_400; // 2026-02-12 00:00:00 UTC
const stackSpot: WorldPoint = { worldX: 20, worldZ: 20 };

/** player-s kills a bot twice at 10 s (the second a same-second repeat), then dies to a bot at 12 s, all at stackSpot. */
const stackedTracks: readonly ActorTrack[] = [
  {
    actorKey: "player-s",
    userId: "player-s",
    actorType: "human",
    isPlayer: true,
    worldX: [0, 20, 20, 20],
    worldZ: [0, 20, 20, 20],
    timestampSeconds: [0, 10, 10, 12].map((elapsedSeconds) => matchStartSeconds + elapsedSeconds),
    eventCodes: ["Position", "BotKill", "BotKill", "BotKilled"],
    isSameTickRepeat: [false, false, true, false],
  },
  {
    actorKey: "player-t",
    userId: "player-t",
    actorType: "human",
    isPlayer: true,
    worldX: [-50, -50],
    worldZ: [-50, -40],
    timestampSeconds: [matchStartSeconds, matchStartSeconds + 60],
    eventCodes: ["Position", "Position"],
    isSameTickRepeat: [false, false],
  },
];

const stackedDayFile: DayFile = {
  schemaVersion: 1,
  mapId: "Lockdown",
  dayUtc: "2026-02-12",
  matches: [{ matchId: "stacked", actors: stackedTracks }],
};

const stackedManifest: Manifest = {
  schemaVersion: 1,
  generatedAtUtc: "2026-11-02T00:00:00+00:00",
  maps: [fixtureMapConfig],
  eventConfig: fixtureEventConfig,
  matches: [
    {
      matchId: "stacked",
      mapId: "Lockdown",
      dayUtc: "2026-02-12",
      startTimestampSeconds: matchStartSeconds,
      durationSeconds: 60,
      playerCount: 2,
      botCount: 0,
      eventCountsByMarker: {},
      dayFile: "days/Lockdown/2026-02-12.json",
    },
  ],
};

const stackedLoader: DataLoader = {
  loadManifest: () => Promise.resolve(stackedManifest),
  loadDayFile: (dayFile) => {
    if (dayFile !== "days/Lockdown/2026-02-12.json") {
      throw new Error(`The stacked-marker test has no day file "${dayFile}"`);
    }
    return Promise.resolve(stackedDayFile);
  },
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

/** Starts the app, enters Replay and moves the clock to the end of the stacked match. */
async function startReplayAtEnd(): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.style.height = "700px";
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, stackedLoader);
  requireElement<HTMLButtonElement>(root, ".mode-switch button:last-child").click();
  await vi.waitFor(() => expect(root.querySelectorAll(".actor-button")).toHaveLength(2));
  const scrubber = requireElement<HTMLInputElement>(root, ".timeline-scrubber");
  scrubber.value = "60";
  scrubber.dispatchEvent(new Event("input", { bubbles: true }));
  return root;
}

function tapMapAt(root: HTMLElement, point: WorldPoint): void {
  const imageBox = requireElement(root, ".leaflet-image-layer").getBoundingClientRect();
  const fractionX = (point.worldX - fixtureMapConfig.worldOriginX) / fixtureMapConfig.worldScale;
  const fractionZ = (point.worldZ - fixtureMapConfig.worldOriginZ) / fixtureMapConfig.worldScale;
  const pointerInit = {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    isPrimary: true,
    pointerType: "mouse",
    clientX: imageBox.left + fractionX * imageBox.width,
    clientY: imageBox.top + (1 - fractionZ) * imageBox.height,
  };
  const mapContainer = requireElement(root, ".map-container");
  mapContainer.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  mapContainer.dispatchEvent(new PointerEvent("pointerup", pointerInit));
}

function inspectorElement(root: HTMLElement): HTMLElement {
  const inspectorSection = requireElement<HTMLElement>(root, ".replay-panel .panel-section");
  expect(requireElement(inspectorSection, "h2").textContent).toBe("Inspector");
  return inspectorSection;
}

function stackRows(root: HTMLElement): HTMLDetailsElement[] {
  return [...inspectorElement(root).querySelectorAll<HTMLDetailsElement>("details")];
}

function rowLines(row: HTMLDetailsElement): (string | null)[] {
  return [...row.querySelectorAll("li")].map((lineElement) => lineElement.textContent);
}

describe("Replay markers stacked at one spot", () => {
  it("a tap shows the count and every event in time order, each with its own roles", async () => {
    const root = await startReplayAtEnd();
    tapMapAt(root, stackSpot);
    const stackBlock = requireElement(inspectorElement(root), ".inspected-marker-stack");
    expect(requireElement(stackBlock, "h3").textContent).toBe("3 events here");
    const rows = stackRows(root);
    expect(rows.map((row) => requireElement(row, "summary").textContent)).toEqual([
      "Player killed a bot · 0:10",
      "Player killed a bot · 0:10",
      "Player killed by a bot · 0:12",
    ]);
    expect(rows.map((row) => row.open)).toEqual([false, false, false]);
    expect(rows.map(rowLines)).toEqual([
      // The summary already gives the time, so the opened row does not repeat it.
      ["Player: player-s", "Victim: a bot"],
      ["Player: player-s", "Victim: a bot", sameTickRepeatNoteText],
      ["Player: player-s", "Killer: a bot"],
    ]);
    tapMapAt(root, { worldX: 200, worldZ: -200 });
    expect(inspectorElement(root).querySelector(".inspected-marker-stack")).toBeNull();
    expect(requireElement(inspectorElement(root), ".panel-hint").textContent).toBe(
      replayInspectorHintText,
    );
  });

  it("an opened row stays open when the inspector is redrawn, here by following an actor", async () => {
    const root = await startReplayAtEnd();
    tapMapAt(root, stackSpot);
    const openedRow = stackRows(root)[2];
    if (openedRow === undefined) {
      throw new Error("The stack has no third row");
    }
    openedRow.open = true;
    const openedSummary = requireElement<HTMLElement>(openedRow, "summary");
    openedSummary.focus();
    requireElement<HTMLButtonElement>(root, ".actor-button").click(); // a redraw with new content
    expect(stackRows(root)[2]).toBe(openedRow);
    expect(openedRow.open).toBe(true);
    expect(document.activeElement).toBe(openedSummary);
    expect(requireElement(inspectorElement(root), ".followed-actor h3").textContent).toBe(
      "Player player-s",
    );
  });

  it("only visible markers can be hit: with kills switched off, the death shows alone as before", async () => {
    const root = await startReplayAtEnd();
    requireElement<HTMLInputElement>(
      root,
      '.replay-panel .legend-entry[data-marker-key="kill_bot"] input',
    ).click();
    tapMapAt(root, stackSpot);
    expect(stackRows(root)).toEqual([]);
    const markerBlock = requireElement(inspectorElement(root), ".inspected-marker");
    expect(
      [...markerBlock.querySelectorAll("h3, li")].map((element) => element.textContent),
    ).toEqual([
      "Player killed by a bot",
      "Time into match: 0:12",
      "Player: player-s",
      "Killer: a bot",
    ]);
  });
});
