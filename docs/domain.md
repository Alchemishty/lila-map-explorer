# Domain: data facts the build must respect

These were verified against the raw data. The evidence and reasoning behind each one is in `DATA_QUALITY.md` at the project root.

## Format

- Files are Parquet with no extension, in day folders. One file is one actor in one match.
- `event` is stored as bytes. Decode to UTF-8.
- `ts` is typed `timestamp[ms]` but holds **epoch seconds** (wall-clock UTC). The README is wrong on both the unit and the meaning. Time into match = `ts` minus the match's first `ts`.
- `y` is elevation. 2D plotting uses `x` and `z`.

## Minimap mapping

- `u = (x - origin_x) / scale`, `v = (z - origin_z) / scale`.
- `pixel_x = u * image_width`, `pixel_y = (1 - v) * image_height`.
- The README says the images are 1024 px. They are actually 4320x4320, 2160x2158 (GrandRift, not square) and 9000x9000 px. Always use the real image size.
- Scale and origin per map:

  | Map | Scale | Origin X | Origin Z |
  |---|---|---|---|
  | AmbroseValley | 900 | -370 | -473 |
  | GrandRift | 581 | -290 | -290 |
  | Lockdown | 1000 | -500 | -500 |

## Players and bots

- Classify by each file's position event, not by ID format. `Position` = player, `BotPosition` = bot. No file mixes them.
- 17 files have numeric (bot-style) IDs but are players (`actor_type = human_misid`). They count as players and each gets its own `player_key`.

## Cleaning rules

- One file appears in two day folders with identical contents. Drop the second copy.
- Three files contain their whole session twice, with timestamps jumping back. Drop the second half.
- Exact repeated `BotKilled` rows: drop the extras, because a player dies once. There are currently none after the step above.
- Exact repeated `BotKill` rows (30): keep, flagged as possible multi-kills.
- Exact repeated `Loot` rows (1,197): keep, as several items taken in the same second.
- Sort rows by time within each file.

## Dates

- Use the UTC date of the match start for date filtering. Day folders differ from it for 10 files near midnight.
- One match starts on Feb 9 at 23:58 UTC. Keep it and show it. The match pickers' day headings use the same start day, so it is listed under Feb 9 (`groupMatchesByStartDay` in `domain/filters.ts`).

## Events

- Player-file `BotKill` and `Kill` = a kill by the player.
- Player-file `BotKilled` and `Killed` = the player's death.
- `KilledByStorm` = storm death.
- `Loot` = loot.
- The 3 `Kill` and 3 `Killed` rows are odd: each pair is in one file at the same second. Show them as recorded.
- Bot-file `BotKill` and `BotKilled` mean "this bot killed someone" and "this bot died". **The other party is not recorded.** Some are bot-vs-bot, and many bot deaths have no matching killer anywhere.
  - They **are** displayed, as bot events, and the tool never guesses the other party.
  - They are **not** mixed into the kill and death heatmaps, which stay player-side, because their meaning is unconfirmed and they exist in only 52 matches.
- Bot files exist in only 52 of 796 matches.

## Other

- Position is logged about every 5 s while moving, and less often when standing still.
- 1-2 position samples can follow a death, at the death spot.
- 355 player files end with no death, probably extractions, but there is no extract event.

## Multiplayer

Player-vs-player is a first-class case even though today's data has almost none (794 of 796 matches have one player file; 3 `Kill` and 3 `Killed` rows). Nothing may assume one player per match.

## How the numbers are computed

- **Kill, combat-death and storm-death heatmaps and markers:** count the events in each cell.
  - Kills = player-side `Kill` + `BotKill`.
  - Combat deaths = player-side `Killed` + `BotKilled`.
  - Storm deaths = `KilledByStorm`.
  - Combat deaths never include storm deaths. Bot-side events never enter heatmaps.
- **Time-weighted traffic:**
  - A player's waypoints are their position samples plus the `Loot`, `Kill` and `BotKill` rows recorded between their first and last position sample, in recorded order. This is the same path the Replay trail draws (user decision, 2026-11-02): each of those rows records where the player was. Loot and kill rows before the first or after the last position sample (row order, so same-second ties too) add no time.
  - Each interval between two consecutive waypoints is credited as time.
  - The time is spread evenly along the straight line between the two waypoints, across the cells it crosses. The exact route between waypoints is unknown.
  - Long gaps are not capped. Logging slows when a player stands still, so long gaps are idle time spent near one spot. (Verified: the longest gaps move about 8 units.)
  - Rows after the player's death are ignored.
  - A file's last sample adds no time, with one exception (user decision, 2026-11-02): when the player's first death comes later and records exactly the last sample's world X and Z, the player stood still until they died, so the gap until the death counts in that cell. A death anywhere else, a death in the same second and a session with no death add nothing after the last sample. With no position sample there is no spot to extend.
- **"Passing through" an area:** a match passes through if any player trail segment between two samples crosses the area, not only if a sample lands inside it.
- Heatmap cells are at most 4 world units.

## How heatmaps are drawn

Heatmaps show where things cluster. Markers show the exact spots.

- The exact grid above is never changed. It holds every count at 4 world units per cell, and the colour scale's total and the area inspector read from it.
- For drawing only, a copy is blurred with a Gaussian of standard deviation:
  - 12 world units for kill zones, combat death zones and storm death zones
  - 8 world units for traffic

  The kernel is normalized and truncated at 3 standard deviations, and cells beyond the grid count as zero. The spread is tied to the map, not the screen.
- The colour ramp is sequential: pale and clear, through orange and red, to dark red at the top value. Darker means more.
- The top value is the busiest smoothed cell in the current selection, with one floor (user decision, 2026-11-02). On the kill, combat death and storm death heatmaps, the top is never below the smoothed peak of 5 events in one cell. So with few events a lone event shows at a fifth of the top (pale), not dark red. Dark red needs about 5 events stacked. Traffic has no floor. The logic is `domain/heatmapColorTop.ts`.
- When the floor is in force, a note under the colour scale says "Few events here, so dark red is kept for 5 or more in one spot."
- Smoothed values below 4% of the top value are not drawn, so quiet ground stays clear.
- **Busiest zones are outlined** (user decision, 2026-11-02), because the darkest red is the hardest part to see on the dark minimaps. A busiest zone is every place where the smoothed value is at least 0.65 of the top value, which is where the ramp turns red and runs to dark red. The outline traces exactly that level on the smoothed grid (marching squares over cell centres, with cells beyond the grid counting as zero, so a zone at the edge still closes). It is a white line on a dark halo, drawn over the markers so switched-on markers never hide it. With the 5-event floor in force, no zone may reach 0.65 of the top, and then nothing is outlined. An empty Traffic grid has no outline. The logic is `domain/heatmapContour.ts`, and the share is `heatmapBusiestZoneFraction` in `render/heatRamp.ts`.
- The colour scale outlines the same part of its bar (from the red stop to the end), above its "busiest zone" label. It has no caption (user decision, 2026-11-02): the outlined end and that label already explain the outline.
- **Markers over a heatmap** (user decision, 2026-11-02): while any heatmap is on, the markers that are switched on draw smaller (4 px radius instead of 7) and at 60% opacity, so the heatmap reads first. Marker centres stay exact; only the drawing changes. With the heatmap Off, markers draw at full size.
- **Opening view** (user decision, 2026-11-02): Overview opens on Kill zones with every marker type off, player and bot. Area counts are unaffected: they count every player event whatever the switches, and bot events only while their switch is on.
- Heatmap names follow what the data records:
  - **Kill zones:** where the killer stood
  - **Combat death zones** and **Storm death zones:** where the player died
  - **Traffic:** where players spent the most time
- The colour scale's title gives the sample size, for example "Storm death zones · 17 storm deaths" or "Traffic · 412 h 5 min of play". A dark zone built from a handful of events is then visible as such.

## Event categories and markers

Player trail heads are round and bot trail heads are square. For player combat-event markers, round/square identifies the other party: player/bot. Bot-performed events use dashed-outline squares. Color gives the event type. Shapes as well as colors tell markers apart. The marker mapping lives in `config/event_types.json`, not in code.

| Marker | Meaning |
|---|---|
| Red circle with a white cross | Player killed a player (`Kill`) |
| Red square with a white cross | Player killed a bot (`BotKill`) |
| Dark circle with a red cross | Player killed by a player (`Killed`) |
| Dark square with a red cross | Player killed by a bot (`BotKilled`) |
| Purple triangle | Player died to storm |
| Yellow diamond | Player looted |

Storm deaths and loot only ever involve the player, so they keep their own shapes.

Loot markers draw beneath every other marker (user decision, 2026-11-02), because loot is the most numerous event and would otherwise cover kills and deaths. The order within loot and within the rest is kept. The logic is `orderLootFirst` in `domain/events.ts`.

## Trail head states in Replay

User decision, 2026-11-02 (`DATA_QUALITY.md` finding 14). We only know where an actor was at its recorded rows. So each Replay head shows which of four cases it is in, never just "standing here":

| State | When | Drawn as |
|---|---|---|
| Moving | Between two rows at different positions, however slowly | Filled head (today's head) |
| Waiting (alive) | Between two rows at exactly the same world X and Z. The later row proves the actor was alive. | Filled head inside a ring |
| Dead here | At or after the actor's first recorded death, including rows after it | A cross in the actor's color, no fill |
| Last seen here | After the actor's final row, with no recorded death | Hollow dashed outline |

Death means a player-side `combat_death` or `storm_death` row, or a bot-side `bot_death` row. Round and square still mean player and bot. Replay's legend has a "Trail heads" key, and the followed actor's summary starts with "Now: <state>" ("Now: Not recorded yet" before its first row). The logic is `domain/trailHeadState.ts`.

Two bot-event markers, taken from bot files. They use a square (a bot did this) with a **grey dashed outline**, matching bot trails:

| Marker | Meaning |
|---|---|
| Red square, dashed grey outline | Bot made a kill. Victim not recorded. |
| Dark square, dashed grey outline | Bot died. Killer not recorded. |

The general rule: any event performed by a bot gets the dashed grey outline.

Colors: kill `#ef4444`, death fill `#111111` with a red cross, storm `#a855f7`, loot `#facc15`, bot trail `#cbd5e1` dashed. Player trail palette in order: `#22d3ee`, `#f472b6`, `#a3e635`, `#fb923c`, `#818cf8`, `#2dd4bf`. Bots stay dashed grey with a square head; players get a solid line with a round head.
