# Testing

## Tests that must exist

- Coordinate mapping, including the README's worked example: world (-301.45, -355.55) on AmbroseValley gives pixel (78, 890) on a 1024 image, scaled correctly for the real image size.
- Each cleaning rule in `domain.md`, against small fixtures.
- A made-up multiplayer match (several players, player-vs-player kills, bots) through the build step and the app logic, since the real data has almost none.
- Filters, heatmap summing and playback timing.

Edge cases every review checks:

1. **No matches for the chosen filters.** Overview shows "No matches for these filters" and an empty map, with no crash or stale layers.
2. **A match that crosses midnight UTC** (`ac049b28…` starts Feb 10 23:51). All its rows land in one day file, keyed by the match's start day, so Replay sees the whole match.
3. **Actors with 0 or 1 position samples.** Traffic adds no time, except that one sample followed by a later death at exactly its world X and Z adds the gap until that death. Replay shows a head with no trail and doesn't crash.
4. **Changing match, mode or filters during playback.** Playback stops, elapsed resets to 0 and no trails from the previous match remain.
5. **The non-square GrandRift image (2160×2158) and points exactly on the minimap edge.** Width and height are used separately, and edge points (u or v exactly 0 or 1) are valid.

## Running each suite

| Suite | Command |
|---|---|
| Everything | `make check` (runs `check-pipeline` then `check-web`) |
| Pipeline | `make check-pipeline`: mypy, ruff, pytest |
| Web | `make check-web`: tsc strict, ESLint, Prettier, Vitest (Node unit tests plus `*.browser.test.ts` in headless Chromium), production build, Playwright smoke tests with axe at desktop and phone sizes |
| Pytest only | `cd pipeline && uv run pytest` |
| Vitest only | `cd web && npm test` (both projects in `vitest.workspace.ts`: `unit` in Node, `browser` in headless Chromium) |
| Browser unit tests only | `cd web && npx vitest run --project browser` (Leaflet map view and canvas overlay, which need real layout). Files run one at a time (`fileParallelism: false`): in parallel, the keyboard-driven pan test fails with "Frame was detached" |
| Playwright only | `cd web && npm run e2e` (builds first; needs `make data`) |

`make check-web` and `make build` run `make data` first. `npm run e2e` runs `vite build` before `playwright test`, so the smoke tests never test a stale build. The smoke tests (`web/e2e/smoke.spec.ts`) run in two Playwright projects: `desktop` (Chromium, 1280×800) and `phone` (WebKit, iPhone 14 profile, 390×844). `make setup` installs both browsers.

## Left out on purpose

Secret scanning, coverage percentages, pre-commit hooks and bundle-size budgets.

## CI

`.github/workflows/checks.yml` runs `make check` on Ubuntu for every pull request, with both test browsers and their system libraries. Pushes to `main` only build and deploy (`.github/workflows/deploy.yml`), so run `make check` locally or open a pull request before merging.

## Approved wording regressions

Tests cover all eight real-config marker labels, their use in legends and timeline ticks, the shared position explanation, heatmap names and accessible descriptions, explicit Victim/Killer roles (including unknown bot counterparts), recorded bot-track counts with singular/plural agreement, UTC date labels, loot-event counts and death-recorded-so-far summaries. Browser checks verify the hide-bot explanation and retained player events involving bots; smoke tests use the renamed heatmap choices at desktop and phone sizes.
