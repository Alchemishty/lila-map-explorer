import { expect, test, type Page } from "@playwright/test";
import { contrastRatio, parseCssRgbColor, type RgbColor } from "./pressedIndicatorContrast";

// The visual pass on the built app: colour tokens keep WCAG contrast, the typeface is self-hosted,
// section headings are sentence case, the zoom buttons are dark, keyboard focus shows, and on a
// phone the world-position box is small with a large Copy button.

const minimumTextContrastRatio = 4.5; // WCAG 1.4.3 (AA), normal-size text
const minimumNonTextContrastRatio = 3; // WCAG 1.4.11, the ring or fill edge of a pressed control

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".map-container img.leaflet-image-layer")).toBeVisible();
}

/** A colour token from :root, resolved by the browser to rgb(). */
async function readColorToken(page: Page, tokenName: string): Promise<RgbColor> {
  const resolvedCssColor = await page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    if (getComputedStyle(document.documentElement).getPropertyValue(name).trim() === "") {
      throw new Error(`The colour token ${name} is not defined on :root`);
    }
    return color;
  }, tokenName);
  return parseCssRgbColor(resolvedCssColor, `The colour token ${tokenName}`);
}

test("colour tokens keep text at 4.5:1 and pressed controls at 3:1 on every surface", async ({
  page,
}) => {
  await openApp(page);
  const surfaceTokenNames = ["--surface-background", "--surface-raised", "--surface-hover"];
  for (const surfaceTokenName of surfaceTokenNames) {
    const surfaceColor = await readColorToken(page, surfaceTokenName);
    for (const textTokenName of ["--text-primary", "--text-muted"]) {
      expect(
        contrastRatio(await readColorToken(page, textTokenName), surfaceColor),
        `${textTokenName} on ${surfaceTokenName}`,
      ).toBeGreaterThanOrEqual(minimumTextContrastRatio);
    }
    for (const markTokenName of ["--accent", "--focus-ring"]) {
      expect(
        contrastRatio(await readColorToken(page, markTokenName), surfaceColor),
        `${markTokenName} against ${surfaceTokenName}`,
      ).toBeGreaterThanOrEqual(minimumNonTextContrastRatio);
    }
  }
  expect(
    contrastRatio(
      await readColorToken(page, "--text-on-accent"),
      await readColorToken(page, "--accent"),
    ),
  ).toBeGreaterThanOrEqual(minimumTextContrastRatio);
});

test("the typeface is self-hosted and section headings are sentence case", async ({ page }) => {
  const otherOriginFontUrls: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font" && !request.url().startsWith("http://localhost:4173/")) {
      otherOriginFontUrls.push(request.url());
    }
  });
  await openApp(page);
  const isTypefaceLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('14px "Atkinson Hyperlegible Next Variable"');
  });
  expect(isTypefaceLoaded).toBe(true);
  expect(otherOriginFontUrls).toEqual([]);

  const sectionHeadings = page.locator(".panel-section h2");
  expect(await sectionHeadings.count()).toBeGreaterThan(0);
  for (const heading of await sectionHeadings.all()) {
    await expect(heading).toHaveCSS("text-transform", "none");
  }
});

test("the zoom buttons are dark, with readable symbols", async ({ page }) => {
  await openApp(page);
  const zoomInButton = page.locator(".leaflet-control-zoom-in");
  const { backgroundCssColor, symbolCssColor } = await zoomInButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundCssColor: style.backgroundColor, symbolCssColor: style.color };
  });
  const backgroundColor = parseCssRgbColor(backgroundCssColor, "The zoom button background");
  expect(backgroundColor).toEqual(await readColorToken(page, "--surface-raised"));
  expect(
    contrastRatio(parseCssRgbColor(symbolCssColor, "The zoom button symbol"), backgroundColor),
  ).toBeGreaterThanOrEqual(minimumTextContrastRatio);
});

test("keyboard focus shows an outline on top-bar and panel controls", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "keyboard Tab focus is tested with a keyboard");
  await openApp(page);
  for (const control of [
    page.getByRole("group", { name: "Mode" }).getByRole("button").first(),
    page.getByRole("button", { name: "Select area" }),
  ]) {
    await control.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(control).toBeFocused();
    await expect(control).toHaveCSS("outline-style", "solid");
    await expect(control).toHaveCSS("outline-width", "2px");
  }
});

test("checkboxes and radios use the accent, not the browser's blue", async ({ page }) => {
  await openApp(page);
  const accentColor = await readColorToken(page, "--accent");
  for (const control of [
    page.locator(".heatmap-choice input[type='radio']").first(),
    page.locator(".marker-switches input[type='checkbox']").first(),
  ]) {
    const controlAccentCssColor = await control.evaluate(
      (element) => getComputedStyle(element).accentColor,
    );
    expect(parseCssRgbColor(controlAccentCssColor, "A control's accent colour")).toEqual(
      accentColor,
    );
  }
});

test("phone: the world-position box is compact and its Copy button is a large target", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the Copy button shows on touch screens");
  await openApp(page);
  const readout = page.getByRole("group", { name: "World position at the crosshair" });
  const copyButton = readout.getByRole("button", { name: "Copy world position" });
  await expect(copyButton).toBeVisible();
  const readoutBox = await readout.boundingBox();
  const copyBox = await copyButton.boundingBox();
  if (readoutBox === null || copyBox === null) {
    throw new Error("The world-position box or its Copy button has no layout box");
  }
  // Before the visual pass the box was about 170 × 64 px on this screen.
  expect(readoutBox.height).toBeLessThanOrEqual(44);
  expect(readoutBox.width * readoutBox.height).toBeLessThan(170 * 64);
  // Well over WCAG 2.5.8's 24 × 24 px minimum target.
  expect(copyBox.width).toBeGreaterThanOrEqual(44);
  expect(copyBox.height).toBeGreaterThanOrEqual(32);
  expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(readoutBox.x + readoutBox.width);
  expect(copyBox.y + copyBox.height).toBeLessThanOrEqual(readoutBox.y + readoutBox.height);
});
