import { defineConfig, devices } from "@playwright/test";

// Smoke tests against the production build served by `vite preview`. The `e2e`
// npm script runs `vite build` first, so these never test a stale build. `make data` must have
// written web/public/data/ before the build; `make check-web` does that.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // The iPhone 14 profile runs in WebKit; its viewport is set to the full 390×844 screen.
      name: "phone",
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: false,
  },
});
