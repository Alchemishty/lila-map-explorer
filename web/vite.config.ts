import { defineConfig } from "vite";

// base "./" keeps every asset and data URL relative, so the built site works from any host sub-path.
export default defineConfig({
  base: "./",
});
