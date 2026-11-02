# Enforcement: Coordinate Spaces

**Rule:** There are three coordinate spaces, each with its own type, and they are never mixed:

| Space | Type | Meaning |
|---|---|---|
| World | `WorldPoint { worldX, worldZ }` | game units from the telemetry (`y` is elevation and is not used) |
| Image pixel | `PixelPoint { pixelX, pixelY }` | pixels on the minimap image, origin top-left |
| Canvas | `CanvasPoint { canvasX, canvasY }` | CSS pixels relative to the top-left of the canvas being drawn on. On the map overlay that is the map container's top-left (Leaflet container points); a legend marker swatch is its own small canvas. All drawing and hit tests use this space. |

A value from one space is never passed where another is expected, and a point is never built from another space's fields. The only crossings are:
- world ↔ pixel: `worldToPixel` and `pixelToWorld` in `domain/coordinates.ts`
- world ↔ canvas: `MapView.worldToCanvasPoint` and `MapView.canvasPointToWorld` in `render/mapView.ts`
- world → canvas, many points: `MapView.worldToCanvasConverter()` in `render/mapView.ts` returns a converter with the same mapping as `worldToCanvasPoint` for the current view. It is valid only until the next move: get a new one on every redraw, never keep one.

A map-overlay `CanvasPoint` and a swatch `CanvasPoint` are never mixed: map points come only from `MapView.worldToCanvasPoint` or a converter from `MapView.worldToCanvasConverter()`, and swatch points are fixed positions inside the swatch.

**Why:** All three spaces are plain numbers, so mixing them gives a plausible but misplaced point (an anti-goal in `AGENTS.md`). Images are not 1024 px and GrandRift is not square, so width and height are used separately. Map-overlay canvas points move when the map pans or zooms, so a cached canvas point is wrong after any move. The one thing reused across moves is the drawn overlay picture itself: between redraws, `MapView.anchorOverlayElement` keeps the overlay canvas over the map spot it was drawn for (moved with each pan, scaled about that spot on each zoom), and every redraw computes its canvas points afresh.

## Violations

### Plain numbers or anonymous `{x, y}` for points
```ts
// VIOLATION
function drawMarker(x: number, y: number) { ... }
drawMarker(event.worldX, event.worldZ);           // world values into screen parameters
function drawTrail(points: { x: number; y: number }[]) { ... }   // which space?

// REQUIRED
function drawMarker(context: CanvasRenderingContext2D, at: CanvasPoint, style: MarkerStyle) { ... }
drawMarker(context, mapView.worldToCanvasPoint(event.position), style);
```
```python
# VIOLATION
def to_screen(x, z): ...

# REQUIRED
@dataclass(frozen=True)
class WorldPoint:
    world_x: float
    world_z: float
```

### Building a point from the other space's fields
```ts
// VIOLATION
const point: PixelPoint = { pixelX: row.worldX, pixelY: row.worldZ };
const world: WorldPoint = { worldX: pixel.pixelX, worldZ: pixel.pixelY };
const canvas: CanvasPoint = { canvasX: pixel.pixelX, canvasY: pixel.pixelY }; // image pixels are not canvas pixels

// REQUIRED: go through the mapping
const pixelPoint = worldToPixel({ worldX: row.worldX, worldZ: row.worldZ }, mapConfig);
const canvasPoint = mapView.worldToCanvasPoint({ worldX: row.worldX, worldZ: row.worldZ });
```

### Wrong mapping
```ts
// VIOLATION: assumes 1024 square, drops the y flip, ignores real size
const pixelX = u * 1024;
const pixelY = v * 1024;

// REQUIRED (MapConfig carries the real image size from the manifest)
const u = (point.worldX - mapConfig.worldOriginX) / mapConfig.worldScale;
const v = (point.worldZ - mapConfig.worldOriginZ) / mapConfig.worldScale;
const pixelX = u * mapConfig.imageWidthPixels;
const pixelY = (1 - v) * mapConfig.imageHeightPixels;
```

### Canvas pixels vs device pixels
The overlay canvas's backing store is `cssSize × devicePixelRatio`, and the context is pre-scaled once. Drawing code works only in `CanvasPoint` CSS pixels and never multiplies by `devicePixelRatio` itself. Hit-test radii (for example 12 px) are CSS pixels.

### Python pipeline
The pipeline's only world-space math is the minimap bounds check in `validate.py`. It works in normalized minimap fractions (`minimap_fraction_x`, `minimap_fraction_y`, each 0 to 1) and never produces pixels. Pixel mapping lives only in the web `domain/coordinates.ts`. Python code must not compute pixel positions. If it ever needs to, it gets typed `WorldPoint` and `PixelPoint` values and one mapping function.

### Heatmap cells
Heatmap cells are computed in world units (at most 4 world units per cell), and only converted for drawing. Never size a cell in pixels.

The heatmap is drawn as a **cell raster** (2026-11-01): a small image built by `render/drawHeatmap.ts` with one texel per heat-grid cell, addressed by (column, row). A texel is not an image pixel (`PixelPoint`) or a canvas point (`CanvasPoint`), so filling the raster is cell indexing, not a fourth coordinate space. That includes the row flip: grid rows grow with `worldZ`, raster rows grow downward. Only the grid's world-space corners cross into canvas space, through `MapView.worldToCanvasPoint`, and the browser scales the raster between them.

## Checking

For each point, position or size, check:
- Is it typed `WorldPoint`, `PixelPoint` or `CanvasPoint`?
- Does a value from one space reach a parameter of another space, anywhere other than the named crossing functions?
- Are `imageWidthPixels` and `imageHeightPixels` used separately?
- Is edge handling inclusive (u or v exactly 0 or 1 is valid)?
- Are canvas points recomputed after every pan or zoom, rather than cached? Is a `worldToCanvasConverter()` result used only within the redraw that created it?
