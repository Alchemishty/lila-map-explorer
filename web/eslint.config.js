import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// Gitignore-style "**/ui" matches both "../ui" and "../ui/store" for each named layer folder or module.
const layerImportPatterns = (...layerNames) => layerNames.map((layerName) => `**/${layerName}`);

const buildLayerImportRule = (forbiddenGroups, message) => [
  "error",
  { patterns: forbiddenGroups.map((group) => ({ group: [group], message })) },
];

export default tseslint.config(
  { ignores: ["dist/", "public/", "node_modules/", "test-results/", "playwright-report/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "max-lines": ["error", { max: 300 }],
    },
  },
  {
    files: ["src/domain/**"],
    rules: {
      "no-restricted-imports": buildLayerImportRule(
        [...layerImportPatterns("data", "render", "ui", "main"), "leaflet"],
        "domain is pure logic: it may not import data, render, ui, main or leaflet.",
      ),
    },
  },
  {
    files: ["src/data/**"],
    rules: {
      "no-restricted-imports": buildLayerImportRule(
        layerImportPatterns("render", "ui", "main"),
        "data imports domain only: never render, ui or main.",
      ),
    },
  },
  {
    files: ["src/render/**"],
    rules: {
      "no-restricted-imports": buildLayerImportRule(
        layerImportPatterns("ui", "data", "main"),
        "render imports domain only: never ui, data or main.",
      ),
    },
  },
);
