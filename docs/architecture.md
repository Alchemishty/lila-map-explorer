# Architecture

## Shape

A Python build step produces static data files. A TypeScript web app (Vite, no React) loads and draws them. The output is plain static files that any static host serves. The build stays host-neutral.

## Data input (the drop location)

- Same layout as `player_data/`: day folders of parquet files, plus `minimaps/` and a `maps.json` listing each map's name, image file, scale and origins.
- A new map is a new image plus a new `maps.json` entry.
- Event types are mapped in `config/event_types.json` (event to category, marker, color), not in code.

## Build step (Python, the only copy of the cleaning rules)

- Reads the drop location and applies the cleaning rules in `domain.md`.
- Validates, then writes the app's data. The build **fails** with a plain-language report naming the file and problem if:
  - any file breaks the contract (mixed player and bot events, a UUID with bot events, more than one map or match in a file, points outside the minimap)
  - the data contains an event type the config doesn't know
  - a map has no config entry
  - a match has every row at the same second (length 0), which means its timestamps were recorded wrongly
  - the files of one match, taken together, name more than one map
- A failed build publishes nothing, so the live site stays as it was (atomic write).
- Output:
  - a small match index (`manifest.json`): map, UTC date, start time, length, counts of players, bots and events
  - one data file per map per UTC day, holding every cleaned row of every actor in those matches at full precision, with match, actor and flags
  - minimap images resized for the web (longest side at most 4096 px, JPEG quality 85)

## Web app

- Loads the index first.
- Loads only the map and day files the current filters need.
- **Overview computes every heatmap, marker set and inspector number in the browser, exactly, from the rows.** Nothing is pre-summed.
- **Replay** takes one match's rows from the same files.
- Leaflet in plain-image mode gives pan and zoom. A canvas overlay draws trails, markers and heatmaps.
- The overlay canvas sits in a map layer that moves with every pan and is scaled about its map spot on every zoom (each pinch frame included), with a 10% margin past each edge. So during a drag or pinch it is not redrawn: it is redrawn once when the view settles (`moveend`, resize, `showMap`) and whenever its layers change. Only the world-position readout follows the view live, through `MapView.onViewMove` (every pan or pinch frame); it converts one point and draws nothing.

## Layers

Layers are one-way. Each layer may import from the layers to its left, never the reverse.

```
domain  <-  data    (data imports domain only)
domain  <-  render  (render imports domain only; never data)
domain, data, render  <-  ui
(pure     (fetch +   (Leaflet /   (DOM)
 logic)    parse)     canvas)
```

- `domain`: pure logic and types. No DOM, no fetch, no Leaflet. Enforced by ESLint.
- `data`: fetch and parse, validating once with zod.
- `render`: Leaflet and canvas drawing.
- `ui`: DOM, state store, panels.

## Data flow

```
player_data/ (parquet, minimaps, maps.json) + config/event_types.json
  -> pipeline, in module order: errors, config, raw_files, classify, clean, validate, export, cli
  -> web/public/data/ (manifest.json, per-map per-day files, minimaps)
  -> web data loader (zod validation once on load, error view on failure)
  -> domain (filters, events, heatmaps, traffic, area, playback)
  -> render (Leaflet + canvas) -> ui (Overview, Replay)
```

## Settled design rules

Decisions made while building that later work must respect:

- **One owner for the canvas.** `render/scene.ts` holds every layer in world space and redraws them all in a fixed order. Overview and Replay only call `scene.setLayers(...)`, which replaces every layer; the active mode passes empty layers when it has nothing to show, so switching mode never leaves the other mode's drawing behind.
- **State resets go through `transitionAppState`** (`ui/stateTransitions.ts`). A match change gives elapsed 0, paused and no followed actor. A filter change keeps the match if it's still selected, otherwise the earliest selected match, otherwise `null`. The Replay picker shows exactly the selected matches.
- **Repeat rows are ordinary rows.** Rows flagged `isSameTickRepeat` count and draw like any other; the marker inspector notes a possible multi-kill.
- **Overview area counts include every player event.** Player marker switches only change what is drawn; area counts include every player-side event type, even when all markers are off, whatever the heatmap. Each bot-event type counts only while its own marker switch is on. In Replay bot events are on by default, and hiding bots hides bot trails and bot-performed events.
- **Heatmap grid edges.** Cells include the top edge, and points outside the grid throw.
- **Data URL.** `dataBaseUrl = import.meta.env.BASE_URL + "data/"`, with Vite `base: "./"`, so the site works under a subdirectory.
- **Phone layout** applies at viewport width ≤ 720 px.
- **Phone sheet over the map** (2026-11-02): to keep a tapped Replay marker above the open sheet, `MapView.moveContentUp` may move the content past the image's bottom edge by widening the pan limit below the image (`render/roomBelowImage.ts`); closing the sheet (`BottomSheet.onCollapse`) calls `releaseRoomBelowImage`, so the image is the limit again. Panels open, close and scroll the panel area only through `BottomSheet.collapse` and `reveal`.
- **Replay frames the match** (2026-11-02): when a match loads in Replay (chosen, or Replay entered with it), `ui/matchFraming.ts` fits every row of its shown tracks (each trail point and event) through `MapView.fitWorldRect`, once. Rows spanning less than `minimumFramedSpanWorldUnits` (40) on an axis are widened to it about their centre (`domain/matchExtent.ts`), so a one-point match still gets a view. The fit keeps a 32 px margin, plus on a phone the part of the map the bottom sheet covers (its handle when closed); the timeline is docked under the map, never over it. The fit re-measures the container first (Leaflet only does so on a window resize, and the timeline appears when Replay opens), gives back any room below the image, and moves content near the image's bottom edge up past it when the sheet would cover it. It never changes the zoom-out limit. Playback, switches, Hide bots and the designer's own pan and zoom never refit.
- **Visual tokens** (2026-11-02): every chrome colour, corner radius and type size is a token in `ui/theme.css` (imported first by `ui/app.ts`). The chrome is neutral graphite with no hue; the one accent for pressed and selected controls is a light neutral fill (`--accent`, text `--text-on-accent`), because the data colours already take most hues. Radii come from one scale (`--radius-mark`, `--radius-small`, `--radius-control`, `--radius-surface`), sizes from `--font-size-small`/`-body`/`-heading`, and section headings are sentence case. The typeface is Atkinson Hyperlegible Next, self-hosted through `@fontsource-variable/atkinson-hyperlegible-next` (Vite bundles the files; no runtime font request leaves the site), with tabular figures everywhere. The app waits for the typeface (`ui/appFont.ts`) before it mounts: a wider fallback font can wrap the top bar, and Replay frames the match to the map's size at mount. Data colours, marker shapes and the heat ramp never come from these tokens.
- **Opening view** (2026-11-02): Overview opens on Kill zones with every marker type off (`createInitialAppState`). Markers draw smaller and faded whenever the scene has a heat grid (`markerAppearanceFor` in `render/scene.ts`), and loot draws beneath the other markers.

## File structure

```
AGENTS.md                       agent rules up front (CLAUDE.md only imports it)
README.md, ARCHITECTURE.md, INSIGHTS.md, DATA_QUALITY.md   human-facing docs (neutral voice, no links into docs/)
Makefile                        setup / data / dev / build / check
.gitignore
.github/workflows/checks.yml    make check on every pull request
.github/workflows/deploy.yml    make build on push to main, then publish web/dist/ to GitHub Pages
.claude/agents/code-reviewer.md the review agent
scripts/snap.sh                 review snapshots and packages in .review/ (gitignored, with the local ledger)
scripts/verify-insights.mjs     checks the INSIGHTS.md figures (run after make data; not in make check)
config/event_types.json         event -> category, other party, marker
player_data/maps.json           per-map image + scale + origin (part of the drop format)
docs/architecture.md, conventions.md, domain.md, testing.md
docs/data-findings/telemetry-audit-evidence/   evidence tables behind DATA_QUALITY.md
enforcement/*.md                7 rule files
pipeline/
  pyproject.toml, uv.lock
  src/lila_pipeline/
    errors.py        DataContractError (first module; every later module may import it)
    config.py        MapConfig, EventConfig loading + validation
    raw_files.py     discover + read parquet -> RawFile
    classify.py      FileLabel: actor_type, player_key
    clean.py         duplicate file/block/BotKilled rules, is_same_tick_repeat, sort, day_utc
    validate.py      all contract checks (files, maps, bounds, events, minimaps)
    export.py        manifest.json, day files, minimap resize, atomic write
    cli.py           `build` command
    telemetry_audit.py, telemetry_audit_cli.py   one-off audit that writes the evidence tables (not part of the build)
    __init__.py, __main__.py
  tests/
    fixtures.py      writes tiny parquet files in tmp dirs
    test_config.py, test_raw_files.py, test_classify.py, test_clean.py,
    test_validate.py, test_match_length.py, test_export.py, test_cli.py, test_multiplayer.py, test_marker_labels.py,
    test_telemetry_audit.py, test_telemetry_audit_report.py (evidence and DATA_QUALITY.md), test_readme.py, test_snap_script.py
web/
  package.json, package-lock.json, tsconfig.json, vite.config.ts, vitest.workspace.ts,
  eslint.config.js, .prettierrc.json, playwright.config.ts, index.html
  src/
    main.ts, vitestWorkspace.test.ts (the browser test project keeps its own Vite dependency cache)
    domain/   types.ts, coordinates.ts, contract.ts, filters.ts, events.ts,
              actorColors.ts, coordinateReadout.ts, heatmap.ts, heatmapSmoothing.ts, heatmapColorTop.ts, heatmapContour.ts (busiest-zone outline), traffic.ts, area.ts, playback.ts, trailHeadState.ts, eventStacks.ts, matchExtent.ts (the rows a Replay match covers)  (+ *.test.ts, eventDrawOrder.test.ts)
              test-only: contractTestFixtures.ts, playbackTestFixtures.ts, playbackEvents.test.ts
    data/     loader.ts (+ loader.test.ts)
    render/   mapView.ts, imageLatLng.ts (+ test), canvasOverlay.ts, scene.ts (+ test, sceneHeatRaster.test.ts, sceneMarkersUnderHeatmap.test.ts), drawHeatmap.ts (+ browser test: heatmap cell raster), drawHeatmapOutline.ts (+ test), heatRamp.ts (+ test), heatRaster.test.ts, drawMarkers.ts (+ drawMarkerAppearance.test.ts),
              drawTrails.ts, drawSelection.ts, markerSwatch.ts (legend swatches),
              draw.test.ts, mapView.browser.test.ts, mapViewZoomOutLimit.browser.test.ts (zoom-out limit follows the image and container size), overlayFollowsMap.browser.test.ts (headless Chromium);
              test-only: recordingContextTestFixtures.ts, sceneTestFixtures.ts
              roomBelowImage.ts (+ mapViewRoomBelowImage.browser.test.ts: content moved above a phone's open sheet, and given back)
              fitBoundsInsideInsets.ts (+ mapViewFitWorldRect.browser.test.ts: Replay's fit, inside insets, zoom-out kept, GrandRift, one point)
    ui/       theme.css (colour, radius and type tokens, focus ring, dark zoom buttons), appFont.ts (the typeface family; startup waits for it; + browser test appFont), coordinateReadout.ts, coordinateReadout.css (world-position readout and touch crosshair; + browser tests coordinateReadout, coordinateReadoutViewMove, appCoordinateReadout),
              store.ts (+ test), stateTransitions.ts (+ test, initialAppState.test.ts), app.ts, layout.css, layoutPhone.css, topBar.ts (+ topBarDropdowns.browser.test.ts: dropdowns close on a press outside, on Escape, and one at a time; + topBarMatchGroups.browser.test.ts: both match lists grouped by UTC start day, the map first), topBarLists.ts (dropdowns and their checkbox lists, flat or grouped by day), replayMatchPicker.ts (Replay's grouped select, showing the chosen match's full label), matchPicker.ts (+ test), errorView.ts, bottomSheet.ts (collapse, reveal, onCollapse),
              app.browser.test.ts, errorViewAndBottomSheet.browser.test.ts (headless Chromium),
              overviewPanel.ts, overviewPanel.css, overviewModel.ts, heatmapChoices.ts (+ test, + heatmapScale.browser.test.ts: heatmap names, descriptions and colour scale), heatmapChoiceFieldset.ts (the Heatmap radio group; only the chosen description shows), legend.ts (+ test), markerVisibility.ts (+ test), markerSwitches.ts (+ browser test: legend rows as per-type switches), inspector.ts (+ test, + areaInspector.browser.test.ts: the area's match list, + areaCounts.browser.test.ts: the area's swatch counts), areaSelection.ts,
              overview.test.ts, overviewOpeningArea.test.ts (area counts with every marker off), overviewHeatmap.test.ts, overviewHeatmapTotal.test.ts, overviewMarkers.test.ts, overview.browser.test.ts, overviewSwitchesWhileLoading.browser.test.ts, areaSelection.browser.test.ts, shorterPanel.browser.test.ts (descriptions, Only buttons, trail-head key), panelAreaFlow.browser.test.ts (area result in view, phone sheet on Select area and marker taps); test-only: overviewTestFixtures.ts,
              replayPanel.ts, replayPanel.css, replayModel.ts, mapTaps.ts, keepMarkerAboveSheet.ts (+ test), matchFraming.ts (+ test, + replayFraming.browser.test.ts: the map framed on each loaded match, desktop and phone), followedActorSummary.ts, trailHeadKey.ts, replayInspector.ts, actorList.ts, timeline.ts, timeline.css (+ timelineTicks.browser.test.ts: tick targets, tooltips on screen at phone width, Escape, jump on press), tickTooltip.ts (+ test),
              replay.test.ts, replayMarkerSwitches.test.ts (+ browser test), replayInspector.test.ts, replayMarkerStack.browser.test.ts (markers stacked at one spot), replay.browser.test.ts, replayLoading.browser.test.ts; test-only: replayTestFixtures.ts
  e2e/        smoke.spec.ts, coordinateReadout.spec.ts, shorterPanel.spec.ts (heatmap descriptions, Only buttons with a mouse and on touch), replayMatchField.spec.ts (forced colours: the Match field shows only the select), visualTheme.spec.ts (token contrast, self-hosted typeface, sentence-case headings, dark zoom buttons, focus outline, compact phone world-position box with a large Copy target), phoneTopBar.spec.ts (phone: filters on screen with the map first, 2 rows on Overview and 3 on Replay, the chosen match's full label, both lists grouped by day on real data, open list above the map's overlays, map tap closes it, touch area hint); test-only: pressedIndicatorContrast.ts (WCAG 1.4.11 contrast of pressed controls, which axe does not test)
```

Generated, not kept: `web/public/data/`, `web/dist/`, `pipeline/.venv/`, `web/node_modules/`.
