# Conventions

## Naming

Names say what a value is and what unit or coordinate space it is in. No abbreviations beyond `id`, `url`, `api`, `ui`, `dto`, and `i`/`j`/`k` loop counters. See `enforcement/naming-and-units.md`.

| Concept | TypeScript | Python |
|---|---|---|
| Epoch time | `timestampSeconds` | `timestamp_seconds` |
| Time into match | `elapsedSeconds` | `elapsed_seconds` |
| World position | `worldX`, `worldZ` | `world_x`, `world_z` |
| Image position | `pixelX`, `pixelY` | `pixel_x`, `pixel_y` |

Booleans read as questions (`isBot`, `hasDied`). Collections name their contents (`killEventsByMatchId`).

## Pure logic lives in `domain/`

All computation (coordinates, filters, event derivation, heatmaps, traffic, area summary, playback) is pure functions in `web/src/domain/`. No DOM, fetch or Leaflet there. Layers are one-way: `domain <- data <- render <- ui`. See `enforcement/layer-direction.md`. The Python build step is the only copy of the cleaning rules.

## Fail loudly

Missing or bad data throws, or exits non-zero, with a plain-language message naming the file and the problem. Never silently fall back, never default a required value.

TypeScript:

```ts
const config = mapConfigsByName.get(mapName);
if (config === undefined) {
  throw new Error(`Map "${mapName}" has no entry in maps.json`);
}
```

Python:

```python
config = map_configs_by_name.get(map_name)
if config is None:
    raise DataContractError(f"{file_path}: map '{map_name}' has no entry in maps.json")
```

Use `noUncheckedIndexedAccess` results the same way: check for `undefined` and throw, never `!`.

## Other rules

- Full precision: no rounding coordinates, no thinning trails, no sampling instead of counting.
- `ts` is epoch seconds. Never divide by 1000.
- No source file over 300 lines (TS and Python).
- TypeScript `strict`, `noUncheckedIndexedAccess`, no `any`, no `!`.
- Bug fixes stay minimal.

## User-facing wording

Approved by the user on 2026-11-01, with additions on 2026-11-02. Name the subject and direction of combat events explicitly. Distinguish recorded tracks and events from actual population, item counts or confirmed survival. Marker labels live in `config/event_types.json` and heatmap names and descriptions in `ui/heatmapChoices.ts`. Never rename raw event codes or marker keys to change display text.

- **Markers:** "Player killed a player", "Player killed a bot", "Player killed by a player", "Player killed by a bot", "Player died to storm", "Player looted". Bot markers: "Bot made a kill (victim not recorded)" and "Bot died (killer not recorded)".
- **Legends** explain: "Kill markers show the killer's position. Death markers show where the actor died." Marker centres map telemetry coordinates; symbol sizes are fixed screen pixels. Replay interpolates positions between recorded rows.
- **Loot:** summary counts say "Loot events", meaning recorded events, not a known number of items or containers.
- **Heatmap choices:** Off, Kill zones (on when the app opens), Combat death zones, Storm death zones, Traffic. Descriptions: "Where players stood when they made a kill", "Where players were killed by a player or a bot", "Where players died to the storm", "Where players spent the most time". The colour scale's title gives the sample size (see `domain.md`). The scale's outlined end needs no caption (2026-11-02). Only the chosen heatmap's description is on screen (2026-11-02); every radio keeps its description as its accessible description.
- **Bots:** match labels show players and "recorded bot tracks", with singular/plural agreement. Zero recorded bot tracks doesn't mean zero bots existed. Replay says "No bot tracks were recorded. Player events involving bots are still shown." The actor heading is "Players and bots". "Hide bot tracks and bot events" has the explanation "Player events involving bots remain visible."; it hides bot tracks and bot-performed events only.
- **Marker details** say "Time into match" and name the other party as "Victim" for kills or "Killer" for combat deaths. Unknown identities stay "not recorded"; loot and storm deaths have no other-party field. Summaries say "Death recorded so far: yes/no", never implying confirmed survival. Several markers at one spot list one folded row per event, its summary "<marker label> · <m:ss>"; an opened row doesn't repeat the time (2026-11-02).
- **Timeline ticks** (2026-11-02): each tick's accessible name is "<marker label> at <m:ss>". On hover and on keyboard focus it shows a tooltip of two lines, the marker label and "Time into match: <m:ss>" (hidden from screen readers, which hear the name). The tooltip is centred on the tick when it fits in the timeline, otherwise lined up with the tick's edge, so it stays on screen on a phone; Escape hides it until the pointer or focus leaves the tick. The tick is a 24 × 24 px target around its unchanged 6 × 14 px mark; bot-performed ticks keep the dashed outline.
- **Match pickers** (2026-11-02): a full match label reads "<Mon D> · <HH:MM> UTC · <m>m <s>s · N players, N recorded bot tracks" (singular for 1). The "N matches" list and Replay's Match picker group matches under a heading for each UTC start day ("Feb 9", the same start day the Dates filter uses), in time order. Rows under a heading drop the repeated day: "23:58 UTC · 12m 24s · 1 player, 0 recorded bot tracks". The checkbox list's day groups are named groups for screen readers; Replay's picker uses one `<optgroup>` per day. Replay's field always shows the chosen match's full label (wrapped onto another line when it doesn't fit, as on a phone, never cut off), which is also the select's accessible description. With forced colours (for example Windows high contrast) the field shows the plain select alone, in system colours.
- **Dates and areas:** the date filter says "Dates (UTC)". Area summaries say "Player paths crossed this area in N matches" ("1 match"); only player paths count, not bots or individual players. The area's count per marker type shows as that type's legend swatch and its number, zeros included, as a list (2026-11-02); screen readers hear each as its full marker label and count, for example "Player looted: 3".
- **Replay a match here** (2026-11-02): each match row reads "<Mon D> · <HH:MM> UTC · N events" ("1 event"), and a long list ends with "Show all N matches". Under that line, a row with events shows each marker type's legend swatch and its count. Screen readers hear each swatch as its full marker label and count, for example "Player killed a bot: 3".
- **World-position readout** (2026-11-02): a box over the map, captioned "World units", shows "X <value>  Z <value>" to one decimal place. With a mouse it follows the pointer and says "Press C to copy" (no button; over the box itself the values show "—"). On touch screens a crosshair marks the map's centre and the box has a "Copy" button. Off the minimap, each value is "—". Copying gives "X, Z" as shown, then "Copied" or "Copy failed: <reason>". Only X and Z: elevation isn't in the app's data. Desktop: bottom-left of the map; phone: top-right, clear of the bottom sheet. On a phone the box is compact: the caption over the values, with Copy beside both at the box's full height (at least 44 × 32 px).
- **Phone controls** (2026-11-02): on touch screens the Area hint reads "Press Select area, then drag on the map to see what happened in an area."; with a mouse it reads "Shift-drag on the map, or press Select area and drag, to see what happened in an area." The Dates and matches dropdowns close on a press outside or on Escape (focus returns to the button), and only one is open at a time. The map picker comes first in the top bar, before the Overview/Replay switch (2026-11-02). On a phone the top bar wraps onto rows: the map and the mode switch, then Dates and matches, then (in Replay) the chosen match. An open list sits under the whole top bar, above the world-position box and crosshair.
- **Panel area** (2026-11-02): with a mouse, a legend row's "Only" button shows on row hover and while keyboard focus is anywhere in the row (it stays in the tab order); on touch screens it always shows. Replay's "Trail heads" key starts folded under its "Trail heads" summary. When a drag draws an area, the panel scrolls to the area's result. On a phone, turning Select area on closes the bottom sheet, the drag's end opens it on the result, and a Replay marker tap opens it on the details, with the map moved if needed so the marker sits above the sheet (instantly when the reader prefers reduced motion). The sheet only opens or closes on those actions and its handle.
