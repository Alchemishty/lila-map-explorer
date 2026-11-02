import { describe, expect, it } from "vitest";
import { matchFramingInsets, matchFramingMarginPixels, type ClientBox } from "./matchFraming";

// The insets that keep a framed Replay match clear of the map's edges and of the phone's sheet.

const phoneMapBox: ClientBox = { left: 0, right: 390, top: 120, bottom: 740 };

describe("matchFramingInsets", () => {
  it("desktop: a side panel beside the map covers nothing, so only the margin is kept", () => {
    const mapBox: ClientBox = { left: 0, right: 980, top: 50, bottom: 720 };
    const sidePanelBox: ClientBox = { left: 980, right: 1280, top: 50, bottom: 720 };
    expect(matchFramingInsets(mapBox, sidePanelBox)).toEqual({
      topCssPixels: matchFramingMarginPixels,
      rightCssPixels: matchFramingMarginPixels,
      bottomCssPixels: matchFramingMarginPixels,
      leftCssPixels: matchFramingMarginPixels,
    });
  });

  it("phone: the closed sheet's handle over the map's bottom adds to the bottom inset", () => {
    const closedSheetBox: ClientBox = { left: 0, right: 390, top: 700, bottom: 740 };
    expect(matchFramingInsets(phoneMapBox, closedSheetBox).bottomCssPixels).toBe(32 + 40);
  });

  it("phone: the open sheet's whole height over the map adds to the bottom inset", () => {
    const openSheetBox: ClientBox = { left: 0, right: 390, top: 368, bottom: 740 };
    expect(matchFramingInsets(phoneMapBox, openSheetBox)).toEqual({
      topCssPixels: 32,
      rightCssPixels: 32,
      bottomCssPixels: 32 + 372,
      leftCssPixels: 32,
    });
  });

  it("a hidden sheet (no size) covers nothing", () => {
    const hiddenSheetBox: ClientBox = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(matchFramingInsets(phoneMapBox, hiddenSheetBox).bottomCssPixels).toBe(32);
  });

  it("shrinks the margin on a map too small for it, so some room is always left", () => {
    const shortMapBox: ClientBox = { left: 0, right: 390, top: 0, bottom: 160 };
    const sheetBox: ClientBox = { left: 0, right: 390, top: 64, bottom: 160 };
    // 64 px left above the sheet: the margin is a quarter of that, 16 px.
    expect(matchFramingInsets(shortMapBox, sheetBox)).toEqual({
      topCssPixels: 16,
      rightCssPixels: 16,
      bottomCssPixels: 16 + 96,
      leftCssPixels: 16,
    });
  });

  it("throws when the panels cover the whole map", () => {
    const sheetBox: ClientBox = { left: 0, right: 390, top: 100, bottom: 760 };
    expect(() => matchFramingInsets(phoneMapBox, sheetBox)).toThrow(
      "The map has no visible room to frame the match in: it is 390 × 620 CSS px and the panels " +
        "cover 620 of its height",
    );
  });
});
