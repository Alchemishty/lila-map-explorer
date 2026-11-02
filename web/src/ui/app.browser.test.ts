import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import type { DayFile, Manifest, MapConfig, MatchSummary } from "../domain/types";
import { startApp, startAppWithLoader } from "./app";
import { errorViewHeading } from "./errorView";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): the shell needs real layout,
// CSS media queries and Leaflet.

const onePixelPngUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function buildMapConfig(mapId: string, imageUrl = onePixelPngUrl): MapConfig {
  return {
    mapId,
    imageUrl,
    imageWidthPixels: 1024,
    imageHeightPixels: 1024,
    worldScale: 1000,
    worldOriginX: -500,
    worldOriginZ: -500,
  };
}

function buildMatch(matchId: string, mapId: string, dayUtc: string, startTimestampSeconds: number) {
  const match: MatchSummary = {
    matchId,
    mapId,
    dayUtc,
    startTimestampSeconds,
    durationSeconds: 382,
    playerCount: 1,
    botCount: 14,
    eventCountsByMarker: {},
    dayFile: `days/${mapId}/${dayUtc}.json`,
  };
  return match;
}

// Lockdown has the most matches, so the app starts there. 1770905100 is 2026-02-12 14:05 UTC.
const testMatches: readonly MatchSummary[] = [
  buildMatch("lockdown-feb12", "Lockdown", "2026-02-12", 1770905100),
  buildMatch("lockdown-feb11", "Lockdown", "2026-02-11", 1770800000),
  buildMatch("lockdown-feb10", "Lockdown", "2026-02-10", 1770720000),
  buildMatch("grandrift-feb10", "GrandRift", "2026-02-10", 1770700000),
];

function buildManifest(maps: readonly MapConfig[]): Manifest {
  return {
    schemaVersion: 1,
    generatedAtUtc: "2026-10-31T00:00:00+00:00",
    maps,
    eventConfig: { player: {}, bot: {}, markers: {} },
    matches: testMatches,
  };
}

/** The day file at a dayFile path: the manifest's matches on it, with no actors (the shell tests need no rows). */
function dayFileWithoutActors(manifest: Manifest, dayFile: string): DayFile {
  const matchesOnDay = manifest.matches.filter((match) => match.dayFile === dayFile);
  const firstMatch = matchesOnDay[0];
  if (firstMatch === undefined) {
    throw new Error(`The test manifest has no match in "${dayFile}"`);
  }
  return {
    schemaVersion: 1,
    mapId: firstMatch.mapId,
    dayUtc: firstMatch.dayUtc,
    matches: matchesOnDay.map((match) => ({ matchId: match.matchId, actors: [] })),
  };
}

function loaderResolving(manifest: Manifest): DataLoader {
  return {
    loadManifest: () => Promise.resolve(manifest),
    loadDayFile: (dayFile) => Promise.resolve(dayFileWithoutActors(manifest, dayFile)),
  };
}

const mountedRoots: HTMLElement[] = [];

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  root.style.height = "600px";
  document.body.appendChild(root);
  mountedRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
  await page.viewport(1280, 800);
});

function requireElement<Found extends Element>(root: HTMLElement, selector: string): Found {
  const element = root.querySelector<Found>(selector);
  if (element === null) {
    throw new Error(`Nothing in the app matches "${selector}"`);
  }
  return element;
}

function checkboxWithValue(root: HTMLElement, value: string): HTMLInputElement {
  return requireElement<HTMLInputElement>(root, `input[type="checkbox"][value="${value}"]`);
}

async function startTestApp(): Promise<HTMLElement> {
  const root = mountRoot();
  await startAppWithLoader(
    root,
    loaderResolving(buildManifest([buildMapConfig("GrandRift"), buildMapConfig("Lockdown")])),
  );
  return root;
}

describe("startApp error paths", () => {
  it("shows the error view when the manifest fails to load", async () => {
    const root = mountRoot();
    await startAppWithLoader(root, {
      loadManifest: () => Promise.reject(new Error("Could not load data/manifest.json: HTTP 404")),
      loadDayFile: () => Promise.reject(new Error("unused")),
    });
    expect(requireElement(root, "h1").textContent).toBe(errorViewHeading);
    expect(root.textContent).toContain("Could not load data/manifest.json: HTTP 404");
  });

  it("shows the error view, naming the URL, when the minimap image fails to load", async () => {
    const root = mountRoot();
    const missingImageUrl = "/missing-minimap-for-app-test.jpg";
    await startAppWithLoader(
      root,
      loaderResolving(buildManifest([buildMapConfig("Lockdown", missingImageUrl)])),
    );
    await vi.waitFor(() => expect(root.querySelector("h1")?.textContent).toBe(errorViewHeading));
    expect(root.textContent).toContain(missingImageUrl);
  });

  it("shows the error view for a data base URL that does not end with a slash", async () => {
    const root = mountRoot();
    await startApp(root, "data");
    expect(requireElement(root, "h1").textContent).toBe(errorViewHeading);
    expect(root.textContent).toContain('"data" must end with "/"');
  });
});

describe("startApp top bar", () => {
  it("starts on the map with the most matches, all days and all matches, in Overview", async () => {
    const root = await startTestApp();
    expect(requireElement<HTMLSelectElement>(root, ".map-field select").value).toBe("Lockdown");
    expect(requireElement(root, ".day-dropdown summary").textContent).toBe(
      "Dates (UTC): 3 of 3 days",
    );
    expect(requireElement(root, ".match-dropdown summary").textContent).toBe("3 matches");
    const overviewButton = requireElement(root, ".mode-switch button");
    expect(overviewButton.getAttribute("aria-pressed")).toBe("true");
    expect(getComputedStyle(requireElement(root, ".replay-match-field")).display).toBe("none");
    expect(root.querySelector(".leaflet-image-layer")).not.toBeNull();
    // The app's dark map background, not Leaflet's default light grey, shows around the image.
    expect(getComputedStyle(requireElement(root, ".map-container")).backgroundColor).toBe(
      "rgb(12, 13, 15)", // --map-background in theme.css
    );
  });

  it("narrows the matches when a day is unchecked, and a map change resets the days", async () => {
    const root = await startTestApp();
    checkboxWithValue(root, "2026-02-11").click();
    expect(requireElement(root, ".match-dropdown summary").textContent).toBe("2 matches");
    expect(requireElement(root, ".day-dropdown summary").textContent).toBe(
      "Dates (UTC): 2 of 3 days",
    );

    const imageElement = requireElement<HTMLImageElement>(root, ".leaflet-image-layer");
    imageElement.dataset.shownMap = "Lockdown";
    const mapSelect = requireElement<HTMLSelectElement>(root, ".map-field select");
    mapSelect.value = "GrandRift";
    mapSelect.dispatchEvent(new Event("change"));
    expect(requireElement(root, ".day-dropdown summary").textContent).toBe(
      "Dates (UTC): 1 of 1 days",
    );
    expect(requireElement(root, ".match-dropdown summary").textContent).toBe("1 matches");
    // showMap swapped the minimap: the old image layer is gone and exactly one new one is shown.
    const imageLayers = root.querySelectorAll<HTMLImageElement>(".leaflet-image-layer");
    expect(imageLayers).toHaveLength(1);
    expect(imageLayers[0]?.dataset.shownMap).toBeUndefined();
  });

  it("picks a match subset from the checkbox list, and All matches clears it", async () => {
    const root = await startTestApp();
    checkboxWithValue(root, "lockdown-feb10").click();
    expect(requireElement(root, ".match-dropdown summary").textContent).toBe("2 matches");
    const allMatchesInput = requireElement<HTMLInputElement>(root, ".all-matches-row input");
    expect(allMatchesInput.checked).toBe(false);
    allMatchesInput.click();
    expect(requireElement(root, ".match-dropdown summary").textContent).toBe("3 matches");
    expect(checkboxWithValue(root, "lockdown-feb10").checked).toBe(true);
  });

  it("enters Replay on the earliest selected match, shown by its full label", async () => {
    const root = await startTestApp();
    const replayButton = requireElement(root, ".mode-switch button:last-child");
    (replayButton as HTMLButtonElement).click();
    expect(replayButton.getAttribute("aria-pressed")).toBe("true");
    const replaySelect = requireElement<HTMLSelectElement>(root, ".replay-match-field select");
    expect(getComputedStyle(requireElement(root, ".replay-match-field")).display).not.toBe("none");
    expect(replaySelect.value).toBe("lockdown-feb10");
    expect([...replaySelect.options].map((option) => option.value)).toEqual([
      "lockdown-feb10",
      "lockdown-feb11",
      "lockdown-feb12",
    ]);
    expect(replaySelect.options[2]?.textContent).toBe(
      "14:05 UTC · 6m 22s · 1 player, 14 recorded bot tracks",
    );
    expect(replaySelect.options[2]?.parentElement).toHaveProperty("label", "Feb 12");
    replaySelect.value = "lockdown-feb12";
    replaySelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(requireElement(root, ".replay-match-chosen").textContent).toBe(
      "Feb 12 · 14:05 UTC · 6m 22s · 1 player, 14 recorded bot tracks",
    );
  });

  it("shows No matches for these filters in the Replay picker when no day is chosen", async () => {
    const root = await startTestApp();
    (requireElement(root, ".mode-switch button:last-child") as HTMLButtonElement).click();
    for (const dayUtc of ["2026-02-10", "2026-02-11", "2026-02-12"]) {
      checkboxWithValue(root, dayUtc).click();
    }
    const replaySelect = requireElement<HTMLSelectElement>(root, ".replay-match-field select");
    expect(replaySelect.disabled).toBe(true);
    expect([...replaySelect.options].map((option) => option.textContent)).toEqual([
      "No matches for these filters",
    ]);
    expect(requireElement(root, ".match-dropdown summary").textContent).toBe("0 matches");
  });
});

describe("phone and desktop layout", () => {
  it("at 390 px wide, the map fills the width and the panels become a collapsed bottom sheet", async () => {
    await page.viewport(390, 844);
    const root = await startTestApp();
    const mapBox = requireElement(root, ".map-container").getBoundingClientRect();
    expect(mapBox.width).toBe(root.getBoundingClientRect().width);
    const handleButton = requireElement<HTMLElement>(root, ".bottom-sheet-handle");
    expect(getComputedStyle(handleButton).display).not.toBe("none");
    expect(getComputedStyle(requireElement(root, ".bottom-sheet")).position).toBe("absolute");
    const mapSelectBox = requireElement(root, ".map-field select").getBoundingClientRect();
    const daySummaryBox = requireElement(root, ".day-dropdown summary").getBoundingClientRect();
    // The map shares the first row with the mode switch; the Dates start the row below.
    expect(mapSelectBox.bottom).toBeLessThanOrEqual(daySummaryBox.top);
    expect(getComputedStyle(requireElement(root, ".bottom-sheet-content")).display).toBe("none");
  });

  it("at 1280 px wide, the panels sit beside the map and the handle is hidden", async () => {
    const root = await startTestApp();
    const handleButton = requireElement<HTMLElement>(root, ".bottom-sheet-handle");
    expect(getComputedStyle(handleButton).display).toBe("none");
    const mapBox = requireElement(root, ".map-container").getBoundingClientRect();
    const sheetBox = requireElement(root, ".bottom-sheet").getBoundingClientRect();
    expect(sheetBox.left).toBe(mapBox.right);
  });
});
