import { describe, expect, it } from "vitest";
import type { DataLoader } from "../data/loader";
import { startAppWithLoader } from "./app";
import { appFontFamily } from "./appFont";
import { replayManifest, requireReplayDayFile } from "./replayTestFixtures";

// Runs in headless Chromium. The layout is measured as soon as the app mounts (Replay frames the
// match to the map's size), so the app's typeface must already be in use by then. While it loads, a
// wider fallback can wrap the top bar to two rows; framing then fits a shorter map than the one
// the designer finally sees.

const replayLoader: DataLoader = {
  loadManifest: () => Promise.resolve(replayManifest),
  loadDayFile: (dayFile) => Promise.resolve(requireReplayDayFile(dayFile)),
};

describe("the app's typeface", () => {
  it("is the family the theme sets on the page", () => {
    expect(getComputedStyle(document.body).fontFamily).toContain(`"${appFontFamily}"`);
  });

  it("has loaded before the app mounts its layout", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      expect(document.fonts.check(`1em "${appFontFamily}"`)).toBe(false);
      await startAppWithLoader(root, replayLoader);
      expect(root.querySelector(".map-container")).not.toBeNull();
      expect(document.fonts.check(`1em "${appFontFamily}"`)).toBe(true);
    } finally {
      root.remove();
    }
  });
});
