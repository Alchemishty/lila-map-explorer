// The app's typeface, self-hosted through @fontsource-variable (imported in app.ts).
// theme.css sets the same family on the page; appFont.browser.test.ts keeps the two in step.

/** The CSS font family of the app's typeface. */
export const appFontFamily = "Atkinson Hyperlegible Next Variable";

/**
 * Resolves once the app's typeface is ready to draw text, so layout measured after it (the map's
 * size, Replay's framing) is the layout the designer sees. If the font file cannot be fetched the
 * browser keeps its fallback font; text stays readable, so the app still starts.
 */
export async function loadAppFont(fontSet: FontFaceSet = document.fonts): Promise<void> {
  await fontSet.load(`1em "${appFontFamily}"`);
}
