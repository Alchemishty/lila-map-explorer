# How LILA Map Explorer is built

LILA Map Explorer helps level designers see where players move, fight and die, then replay a match to understand what happened.

## Tools and why we chose them

Python handles data preparation. PyArrow reads Parquet, pandas handles cleaning and grouping, and Pillow resizes minimaps. We chose this stack because it makes the telemetry easy to inspect and lets us test cleaning rules before data reaches the browser.

The browser app uses TypeScript to help catch mistakes when converting game positions to image or screen positions. Vite runs the development server and builds the static site. Leaflet handles mouse and touch navigation over the minimap. Canvas draws trails, markers and heatmaps on one surface, avoiding a separate page element for each point. The controls use plain HTML and TypeScript; the interface is small enough to manage without React.

## From recorded files to the map

```text
Parquet + map/event configuration
  → Python validation and cleaning
  → match index + map/day JSON files + minimap images
  → browser loading and validation
  → filtering, analysis and playback
  → Leaflet map with Canvas overlays
```

The Python build reads one file per player or bot session, checks its contents, identifies players and bots, removes confirmed duplicates and sorts events by time. It writes a match index and one JSON file per map per UTC day. All cleaned rows are kept. Minimap images are resized to a maximum side of 4096 pixels.

The browser loads the index first, then only the map/day files needed by the filters. Zod validates the loaded data. Overview computes heatmaps and area counts from the rows; Replay uses those same records to show each actor over time.

Configuration files define map origins, scales, image paths, event categories and marker styles. These settings can change without editing application code.

## Placing game positions on the minimap

The dataset README identifies `y` as height, so the map uses `x` and `z`. Each map has an origin (its starting game coordinates) and a scale (the distance it covers in game units). These let us work out how far across the image a position belongs. Image rows run downward from the top-left, so we flip the vertical direction:

```text
pixelX = ((worldX − worldOriginX) / worldScale) × imageWidthPixels
pixelY = (1 − (worldZ − worldOriginZ) / worldScale) × imageHeightPixels
```

For example, on AmbroseValley, world position `(-301.45, -355.55)` is about 7.62% across and 13.05% up the map. On a 1024-pixel image, this gives approximately `(78, 890)`, matching the dataset README's example. These numbers are rounded here for explanation; the application keeps the coordinate precision.

The dataset README's image-size assumption needed correcting: the supplied images are 4320×4320, 2160×2158 and 9000×9000 pixels. We read the actual dimensions, use width and height independently, and export the resized dimensions with the data. This keeps positions aligned after resizing and handles rectangular GrandRift correctly.

Leaflet then converts image positions into screen positions for the current pan and zoom. Tests cover the worked example, map edges, rectangular images and conversion back to world coordinates.

## Records we cannot fully explain

Some problems are clear errors, such as duplicate files. Others remain uncertain: player sessions with bot-style IDs, kill/death pairs with no supporting track, missing bot tracks, unknown session outcomes and gaps between positions. The build fixes confirmed errors without changing the raw files. It keeps uncertain records and shows only what they support. [DATA_QUALITY.md](DATA_QUALITY.md) gives the evidence and the decision for each case.

## Main choices and their costs

| Question | Options considered | Decision and benefit | Cost accepted |
|---|---|---|---|
| How should data be processed and served? | Running backend; browser uploads; prepared static files | Prepare and check the data in Python, then serve static files. No application server or database is needed. | New telemetry requires rebuilding; larger datasets may exceed what the browser can handle. |
| Should speed or detail come first? | Sample events and simplify trails; retain all cleaned telemetry | Keep exact coordinates and complete trails so designers can inspect the source data. | Larger downloads and more browser computation. |
| Should the app support several players per match? | One player per match; multiple players and bots | Support multiple actors from the start, even though nearly all supplied matches contain one recorded player. | Tracking players and testing Replay takes more work, with few real multiplayer examples to check. |
| What should happen when input is invalid? | Skip bad files and publish the rest; reject the update | Report the file and problem, then stop. Generate new output separately and replace previous output only after success. | One bad file can block an update until corrected. |
| How should heatmaps communicate patterns? | Separate grid cells or blended colors; fixed colors or colors scaled to the selection | Blend colors for drawing and scale them to the current selection. Kill and death heatmaps need about five events in one spot to show dark red. Counts and markers stay exact, and the scale shows the total. | Blended colors spread beyond exact event positions. The same shade can mean different amounts in different selections. |
