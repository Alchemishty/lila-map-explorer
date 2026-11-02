# LILA Map Explorer

Where do players spend their time? Where do fights happen? Which routes do they take through a map?

LILA Map Explorer helps level designers answer these questions from recorded match data. It puts player trails, event markers and heatmaps on the game's real minimaps. You can look across matches in Overview, then open one in Replay to see how it unfolded.

The project has two parts. A Python build step reads the match data, cleans known recording errors and writes static data files. A TypeScript app loads those files and draws the map. Once built, the site runs on a static host. It needs no application server or database.

## A walkthrough

The tool covers three maps: AmbroseValley, GrandRift and Lockdown. It works on desktop and on phones.

### 1. Choose what to look at

The top bar switches between **Overview** and **Replay**. Use the filters to choose a map, dates in UTC, and matches. When no match fits the filters, the map stays empty and says so. The app downloads only the data files the current filters need.

### 2. Overview: see patterns across matches

- **Heatmaps.** Pick one of four:
  - **Kill zones:** where players stood when they made a kill
  - **Combat death zones:** where players were killed
  - **Storm death zones:** where players died to the storm
  - **Traffic:** where players spent the most time

  The app opens on **Kill zones**, with markers off. Traffic measures time spent, so frequent position updates do not make an area look busier. Heatmaps blend nearby values to make clusters easier to see: darker means more, and a white outline marks the busiest zones. The colour scale names the total, such as "Storm death zones · N storm deaths". On kill and death heatmaps, dark red needs about five events in one spot.
- **Markers.** Turn on markers to see kills, deaths, storm deaths and loot events at their exact recorded positions. Colour and shape tell the types apart. On a player's kill or death marker, round means the other party was a player and square means a bot. A dashed grey outline marks something a bot did. Each row of the legend is a switch, so you can show or hide each event type, including bot events. While a heatmap is on, markers draw smaller and faded so the heatmap stays readable. Loot markers sit beneath kills and deaths.

### 3. Inspect an area

Shift-drag on the map, or press **Select area** and drag. The inspector then shows:

- how many of each event type happened inside the area
- in how many matches a player's path crossed it
- **Replay a match here**: the area's matches, ordered with the most events inside first. Each row shows its own counts per event type. Choose one to open it in Replay.

### 4. Replay a match

- **Framing.** The map opens zoomed to the whole match, with a margin, so every path and event is in view. On a phone the match is framed above the panels. Pan and zoom freely after that; playback never moves the map.
- **Trails.** Paths appear as the match plays: solid coloured lines for players, dashed grey lines for recorded bots.
- **Playback.** Play or pause at 1×, 4× or 16×, or drag the scrubber. Coloured ticks on the timeline mark each event. Hover over one, or reach it with the keyboard, to see the event and its time into the match; pressing one jumps to that moment.
- **Players and bots.** Pick a player or bot from the list to follow their track. The inspector shows their events so far and whether a death has been recorded.
- **What each actor is doing.** Replay estimates movement between recorded positions. Each player or bot marker shows one of four states: moving, waiting in place, dead here, or last seen here (the track ended with no recorded death). An actor whose track has ended never looks alive.
- **Event details.** Tap or click a marker to see what happened, the time into the match, and the victim or killer. When several events were recorded at exactly the same spot, all of them are listed.
- **Bots.** Replay has its own marker switches. **Hide bot tracks and bot events** removes bots while keeping the player events that involve them.

### 5. Carry a position into your level editor

A small box over the map shows world X and Z. With a mouse, it shows the position under the pointer; press **C** to copy it. On a touch screen, a crosshair marks the centre of the map, and a **Copy** button copies that position.

### 6. On a phone

The panels sit in a drawer at the bottom of the screen. Use **Show panels** / **Hide panels** to open or close it and make room for the map. Pan and pinch-zoom work by touch, and areas are selected with **Select area** and a drag. The filters wrap onto rows instead of running off the screen, and the dropdowns close when you tap outside them. Automated tests cover a phone-sized WebKit browser (iPhone 14 profile), and the app was also checked by hand on an Android emulator.

### Built to be trusted

- Bad or unexpected data never draws a misleading map. The build stops with a message naming the file and the problem, and the browser shows a plain error view instead of the map.
- The labels say only what the data records. For example, a session that ends without a death is not called an extraction, and a match with no recorded bot tracks is not called bot-free. [DATA_QUALITY.md](DATA_QUALITY.md) explains why.
- Automated accessibility checks (axe) run on Overview and Replay at desktop and phone sizes, along with a contrast check for pressed controls.

## Tech stack

| Part | Tools | What they do |
|---|---|---|
| Data build | Python 3.12+, PyArrow, pandas, Pillow | Read Parquet, clean and validate rows, export JSON and resize minimaps |
| Web app | TypeScript, Vite, HTML and CSS | Build the interface and serve it during development; no UI framework |
| Map drawing | Leaflet and Canvas 2D | Pan and zoom the minimap; draw trails, markers and heatmaps |
| Data validation | Zod | Check generated data when the browser loads it |
| Python checks | pytest, Ruff, mypy | Test behavior, check formatting and linting, and check types |
| Web checks | Vitest, Playwright, axe, ESLint, Prettier | Test logic and browser behavior, check accessibility, and check code style |
| Dependencies | uv and npm | Install from the Python and Node lockfiles |

## Run it locally

You need Python 3.12 or newer, uv, Node.js 22 or newer with npm, and `make`. Run the commands below from the project root.

First, check that the match data is present. Its layout should look like this:

```text
player_data/
  maps.json
  minimaps/
    AmbroseValley_Minimap.png
    GrandRift_Minimap.png
    Lockdown_Minimap.jpg
  February_10/
    <actor-and-match-file>
  February_11/
    <actor-and-match-file>
  ...
```

The files inside each day folder are Parquet files without a file extension. Each holds one actor's events in one match. Keep the raw files unchanged.

Install the dependencies, generate the site data, then start the app:

```sh
make setup
make data
make dev
```

`make setup` installs the Python and Node dependencies plus Chromium and WebKit for browser tests. It needs an internet connection for downloads.

Open the local URL printed by Vite, usually `http://localhost:5173`. Leave that terminal running while you use the app.

`make dev` only starts Vite. Run `make data` first on a fresh setup, and again whenever the telemetry or its configuration changes. The generated files go into `web/public/data/`.

## Environment variables and configuration

There are no required environment variables, API keys or `.env` files. The app reads local static data, and the build takes its paths as command-line arguments.

| File | What to configure |
|---|---|
| `player_data/maps.json` | Each map's image filename, world scale and world origins |
| `config/event_types.json` | Event categories, marker styles, colors and display labels |
| `web/vite.config.ts` | Vite settings; `base: "./"` keeps asset and data paths relative |

To add a map, put its image in `player_data/minimaps/` and add its mapping to `player_data/maps.json`. Rebuild the data after changing either configuration file.

To build from a different telemetry folder, run the Python command directly. These paths are relative to `pipeline/` after the `cd`:

```sh
cd pipeline
uv run python -m lila_pipeline build \
  --input /absolute/path/to/telemetry \
  --event-config ../config/event_types.json \
  --output ../web/public/data
```

The input folder must have the same layout as `player_data/`, including `maps.json` and `minimaps/`. All three flags are required.

## How the data reaches the map

```text
player_data/ + config/event_types.json
  -> Python: read, classify, clean, validate
  -> web/public/data/: match index, map/day JSON files, minimap images
  -> Browser: validate, filter, compute, draw
```

The browser loads the match index first, then the map and day files needed for the current selection. It computes heatmaps and area counts from the cleaned rows. Coordinates keep their full precision, and trails are not thinned.

Bad data stops the build with a message naming the file and the problem. A failed data build leaves the previous generated output in place. The browser also checks loaded data and shows an error if it cannot use it.

The match data has known recording errors and records we cannot fully explain. Its README also gets timestamp units, image sizes and bot IDs wrong. [DATA_QUALITY.md](DATA_QUALITY.md) lists every issue we found, with its evidence and how the tool handles it.

## Build and preview

From the project root:

```sh
make build
```

This regenerates the data and writes the production site to `web/dist/`. Publish that whole directory to a static host. The data and minimaps are included. Relative asset paths allow the site to live under a host subdirectory.

To inspect the production build locally:

```sh
cd web
npm run preview
```

Open the URL Vite prints. Serve the files over HTTP rather than opening `index.html` directly, because the app fetches its data files.

## Deployment

The site is published to GitHub Pages by GitHub Actions:

- **Every push to `main`** builds the data and the site (`make build`) and publishes `web/dist/`. If the data build fails, nothing is published and the live site keeps its last good version.
- **Every pull request** runs the full test suite (`make check`), including the browser tests at desktop and phone sizes.

To publish your own copy, push the repository to GitHub, then open **Settings → Pages** and set **Source** to **GitHub Actions**. The site appears at `https://<user>.github.io/<repository>/`.

## Tests and checks

Run the full check before considering a change ready:

```sh
make check
```

It checks Python formatting, linting, types and tests, rebuilds the data, then checks TypeScript, web linting, formatting, unit tests, browser tests and the production build. Playwright smoke tests run in desktop Chromium and phone WebKit, including accessibility checks with axe.

| Command | When to use it |
|---|---|
| `make setup` | Install dependencies and test browsers |
| `make data` | Regenerate data after a telemetry or config change |
| `make dev` | Start the development server |
| `make build` | Generate data and build the production site |
| `make check` | Run all required checks |
| `make check-pipeline` | Check the Python build step |
| `make check-web` | Regenerate data and check the web app |

If the app reports missing data, run `make data` and read any reported file errors. If a check reports a missing Playwright browser, rerun `make setup`. On Linux, Playwright may also need system libraries; from `web/`, use `npx playwright install --with-deps chromium webkit` with the system permissions needed to install them.

## Finding your way around

| Path | Contents |
|---|---|
| `pipeline/src/lila_pipeline/` | Python reader, cleaning rules, validation and export |
| `pipeline/tests/` | Pipeline tests and small data fixtures |
| `web/src/domain/` | Pure logic: coordinates, filters, heatmaps, areas and replay |
| `web/src/data/` | Fetching and data validation |
| `web/src/render/` | Leaflet and canvas drawing |
| `web/src/ui/` | Controls, panels and app state |
| `web/e2e/` | Smoke and accessibility tests |
| `.github/workflows/` | Checks on pull requests and the GitHub Pages deploy |
| `scripts/` | Figure checks for the insights, and the review snapshot tool |
| `docs/` | Working notes for coding agents: data rules, conventions, tests, audit evidence |
| `enforcement/` | Rules that block review when broken |

`web/public/data/`, `web/dist/`, `pipeline/.venv/` and `web/node_modules/` are generated directories.

For more detail, read [ARCHITECTURE.md](ARCHITECTURE.md) for how the tool is built and why, [DATA_QUALITY.md](DATA_QUALITY.md) for the data issues and how they're handled, and [INSIGHTS.md](INSIGHTS.md) for what the tool revealed about the maps. [AGENTS.md](AGENTS.md) describes the contribution and review workflow, which also applies to coding agents.
