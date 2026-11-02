import { resolveConfig, type UserConfig } from "vite";
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";
import workspaceProjects from "../vitest.workspace";

// The dev server (vite.config.ts) and the browser test project read the config differently, so a
// shared dependency cache makes each one wipe and rebuild it for the other. A dev server started
// during `make check` then breaks browser test files mid-load with "Failed to fetch dynamically
// imported module". The browser project must pre-bundle into its own cache directory.

function requireBrowserProjectConfig(): UserConfig {
  for (const project of workspaceProjects) {
    if (typeof project === "object" && "test" in project && project.test?.name === "browser") {
      return project;
    }
  }
  throw new Error('vitest.workspace.ts has no inline project named "browser"');
}

describe("vitest workspace", () => {
  it("gives the browser test project a dependency cache the dev server does not use", async () => {
    const devServerConfig = await resolveConfig({ ...viteConfig, configFile: false }, "serve");
    const browserProjectConfig = await resolveConfig(
      { ...viteConfig, cacheDir: requireBrowserProjectConfig().cacheDir, configFile: false },
      "serve",
    );

    expect(browserProjectConfig.cacheDir).not.toBe(devServerConfig.cacheDir);
  });

  it("runs browser test files one at a time", () => {
    // In parallel, a browser test file that drives the real keyboard (overlayFollowsMap's pan)
    // fails with "Frame was detached" whenever another file runs beside it.
    expect(requireBrowserProjectConfig().test?.browser?.fileParallelism).toBe(false);
  });
});
