import { expect, test } from "@playwright/test";

// Replay's match field draws the chosen match's full label under a see-through select. With forced
// colours (for example Windows high contrast) the browser repaints the select's text, so the drawn
// label would show twice: the plain select must be shown alone, its text in system colours.

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "forced-colours emulation is Chromium-only",
);

test("with forced colours, the Match field shows only the select's own text", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  await expect(page.locator(".map-container img.leaflet-image-layer")).toBeVisible();
  await page.locator(".mode-switch button", { hasText: "Replay" }).click();
  const replaySelect = page.locator(".replay-match-field select");
  await expect(replaySelect).toBeVisible();

  await expect(page.locator(".replay-match-chosen")).toBeHidden();
  await expect(replaySelect).toHaveText(/23:58 UTC · /);
  expect(
    await replaySelect.evaluate((selectElement) => getComputedStyle(selectElement).color),
  ).not.toBe("rgba(0, 0, 0, 0)");
});
