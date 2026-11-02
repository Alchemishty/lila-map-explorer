import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parseManifest } from "../src/domain/contract";
import type { Manifest, MatchSummary } from "../src/domain/types";
import { pressedIndicatorContrastRatio } from "./pressedIndicatorContrast";

// Smoke tests of the built app on the real data, at desktop and phone sizes. The
// map-view geometry (round trip, pan, zoom, resize) is covered by src/render/mapView.browser.test.ts
// and is not repeated here.

const matchCountPattern = /^\d+ matches$/;

async function loadManifest(page: Page): Promise<Manifest> {
  const manifestResponse = await page.request.get("data/manifest.json");
  if (!manifestResponse.ok()) {
    throw new Error(
      `Could not load data/manifest.json: HTTP ${manifestResponse.status()} (run make data)`,
    );
  }
  return parseManifest(await manifestResponse.json(), "data/");
}

/** Opens the app, records console errors and page errors, and waits for the minimap image. */
async function openApp(page: Page): Promise<string[]> {
  const consoleErrorMessages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrorMessages.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrorMessages.push(error.message));
  await page.goto("/");
  await expect(page.locator(".map-container img.leaflet-image-layer")).toBeVisible();
  return consoleErrorMessages;
}

/** On a phone the panels sit in a collapsed bottom sheet; on desktop the handle is hidden. */
async function showPanels(page: Page): Promise<void> {
  const showPanelsButton = page.getByRole("button", { name: "Show panels" });
  if (await showPanelsButton.isVisible()) {
    await showPanelsButton.click();
  }
}

/** The number of overlay canvas pixels that are not fully transparent. */
async function countDrawnCanvasPixels(page: Page): Promise<number> {
  return page.locator(".map-container canvas").evaluate((canvasElement) => {
    if (!(canvasElement instanceof HTMLCanvasElement)) {
      throw new Error("The map overlay is not a canvas element");
    }
    const context = canvasElement.getContext("2d");
    if (context === null) {
      throw new Error("The map overlay canvas has no 2D context");
    }
    const { data: rgbaValues } = context.getImageData(
      0,
      0,
      canvasElement.width,
      canvasElement.height,
    );
    let drawnPixelCount = 0;
    for (let i = 3; i < rgbaValues.length; i += 4) {
      if (rgbaValues[i] !== 0) {
        drawnPixelCount += 1;
      }
    }
    return drawnPixelCount;
  });
}

function requireFirstMatchWithBots(manifest: Manifest): MatchSummary {
  const matchWithBots = manifest.matches.find((match) => match.botCount > 0);
  if (matchWithBots === undefined) {
    throw new Error("manifest.json has no match with bots, so the Replay smoke test cannot run");
  }
  return matchWithBots;
}

/** Switches to Replay and opens the first match with bots, then waits for its actor list. */
async function openReplayOfFirstMatchWithBots(page: Page): Promise<MatchSummary> {
  const matchWithBots = requireFirstMatchWithBots(await loadManifest(page));
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Replay" }).click();
  await page.locator(".map-field select").selectOption(matchWithBots.mapId);
  await page.locator(".replay-match-field select").selectOption(matchWithBots.matchId);
  await expect(page.locator(".actor-list .actor-button")).toHaveCount(
    matchWithBots.playerCount + matchWithBots.botCount,
  );
  await showPanels(page); // on a phone, the taps on the top bar closed the sheet
  return matchWithBots;
}

/** One line per serious or critical violation, naming each failing element and why it fails. */
function describeSeriousOrCriticalViolations(
  axeResults: Awaited<ReturnType<AxeBuilder["analyze"]>>,
): string[] {
  return axeResults.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .flatMap((violation) =>
      violation.nodes.map(
        (node) => `${violation.id} at ${node.target.join(" ")}: ${node.failureSummary ?? ""}`,
      ),
    );
}

test("the app loads: map image, match count and no console errors", async ({ page }) => {
  const consoleErrorMessages = await openApp(page);
  // The minimap may still be downloading when the app shell is ready, so poll until it has decoded.
  const minimapImage = page.locator(".map-container img.leaflet-image-layer");
  await expect
    .poll(() =>
      minimapImage.evaluate((image) => {
        if (!(image instanceof HTMLImageElement)) {
          throw new Error("The minimap layer is not an <img> element");
        }
        return image.naturalWidth;
      }),
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".match-dropdown summary")).toHaveText(matchCountPattern);
  // The app opens on Kill zones, with its exact total, and every marker off (user decision 2026-11-02).
  await showPanels(page);
  await expect(page.getByRole("radio", { name: "Kill zones" })).toBeChecked();
  await expect(page.locator(".heatmap-scale-title")).toHaveText(/^Kill zones · \d[\d,]* kills?$/);
  await expect(page.locator(".overview-panel .legend-entry input:checked")).toHaveCount(0);
  // The traffic heatmap's colour scale carries its exact play time.
  await page.getByRole("radio", { name: "Traffic" }).check();
  await expect(page.locator(".heatmap-scale-title")).toHaveText(
    /^Traffic · \d[\d,]* h \d+ min of play$/,
  );
  expect(consoleErrorMessages).toEqual([]);
});

test("changing the map to Lockdown changes the match count", async ({ page }) => {
  const manifest = await loadManifest(page);
  await openApp(page);
  const matchCountSummary = page.locator(".match-dropdown summary");
  await expect(matchCountSummary).toHaveText(matchCountPattern);
  const initialMatchCountText = await matchCountSummary.textContent();

  await page.locator(".map-field select").selectOption("Lockdown");

  const lockdownMatchCount = manifest.matches.filter((match) => match.mapId === "Lockdown").length;
  await expect(matchCountSummary).toHaveText(`${lockdownMatchCount} matches`);
  expect(`${lockdownMatchCount} matches`).not.toBe(initialMatchCountText);
});

test("Overview: Storm deaths draws on the canvas and the legend has 8 marker switches", async ({
  page,
}) => {
  await openApp(page);
  await showPanels(page);
  await page.getByRole("radio", { name: "Off" }).check();
  await page.locator(".overview-panel").getByRole("button", { name: "Hide all" }).click();
  await expect.poll(() => countDrawnCanvasPixels(page)).toBe(0);

  await page.getByRole("radio", { name: "Storm death zones" }).check();

  await expect.poll(() => countDrawnCanvasPixels(page)).toBeGreaterThan(0);
  await expect(page.locator(".overview-panel .legend-entry")).toHaveCount(8);
});

test("Overview: the Player looted switch turns on and off with axe still clean (phone: in the sheet)", async ({
  page,
}) => {
  test.slow(); // an axe scan of the whole app is slow in WebKit when the machine is busy
  await openApp(page);
  await showPanels(page);
  const lootSwitch = page
    .locator(".overview-panel")
    .getByRole("checkbox", { name: "Player looted", exact: true });
  await expect(lootSwitch).not.toBeChecked(); // every marker type starts off
  await lootSwitch.check();
  await expect(lootSwitch).toBeChecked();
  await lootSwitch.uncheck();
  await expect(lootSwitch).not.toBeChecked();
  const axeResults = await new AxeBuilder({ page }).analyze();
  expect(describeSeriousOrCriticalViolations(axeResults)).toEqual([]);
});

test("Replay: playing a match with bots moves the clock and lists the bots", async ({ page }) => {
  await openApp(page);
  await showPanels(page);
  const matchWithBots = await openReplayOfFirstMatchWithBots(page);
  const clock = page.locator(".timeline-clock");
  await expect(clock).toHaveText(/^0:00 \/ /);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(1000);

  // Retries until the clock reads "m:ss / m:ss" with an elapsed time other than 0:00.
  await expect(clock).toHaveText(/^(?!0:00 )\d+:\d{2} \/ \d+:\d{2}$/);
  await expect(page.locator(".actor-list .actor-kind", { hasText: /^Bot$/ })).toHaveCount(
    matchWithBots.botCount,
  );
});

test("accessibility: no serious or critical axe violations on Overview", async ({ page }) => {
  test.slow(); // an axe scan of the whole app is slow in WebKit when the machine is busy
  await openApp(page);
  await showPanels(page);
  await expect(page.locator(".overview-panel .legend-entry").first()).toBeVisible();
  const axeResults = await new AxeBuilder({ page }).analyze();
  expect(describeSeriousOrCriticalViolations(axeResults)).toEqual([]);
});

test("accessibility: no serious or critical axe violations on Replay", async ({ page }) => {
  test.slow(); // an axe scan of the whole app is slow in WebKit when the machine is busy
  await openApp(page);
  await showPanels(page);
  await openReplayOfFirstMatchWithBots(page);
  const axeResults = await new AxeBuilder({ page }).analyze();
  expect(describeSeriousOrCriticalViolations(axeResults)).toEqual([]);
});

test("pressed and selected controls are marked at 3:1 or more against their surface", async ({
  page,
}) => {
  const minimumNonTextContrastRatio = 3;
  await openApp(page);
  await showPanels(page);
  await page.getByRole("button", { name: "Select area" }).click();
  await showPanels(page); // on a phone, Select area closed the sheet to free the map
  for (const pressedControl of [
    page.locator(".mode-switch button[aria-pressed='true']"),
    page.locator(".select-area-button[aria-pressed='true']"),
  ]) {
    expect(await pressedIndicatorContrastRatio(pressedControl)).toBeGreaterThanOrEqual(
      minimumNonTextContrastRatio,
    );
  }

  await openReplayOfFirstMatchWithBots(page);
  await page.locator(".actor-list .actor-button").first().click();
  for (const pressedControl of [
    page.locator(".mode-switch button[aria-pressed='true']"),
    page.locator(".timeline-speeds button[aria-pressed='true']"),
    page.locator(".actor-button[aria-pressed='true']"),
  ]) {
    expect(await pressedIndicatorContrastRatio(pressedControl)).toBeGreaterThanOrEqual(
      minimumNonTextContrastRatio,
    );
  }
});

test("Overview: Replay opens on the match chosen from the area's list, axe clean", async ({
  page,
}) => {
  test.slow(); // an axe scan of the whole app is slow in WebKit when the machine is busy
  await openApp(page);
  await showPanels(page);
  await page.getByRole("button", { name: "Select area" }).click();
  // On a phone, Select area closes the sheet so the whole map is free for the drag.
  const isPhoneSheet = await page.locator(".bottom-sheet-handle").isVisible();
  if (isPhoneSheet) {
    await expect(page.getByRole("button", { name: "Show panels" })).toBeVisible();
  }
  const mapBox = await page.locator(".map-container").boundingBox();
  if (mapBox === null) {
    throw new Error("The map container is not visible, so no area can be dragged");
  }
  await page.mouse.move(mapBox.x + mapBox.width * 0.2, mapBox.y + mapBox.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + mapBox.width * 0.8, mapBox.y + mapBox.height * 0.45, {
    steps: 10,
  });
  await page.mouse.up();
  // The result is in view: on a phone the drag's end opens the sheet on it.
  await expect(page.locator(".area-counts")).toBeInViewport();

  // The first row's swatch counts add up to its N, and its button name reads them out.
  const firstRowButton = page.locator(".replay-match-button").first();
  const firstRowLabel = await firstRowButton.locator(".replay-match-label").innerText();
  const firstRowCounts = await firstRowButton.locator(".marker-count").allInnerTexts();
  expect(firstRowCounts.length).toBeGreaterThan(0);
  expect(firstRowCounts.reduce((total, count) => total + Number(count), 0)).toBe(
    Number(/· (\d+) events?$/.exec(firstRowLabel)?.[1]),
  );
  await expect(firstRowButton).toHaveAccessibleName(new RegExp(`^${firstRowLabel} .+: \\d+$`));
  const secondRowButton = page.locator(".replay-match-button").nth(1);
  await expect(secondRowButton.locator(".replay-match-label")).toHaveText(
    /^[A-Z][a-z]{2} \d{1,2} · \d{2}:\d{2} UTC · \d+ events?$/,
  );
  const axeResults = await new AxeBuilder({ page }).analyze();
  expect(describeSeriousOrCriticalViolations(axeResults)).toEqual([]);
  const secondMatchId = await secondRowButton.getAttribute("data-match-id");
  if (secondMatchId === null) {
    throw new Error("The second match row names no match");
  }
  await secondRowButton.click();
  await expect(page.locator(".replay-match-field select")).toHaveValue(secondMatchId);
});

test("bad data: an empty manifest shows the error view", async ({ page }) => {
  await page.route("**/manifest.json", (route) => route.fulfill({ json: {} }));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "The map data couldn't be loaded" }),
  ).toBeVisible();
  await expect(page.locator(".error-view-message")).toContainText("manifest.json");
});
