import { expect, test, type Page } from "@playwright/test";

// Phone-only checks of the built app on real data, from a run on an Android emulator:
// every filter in the top bar is on screen with the map first, the bar takes 2 rows (3 in Replay),
// the chosen match's full label can be read, both match lists are grouped by UTC start day, an
// open dropdown list is drawn above the map's world-position box and crosshair, a tap on the map
// closes it, a tap on the map closes the open panels, and the area hint has no keyboard-only
// wording.

test.skip(({ isMobile }) => !isMobile, "phone layout only");

/** Opens the app and waits for the minimap image. */
async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".map-container img.leaflet-image-layer")).toBeVisible();
}

/** The element painted at the centre of the given element's box, as the closest match of selector. */
async function isCentreCoveredBy(page: Page, coveredSelector: string, coverSelector: string) {
  return page.locator(coveredSelector).evaluate((coveredElement, selectorOfCover) => {
    const box = coveredElement.getBoundingClientRect();
    const paintedElement = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    if (paintedElement === null) {
      throw new Error("Nothing is painted at the centre of the covered element");
    }
    return paintedElement.closest(selectorOfCover) !== null;
  }, coverSelector);
}

/** The top bar's controls, in order, with their boxes. */
async function topBarControlBoxes(page: Page) {
  return page
    .locator(".top-bar .map-field, .top-bar .mode-switch, .top-bar-filters > :not([hidden])")
    .evaluateAll((controlElements) =>
      controlElements.map((controlElement) => {
        const box = controlElement.getBoundingClientRect();
        return {
          className: controlElement.className,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      }),
    );
}

/** How many rows the controls sit on: a control starts a new row when it is below the last row. */
async function topBarRowCount(page: Page): Promise<number> {
  const controlBoxes = await topBarControlBoxes(page);
  let rowCount = 0;
  let lastRowBottomPixels = Number.NEGATIVE_INFINITY;
  for (const controlBox of [...controlBoxes].sort((first, second) => first.top - second.top)) {
    if (controlBox.top >= lastRowBottomPixels) {
      rowCount += 1;
      lastRowBottomPixels = controlBox.bottom;
    } else {
      lastRowBottomPixels = Math.max(lastRowBottomPixels, controlBox.bottom);
    }
  }
  return rowCount;
}

async function openReplay(page: Page): Promise<void> {
  await page.locator(".mode-switch button", { hasText: "Replay" }).tap();
  await expect(page.locator(".replay-match-field")).toBeVisible();
}

test("every filter in the top bar is fully on screen, the map first, with nothing scrolled out of view", async ({
  page,
}) => {
  await openApp(page);
  const viewportWidthPixels = page.viewportSize()?.width;
  if (viewportWidthPixels === undefined) {
    throw new Error("The phone project has no viewport size");
  }
  const controlBoxes = await topBarControlBoxes(page);
  expect(controlBoxes.map((controlBox) => controlBox.className)).toEqual([
    "top-bar-field map-field",
    "mode-switch",
    "filter-dropdown day-dropdown",
    "filter-dropdown match-dropdown",
  ]);
  for (const controlBox of controlBoxes) {
    expect(controlBox.left, controlBox.className).toBeGreaterThanOrEqual(0);
    expect(controlBox.right, controlBox.className).toBeLessThanOrEqual(viewportWidthPixels);
  }
  await expect(page.locator(".match-dropdown summary")).toBeInViewport({ ratio: 1 });
});

test("the top bar takes 2 rows on Overview and 3 on Replay", async ({ page }) => {
  await openApp(page);
  expect(await topBarRowCount(page)).toBe(2);

  await openReplay(page);

  expect(await topBarRowCount(page)).toBe(3);
});

test("the chosen Replay match's full label can be read, wrapped rather than cut off", async ({
  page,
}) => {
  await openApp(page);
  await openReplay(page);
  const chosenLabel = page.locator(".replay-match-chosen");
  await expect(chosenLabel).toHaveText(
    /^[A-Z][a-z]{2} \d{1,2} · \d{2}:\d{2} UTC · \d+m \d+s · \d+ players?, \d+ recorded bot tracks?$/,
  );
  await expect(chosenLabel).toBeInViewport({ ratio: 1 });
  const overflowPixels = await chosenLabel.evaluate((labelElement) => ({
    across: labelElement.scrollWidth - labelElement.clientWidth,
    down: labelElement.scrollHeight - labelElement.clientHeight,
  }));
  expect(overflowPixels).toEqual({ across: 0, down: 0 });
});

test("both match lists group the real matches by UTC start day: the 23:58 match is under Feb 9", async ({
  page,
}) => {
  await openApp(page);
  await page.locator(".match-dropdown summary").tap();
  const feb9Group = page.getByRole("group", { name: "Feb 9", exact: true });
  await expect(feb9Group.getByRole("checkbox").first()).toHaveAccessibleName(/^23:58 UTC · /);

  await page.locator(".match-dropdown summary").tap();
  await openReplay(page);
  const firstOptionGroup = page.locator(".replay-match-field optgroup").first();
  await expect(firstOptionGroup).toHaveAttribute("label", "Feb 9");
  await expect(firstOptionGroup.locator("option").first()).toHaveText(/^23:58 UTC · /);
});

test("an open dropdown list is drawn above the world-position box and the crosshair", async ({
  page,
}) => {
  await openApp(page);
  await page.locator(".day-dropdown summary").tap();
  await expect(page.locator(".day-dropdown .filter-dropdown-list")).toBeVisible();
  expect(await isCentreCoveredBy(page, ".coordinate-readout", ".day-dropdown")).toBe(true);

  await page.locator(".match-dropdown summary").tap();
  await expect(page.locator(".match-dropdown .filter-dropdown-list")).toBeVisible();
  expect(await isCentreCoveredBy(page, ".coordinate-readout-crosshair", ".match-dropdown")).toBe(
    true,
  );
});

test("a tap on the map closes the open dropdown", async ({ page }) => {
  await openApp(page);
  await page.locator(".day-dropdown summary").tap();
  const dayList = page.locator(".day-dropdown .filter-dropdown-list");
  await expect(dayList).toBeVisible();
  const mapBox = await page.locator(".map-container").boundingBox();
  if (mapBox === null) {
    throw new Error("The map container has no layout box");
  }

  await page.touchscreen.tap(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height * 0.85);

  await expect(dayList).toBeHidden();
});

test("the area hint names only touch steps, not Shift-drag", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Show panels" }).tap();
  await expect(page.locator(".panel-hint")).toHaveText(
    "Press Select area, then drag on the map to see what happened in an area.",
  );
});

test("a tap on the map closes the open panels (user decision 2026-11-03)", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Show panels" }).tap();
  await expect(page.getByRole("button", { name: "Hide panels" })).toBeVisible();
  const mapBox = await page.locator(".map-container").boundingBox();
  if (mapBox === null) {
    throw new Error("The map container has no layout box");
  }

  await page.touchscreen.tap(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height * 0.2);

  await expect(page.getByRole("button", { name: "Show panels" })).toBeVisible();
});
