import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The world-position readout on the built app with real data: pointer mode on the desktop project
// (Chromium, mouse), crosshair mode on the phone project (WebKit, iPhone 14 profile, touch only).

const shownCoordinatePattern = /^-?\d+\.\d$/;

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

test("desktop: shows the world position under the mouse and copies it with C", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "pointer mode needs a mouse");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const consoleErrorMessages = await openApp(page);
  const readout = page.getByRole("group", { name: "World position under the pointer" });
  await expect(readout).toBeVisible();
  await expect(page.locator(".coordinate-readout-crosshair")).toBeHidden();
  await expect(readout.locator('[data-world-axis="x"]')).toHaveText("—");

  const mapBox = await page.locator(".map-container").boundingBox();
  if (mapBox === null) {
    throw new Error("The map container has no layout box");
  }
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await expect(readout.locator('[data-world-axis="x"]')).toHaveText(shownCoordinatePattern);
  await expect(readout.locator('[data-world-axis="z"]')).toHaveText(shownCoordinatePattern);
  const shownCopyText = `${await readout.locator('[data-world-axis="x"]').textContent()}, ${await readout
    .locator('[data-world-axis="z"]')
    .textContent()}`;

  await page.keyboard.press("c");
  await expect(readout.locator(".coordinate-readout-status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shownCopyText);

  const accessibilityScan = await new AxeBuilder({ page }).include(".coordinate-readout").analyze();
  expect(accessibilityScan.violations).toEqual([]);
  expect(consoleErrorMessages).toEqual([]);
});

test("phone: shows the world position at the centre crosshair, with a Copy button", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "crosshair mode needs a touch screen with no hover");
  const consoleErrorMessages = await openApp(page);
  const readout = page.getByRole("group", { name: "World position at the crosshair" });
  await expect(readout).toBeVisible();
  await expect(page.locator(".coordinate-readout-crosshair")).toBeVisible();
  await expect(readout.locator('[data-world-axis="x"]')).toHaveText(shownCoordinatePattern);
  await expect(readout.locator('[data-world-axis="z"]')).toHaveText(shownCoordinatePattern);
  await expect(readout.getByRole("button", { name: "Copy world position" })).toBeEnabled();

  // The readout sits top-right, clear of the bottom sheet and Leaflet's zoom buttons (top-left).
  const readoutBox = await readout.boundingBox();
  const sheetBox = await page.locator(".bottom-sheet").boundingBox();
  const zoomBox = await page.locator(".leaflet-control-zoom").boundingBox();
  if (readoutBox === null || sheetBox === null || zoomBox === null) {
    throw new Error("The readout, the bottom sheet or the zoom buttons have no layout box");
  }
  expect(readoutBox.y + readoutBox.height).toBeLessThan(sheetBox.y);
  expect(readoutBox.x).toBeGreaterThan(zoomBox.x + zoomBox.width);

  const accessibilityScan = await new AxeBuilder({ page }).include(".coordinate-readout").analyze();
  expect(accessibilityScan.violations).toEqual([]);
  expect(consoleErrorMessages).toEqual([]);
});
