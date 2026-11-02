import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import { minimumFramedSpanWorldUnits } from "../domain/matchExtent";
import type { ActorTrack, DayFile, Manifest, MatchSummary, WorldPoint } from "../domain/types";
import { startAppWithLoader } from "./app";
import { matchFramingMarginPixels } from "./matchFraming";
import { fixtureMapConfig } from "./overviewTestFixtures";
import {
  multiplayerMatchTracks,
  quietMatchTracks,
  replayManifest,
  requireReplayDayFile,
} from "./replayTestFixtures";

// Runs in headless Chromium: when a match loads in Replay, the map fits every trail point and event
// of the match in the part of the map the designer can see (clear of the docked timeline and of the
// phone's bottom sheet), once. After that the designer's own pan and zoom are left alone.

const replayLoader: DataLoader = {
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

async function enterReplay(root: HTMLElement, actorCount: number): Promise<void> {
  requireElement<HTMLButtonElement>(root, ".mode-switch button:last-child").click();
  await vi.waitFor(() => expect(root.querySelectorAll(".actor-button")).toHaveLength(actorCount));
}

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

/** Every row of every track: each trail point and each event (events are rows of their tracks). */
function everyRowPosition(tracks: readonly ActorTrack[]): WorldPoint[] {
  return tracks.flatMap((track) =>
    track.worldX.map((worldX, i) => {
      const worldZ = track.worldZ[i];
      if (worldZ === undefined) {
        throw new Error(`Actor "${track.actorKey}" has no z value for row ${i}`);
      }
      return { worldX, worldZ };
    }),
  );
}

interface VisibleBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The part of the map the designer can see: the map, less the sheet when it lies over the map. */
function visibleMapBox(root: HTMLElement): VisibleBox {
  const mapBox = requireElement(root, ".map-container").getBoundingClientRect();
  const sheetBox = requireElement(root, ".bottom-sheet").getBoundingClientRect();
  const isSheetOverMap = sheetBox.left < mapBox.right && sheetBox.top < mapBox.bottom;
  return {
    left: mapBox.left,
    right: mapBox.right,
    top: mapBox.top,
    bottom: isSheetOverMap ? sheetBox.top : mapBox.bottom,
  };
}

/** Expects every row of tracks inside the visible map, at least the margin from each edge. */
function expectEveryRowFramed(root: HTMLElement, tracks: readonly ActorTrack[]): void {
  const visibleBox = visibleMapBox(root);
  const marginWithRoundingPixels = matchFramingMarginPixels - 1;
  for (const position of everyRowPosition(tracks)) {
    const clientPoint = worldToClientPoint(root, position);
    expect(clientPoint.clientX).toBeGreaterThanOrEqual(visibleBox.left + marginWithRoundingPixels);
    expect(clientPoint.clientX).toBeLessThanOrEqual(visibleBox.right - marginWithRoundingPixels);
    expect(clientPoint.clientY).toBeGreaterThanOrEqual(visibleBox.top + marginWithRoundingPixels);
    expect(clientPoint.clientY).toBeLessThanOrEqual(visibleBox.bottom - marginWithRoundingPixels);
  }
}

/** The match's on-screen width and height, from its rows' extremes. */
function framedSize(root: HTMLElement, tracks: readonly ActorTrack[]): VisibleBox {
  const clientPoints = everyRowPosition(tracks).map((position) =>
    worldToClientPoint(root, position),
  );
  return {
    left: Math.min(...clientPoints.map((clientPoint) => clientPoint.clientX)),
    right: Math.max(...clientPoints.map((clientPoint) => clientPoint.clientX)),
    top: Math.min(...clientPoints.map((clientPoint) => clientPoint.clientY)),
    bottom: Math.max(...clientPoints.map((clientPoint) => clientPoint.clientY)),
  };
}

/** True when the match fills the visible map less margins on at least one axis (a tight fit). */
function fillsOneAxis(root: HTMLElement, tracks: readonly ActorTrack[]): boolean {
  const visibleBox = visibleMapBox(root);
  const matchBox = framedSize(root, tracks);
  const freeWidth = visibleBox.right - visibleBox.left - 2 * matchFramingMarginPixels;
  const freeHeight = visibleBox.bottom - visibleBox.top - 2 * matchFramingMarginPixels;
  return (
    Math.abs(matchBox.right - matchBox.left - freeWidth) < 1 ||
    Math.abs(matchBox.bottom - matchBox.top - freeHeight) < 1
  );
}

function imageBoxNow(root: HTMLElement): DOMRect {
  return requireElement(root, ".leaflet-image-layer").getBoundingClientRect();
}

function sheetHandle(root: HTMLElement): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(root, ".bottom-sheet-handle");
}

function chooseReplayMatch(root: HTMLElement, matchId: string): void {
  const replaySelect = requireElement<HTMLSelectElement>(root, ".replay-match-field select");
  replaySelect.value = matchId;
  replaySelect.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Replay frames the match when it loads", () => {
  it("desktop: fits every trail point and event, with a margin, and zoom-out stays possible", async () => {
    const root = await startAt(replayLoader, 1280, 800);
    await enterReplay(root, 5);
    expectEveryRowFramed(root, multiplayerMatchTracks);
    expect(fillsOneAxis(root, multiplayerMatchTracks)).toBe(true);
    // The timeline is docked under the map, never over it.
    const timelineTop = requireElement(root, ".timeline").getBoundingClientRect().top;
    expect(framedSize(root, multiplayerMatchTracks).bottom).toBeLessThan(timelineTop);
    const zoomOutButton = requireElement(root, ".leaflet-control-zoom-out");
    expect(zoomOutButton.classList.contains("leaflet-disabled")).toBe(false);
  });

  it("phone with the sheet closed: frames the match above the sheet's handle and the timeline", async () => {
    const root = await startAt(replayLoader, 390, 844);
    await enterReplay(root, 5);
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("false");
    expectEveryRowFramed(root, multiplayerMatchTracks);
    expect(fillsOneAxis(root, multiplayerMatchTracks)).toBe(true);
    const timelineTop = requireElement(root, ".timeline").getBoundingClientRect().top;
    expect(framedSize(root, multiplayerMatchTracks).bottom).toBeLessThan(timelineTop);
  });

  it("phone with the sheet open: frames the match in the map above the open sheet", async () => {
    const root = await startAt(replayLoader, 390, 844);
    sheetHandle(root).click(); // opened in Overview, so it is open when the match loads
    await enterReplay(root, 5);
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("true");
    const sheetTop = requireElement(root, ".bottom-sheet").getBoundingClientRect().top;
    const mapBottom = requireElement(root, ".map-container").getBoundingClientRect().bottom;
    expect(sheetTop).toBeLessThan(mapBottom - 200); // the open sheet covers much of the map
    expectEveryRowFramed(root, multiplayerMatchTracks);
    expect(fillsOneAxis(root, multiplayerMatchTracks)).toBe(true);
  });

  it("leaves the view alone during playback and switches, and frames each newly chosen match", async () => {
    const root = await startAt(replayLoader, 1280, 800);
    await enterReplay(root, 5);
    requireElement<HTMLElement>(root, ".leaflet-control-zoom-out").click(); // the designer's own zoom
    const imageBoxAfterZoom = imageBoxNow(root);
    requireElement<HTMLButtonElement>(root, ".timeline-speeds button:last-child").click(); // 16×
    requireElement<HTMLButtonElement>(root, ".timeline-play-button").click();
    await vi.waitFor(() =>
      expect(
        Number(requireElement<HTMLInputElement>(root, ".timeline-scrubber").value),
      ).toBeGreaterThan(5),
    );
    requireElement<HTMLInputElement>(root, ".hide-bots-switch input").click();
    expect(imageBoxNow(root).toJSON()).toEqual(imageBoxAfterZoom.toJSON());

    chooseReplayMatch(root, "quiet");
    await vi.waitFor(() => expect(root.querySelectorAll(".actor-button")).toHaveLength(1));
    expectEveryRowFramed(root, quietMatchTracks);
    // Its rows lie on one line (20 world units wide, none tall), so the framed span is the minimum
    // on both axes, which here fills the visible height less its margins.
    const visibleBox = visibleMapBox(root);
    const pixelsPerWorldUnit = imageBoxNow(root).width / fixtureMapConfig.worldScale;
    const framedHeightWorldUnits =
      (visibleBox.bottom - visibleBox.top - 2 * matchFramingMarginPixels) / pixelsPerWorldUnit;
    expect(framedHeightWorldUnits).toBeCloseTo(minimumFramedSpanWorldUnits, 1);
  });

  it("frames the match again when the designer comes back to Replay", async () => {
    const root = await startAt(replayLoader, 1280, 800);
    await enterReplay(root, 5);
    requireElement<HTMLButtonElement>(root, ".mode-switch button:first-child").click();
    requireElement<HTMLElement>(root, ".leaflet-control-zoom-out").click();
    await enterReplay(root, 5);
    expectEveryRowFramed(root, multiplayerMatchTracks);
    expect(fillsOneAxis(root, multiplayerMatchTracks)).toBe(true);
  });
});

// A match whose one actor has a single row: its rows span no width or height at all.
const lonePointTracks: readonly ActorTrack[] = [
  {
    actorKey: "player-lone",
    userId: "player-lone",
    actorType: "human",
    isPlayer: true,
    worldX: [120],
    worldZ: [-80],
    timestampSeconds: [1_770_854_400],
    eventCodes: ["Position"],
    isSameTickRepeat: [false],
  },
];
const lonePointMatch: MatchSummary = {
  matchId: "lone-point",
  mapId: "Lockdown",
  dayUtc: "2026-02-12",
  startTimestampSeconds: 1_770_854_400,
  durationSeconds: 30,
  playerCount: 1,
  botCount: 0,
  eventCountsByMarker: {},
  dayFile: "days/Lockdown/2026-02-12.json",
};
const lonePointManifest: Manifest = { ...replayManifest, matches: [lonePointMatch] };
const lonePointDayFile: DayFile = {
  schemaVersion: 1,
  mapId: "Lockdown",
  dayUtc: "2026-02-12",
  matches: [{ matchId: "lone-point", actors: lonePointTracks }],
};

describe("Replay framing of a match with a single point", () => {
  it("shows the point in the middle of a view at least the minimum span across", async () => {
    const lonePointLoader: DataLoader = {
      loadManifest: () => Promise.resolve(lonePointManifest),
      loadDayFile: () => Promise.resolve(lonePointDayFile),
    };
    const root = await startAt(lonePointLoader, 1280, 800);
    await enterReplay(root, 1);
    expectEveryRowFramed(root, lonePointTracks);
    const visibleBox = visibleMapBox(root);
    const pointClient = worldToClientPoint(root, { worldX: 120, worldZ: -80 });
    // Centred, to within Leaflet's whole-pixel rounding of the view centre.
    expect(Math.abs(pointClient.clientX - (visibleBox.left + visibleBox.right) / 2)).toBeLessThan(
      1,
    );
    expect(Math.abs(pointClient.clientY - (visibleBox.top + visibleBox.bottom) / 2)).toBeLessThan(
      1,
    );
    const pixelsPerWorldUnit = imageBoxNow(root).width / fixtureMapConfig.worldScale;
    const visibleHeightWorldUnits = (visibleBox.bottom - visibleBox.top) / pixelsPerWorldUnit;
    expect(visibleHeightWorldUnits).toBeGreaterThanOrEqual(minimumFramedSpanWorldUnits);
  });
});
