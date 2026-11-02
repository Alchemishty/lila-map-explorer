import { defineWorkspace } from "vitest/config";

// Two test projects. "unit" runs every *.test.ts in Node. "browser" runs *.browser.test.ts in
// headless Chromium, for code that only works with real layout (Leaflet, canvas, devicePixelRatio).
export default defineWorkspace([
  {
    extends: "./vite.config.ts",
    test: {
      name: "unit",
      include: ["src/**/*.test.ts"],
      exclude: ["src/**/*.browser.test.ts"],
    },
  },
  {
    extends: "./vite.config.ts",
    // Its own dependency cache: shared with the dev server, each would wipe the other's, and a dev
    // server started mid-run breaks browser test files with "Failed to fetch dynamically imported module".
    cacheDir: "node_modules/.vite-browser-tests",
    test: {
      name: "browser",
      include: ["src/**/*.browser.test.ts"],
      browser: {
        enabled: true,
        provider: "playwright",
        name: "chromium",
        headless: true,
        // One file at a time: in parallel, a file that drives the real keyboard (overlayFollowsMap's
        // pan) fails with "Frame was detached" whenever another file runs beside it.
        fileParallelism: false,
      },
    },
  },
]);
