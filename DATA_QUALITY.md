# Data quality: findings and decisions

LILA Map Explorer is only useful if what it draws is true. We checked every exported match file before building the tool. This document explains the errors we found, what remains uncertain and how the app handles each case.

The export holds **1,243 Parquet files** and **89,104 raw rows** from the February 10–14, 2026 folders. After cleaning there are **88,826 rows**, **796 matches**, **798 player sessions** and **444 bot sessions**.

Three principles run through every decision below:

- **The raw files are never changed.** Cleaning happens in the build step. Added labels, such as player/bot type and possible repeats, stay separate from the original values so we can trace them back to the source.
- **A strange record is not proof of a logging bug.** Some records look odd and have a normal explanation. Others look normal and may be wrong. We cannot detect every plausible error without participant IDs, event IDs, damage history or the recording code. When the evidence is unclear, we keep the rows and explain the uncertainty.
- **Bad input stops the build.** A file that breaks the required data format or consistency rules stops the build with a message naming the file and the problem. Nothing is skipped silently.

## Summary

| # | Finding | Decision | Effect in the app |
|---|---|---|---|
| 1 | The dataset README is wrong about timestamps, image sizes and bot IDs | Follow the data, not the README | Correct units, scale and classification |
| 2 | 17 player sessions carry bot-style IDs | Use recorded event types; give each session its own key | Counted as players |
| 3 | One file appears in two day folders | Drop the second copy | 88 rows removed |
| 4 | Three files record their session twice | Drop the second half | 190 rows removed |
| 5 | Folder dates don't always match the match date | Date each match by its first row (UTC) | Matches near midnight stay whole |
| 6 | Every player-vs-player kill is a same-second kill/death pair in one file | Unresolved; shown as recorded | None |
| 7 | Two kills are logged after the player died | Kept at their recorded times | None |
| 8 | Positions drift slightly after death | Kept; too small to matter | None |
| 9 | Long gaps between position samples | Straight-line approximation; standing still before a death counts | Traffic counts that wait |
| 10 | One second can hold several positions | Keep recorded order | None |
| 11 | Some movement is very fast | Treated as traversal, not teleports | None |
| 12 | Some event positions are far from position samples | Loot and kill rows become Traffic waypoints | Traffic follows the Replay trail |
| 13 | Repeated actions in the same second | Keep and count every row | Repeated `BotKill` rows flagged |
| 14 | Tracks are incomplete and end early | Never infer what wasn't recorded | Replay shows each actor's state |

Items 1–5 are recording errors that the build fixes. Items 6–14 remain uncertain. We keep the data and limit what the app claims.

## Errors the build fixes

### 1. The dataset README is wrong in places

| README says | The data shows | What we do |
|---|---|---|
| `ts` is a millisecond timestamp | The column is typed `timestamp[ms]`, but the values are **epoch seconds** of wall-clock UTC time. Read as milliseconds, every match lands in January 1970. | Read `ts` as seconds. Time into a match is `ts` minus the match's first `ts`. |
| Minimap images are 1024 px | The images are larger, and GrandRift's isn't square. | Use each image's real width and height; [ARCHITECTURE.md](ARCHITECTURE.md) covers the mapping and the sizes. |
| Numeric user IDs are bots | 17 numeric-ID files are player sessions (finding 2). | Classify by the events a file contains. |

Two other format details: event names are stored as bytes and must be read as text. The `y` coordinate is height, so the map uses `x` and `z`.

### 2. Some player sessions are logged under bot-style IDs

According to the README, players have UUIDs, bots have numeric IDs, and bots emit only `BotPosition`. But **17 files with numeric IDs emit `Position`**, the player event. Together they hold 636 position rows, 115 loot events and 14 kill events, about 765 of 89,104 rows (0.9%).

| User ID | Player-path files | Bot-path files |
|---|---:|---:|
| `1429` | 14 | 3 |
| `1379` | 2 | 0 |
| `1402` | 1 | 0 |

The error could be in the event types or the ID. The evidence points to the ID. Here, "player path" and "bot path" mean the events the game records for each type:

1. **Each file follows exactly one logging path.** No file mixes `Position` with `BotPosition`, and no UUID file has bot events.
2. **These files emit the full set of player-path events:** `Position`, `Loot` and `BotKill`. A bot slot doesn't produce those, so the game treated these sessions as players.
3. **Looting supports this.** The 444 real bot files contain zero `Loot` events, yet the 17 odd files hold 115. Either bots don't loot or bot looting isn't logged. Either way, a loot event marks a player-path session.
4. **Position timing looks like other player files.** The typical spread in the time between updates is 3.3 s for these files, 3.5 s for player files and 1.0 s for bot files. These are medians across files with at least 3 position samples. The timing tells us how the game recorded the session, not who was playing.

| File type | Files | Gap spread (s) | Loot per file |
|---|---:|---:|---:|
| Real bots | 444 | 1.0 | 0 |
| Players (UUID) | 777 | 3.5 | 14 |
| Numeric ID, player events | 16 | 3.3 | 4.5 |

The player row covers 777 of the 782 UUID player files, because files with fewer than 3 position samples are left out. One of the 17 odd files has only 2 samples, so that row shows 16.

**Established:** these 17 sessions ran on the player path. 16 of their 17 matches have no UUID player, so the numeric-ID file is the only player in the match. `1429` never appears as a bot and a player in the same match.

**Not established:** why the IDs are numeric. Only `1429` is ever used as a bot (3 bot-path files). `1379` and `1402` never appear as bots, so they may simply be numeric-ID players. The 14 player sessions under `1429` may belong to several different people.

**Decision:**

- Every file is classified by its position event (`Position` = player, `BotPosition` = bot), never by ID format. A file that mixes the two, or a UUID file with bot events, stops the build.
- Raw `user_id` values are kept.
- Each file gets an `actor_type`: `human`, `bot`, or `human_misid` (player events under a numeric ID).
- Each file also gets a `player_key`. UUID players keep their UUID, bots keep their ID, and each misidentified session gets its own key, such as `misid-1429-3731eba6`, so the 14 `1429` sessions are never merged into one fake player.

The labels are derived from the data, so a new drop needs no hand-kept list.

**Effect on counts:** player files go from 782 to 799 and bot files from 461 to 444. One player file is a duplicate (finding 3), so there are 798 unique player sessions. The README's "339 unique players" counts every distinct `user_id`: 245 UUIDs, 92 bot IDs (including `1429`) and 2 numeric IDs that are never bots. Under our labels, that is 245 UUID players, 92 bot IDs and 17 player sessions with their own keys.

### 3. One file appears in two day folders

`cfa03e9f…_ac049b28…` is in both `February_10` and `February_11`, with 88 identical rows in each. Both copies span 23:51:05–23:56:37 UTC on Feb 10, so this is one session written twice, not a repeat match on another day. The match started just before midnight. Its six bot files are only in `February_11`. We don't know whether the logger or the export made the copy.

**Decision:** keep the `February_10` copy and drop the second. That leaves 1,242 unique files and 89,016 unique rows. Without this step, per-day match counts would add to 797 instead of 796, because the match would sit on two days.

### 4. Three files record their whole session twice

In three files the rows run through the session, then the timestamps jump back to the start and every row repeats:

| File | Repeated rows |
|---|---:|
| `94d042cb…_d3a3297e…` | 147 |
| `db454a35…_fc797a67…` | 39 |
| `688cb2e4…_0954f788…` | 4 |

These are the only timestamp reversals in the raw data. The 190 repeated rows include every repeated `Position` row and both repeated `BotKilled` rows.

**Decision:** drop the second half of each file. Each player now has at most one death: 401 player files end in `BotKilled` (including one misidentified session) and 39 end in `KilledByStorm`.

### 5. Folder dates don't always match the match date

**11 raw files** sit in a day folder that differs from the UTC date of their first row. One of them is the duplicate from finding 3, which leaves **10 unique sessions**. Matches near midnight can have actors in two folders. One match starts on Feb 9 at 23:58 UTC.

**Decision:** a match's start is its earliest timestamp across all its actors. The whole match belongs to that UTC date, including any rows after midnight, so Replay always sees the complete match. Date filters are labelled UTC.

## Uncertain records we keep

The linked tables were generated before the Traffic changes in findings 9 and 12. Their Traffic figures are the baseline from before those changes. They list 395 sessions with 3,728 seconds after the last position sample that were not counted. Only some of those sessions meet the standing-still rule in finding 9.

### 6. Every player-vs-player kill is a same-second pair in one file

The dataset has three `Kill` rows. Each is followed at once by a `Killed` row in the **same player's file**, at the same second and the same X, Y and Z:

| Map | UTC time | Match | Actor | Source rows | World X, Z |
|---|---|---|---|---|---|
| GrandRift | 2026-02-10 09:40:19 | `711c9a67` | `7778267b` | 87–88 | −51.422958, 78.901642 |
| AmbroseValley | 2026-02-10 12:41:33 | `042774ea` | `b2365f20` | 98–99 | −69.368614, 21.968119 |
| AmbroseValley | 2026-02-11 07:12:21 | `c4a250c9` | `00f02e70` | 142–143 | 15.364095, 103.863876 |

On its own, a shared position is normal: if you kill someone and die in the same second, both events record your position. Here is what makes these pairs odd:

- **One file reports both events.** Each of these matches has only one recorded player, so there are no separate killer and victim files to confirm what happened.
- **The real two-player matches have no PvP.** The only matches with two player tracks (`a71c3aa8…` and `fbbc5d02…`) contain no `Kill` or `Killed` rows.
- **Nothing nearby backs them up.** None of the three matches has a bot track. In each, the nearest other combat is an earlier `BotKill`, 97–157 seconds before.

The player might have killed an opponent and died at the same time (a trade), or killed themselves with an explosion. The game might also have recorded one death twice or put the victim's event in the killer's file. The export can't tell these apart, and there is no weapon or damage-source field. One recorded player doesn't prove only one person was in the match either.

**Decision:** "Simultaneous kill/death records; possible explosive self-kill or trade, with logging error still unresolved." Both rows stay at their exact positions. They count as player kills and combat deaths in markers, heatmaps and area counts. The pairs are not treated as confirmed PvP, confirmed suicide or a confirmed logging error. Reclassifying them needs the game team (see [Open questions](#open-questions-for-the-game-team)).

Evidence: [`same_second_combat.csv`](docs/data-findings/telemetry-audit-evidence/same_second_combat.csv). It also lists two same-second `BotKill`/`BotKilled` pairs, which show that same-second trades also happen outside PvP.

### 7. Two kills are logged after the player died

| Source file | Map | Death (epoch s) | Kill (epoch s) | Delay |
|---|---|---:|---:|---:|
| `February_10/5a225352…_b5ed9b5b….nakama-0` | Lockdown | 1770698965 | 1770698968 | 3 s |
| `February_14/6539f536…_de7378ae….nakama-0` | AmbroseValley | 1771081295 | 1771081300 | 5 s |

Both kills are within 0.2 world units of the death. Delayed projectiles, damage over time or late logging could each explain them. We cannot tell whether the timestamp marks when the event happened or when the game recorded it.

**Decision:** keep and count both kills at their recorded times. Moving or deleting them would invent evidence. We don't assume the player survived or respawned. These two events affect counts at the death spot; they do not show a player moving after death.

### 8. Positions drift slightly after death

**173 `Position` rows in 172 player sessions** arrive 1–6 seconds after the player's death. 113 of them are not exactly at the death spot, but the largest drift is **1.65 world units**. No loot or bot rows come after a death, and no actor dies twice. Leftover movement or update timing would explain the drift, but the cause is unconfirmed.

**Decision:** keep the rows. Traffic ignores everything after a death. Replay trails and area crossings use every row, so a very small selected area could count as crossed because of one step after death. That doesn't mean the player survived. A drift under 2 units doesn't matter at level-design scale, but it isn't a guaranteed limit for future data.

Evidence: [`post_death_rows.csv`](docs/data-findings/telemetry-audit-evidence/post_death_rows.csv).

### 9. Long gaps between position samples

Positions are logged about every 5 seconds while a player moves, and less often while they stand still. There are **261 player gaps over 30 seconds** across 203 sessions, adding up to 13,196 seconds, and 51 such bot gaps. The 30 seconds is just where we started looking, not a rule about valid gameplay.

- Longest player gap: 302 s, with its ends 8.05 units apart.
- Longest bot gap: 518 s, with its ends 7.67 units apart.
- Among player gaps over 30 s, the ends are at most 32.83 units apart.

Ends that are close together suggest waiting, but they don't prove it. A round trip or missed samples would look the same.

**Decision:** a missing update is assumed to mean the player stood still. This is a working assumption, not something the logger guarantees. Traffic spreads a gap's time evenly along the straight line between its two samples. If both ends are at the same spot, all the time goes there. Replay moves the actor along the same line. Gaps are not capped.

**Standing still before death.** Traffic originally counted time only *between* samples, so it dropped the wait before a death. In one clear case, player `f3cf6ebd…` logged a last position, then died to the storm 454 seconds later at exactly the same spot, and those 454 seconds counted for nothing. Now, when a player's first death comes after their last position sample and has exactly that sample's world X and Z, the gap until the death counts at that spot. This applies to combat and storm deaths. It adds **1,275 seconds across 43 player sessions**. A death elsewhere, a death in the same second, or a session with no death adds nothing after the last sample.

Evidence: [`long_position_gaps.csv`](docs/data-findings/telemetry-audit-evidence/long_position_gaps.csv).

### 10. One second can hold several positions

**802 actor-seconds** (one second of records for one player or bot) contain more than one X/Z position: 759 for players (383 sessions) and 43 for bots (41 sessions). The widest spread within one second is 5.69 world units for players and 3.91 for bots. Usually this is a position sample plus one or more actions that happened at different moments and were rounded to the same second. After cleaning, no actor has two position samples in the same second.

**Decision:** keep every event's recorded position and the original row order within each second. Replay can't recover movement or cause and effect inside a second. Markers stack only at exactly matching coordinates. Merging them by time window would hide real differences in position. We don't know the game's speed limits, so a 5-unit jump inside one second isn't treated as impossible movement.

Evidence: [`same_second_different_positions.csv`](docs/data-findings/telemetry-audit-evidence/same_second_different_positions.csv).

### 11. Some movement is very fast

**73 player segments in 66 sessions** move faster than 8 world units per second: 69 on AmbroseValley, 3 on GrandRift and 1 on Lockdown. The fastest covers 63.26 units in 5 seconds (12.65 units per second), and all 21 segments above 10 units per second are on AmbroseValley. Several fast segments repeat in the same places, such as around X ≈ −203, Z ≈ −290 to −240, which looks like ziplines or another traversal mechanic. The export has no movement-mode field and no known top speed.

**Decision:** treat fast segments as traversal (ziplines, vehicles, launch pads) or server position corrections, not teleports or logging errors. Replay and Traffic draw them as straight lines like any other segment. This is an analysis assumption, not a confirmed mechanic.

Evidence: [`fast_position_segments.csv`](docs/data-findings/telemetry-audit-evidence/fast_position_segments.csv).

### 12. Some event positions are far from the position samples

Each loot or kill row records where the player was at that moment. In **41** events the nearest position sample in time is more than 30 seconds away. In another **47** the event is more than 20 world units from its nearest sample in time, which makes 88 in total. That far-away set is 44 loot rows and 3 `BotKill` rows. The furthest is a `BotKill` 63.25 units and 8 seconds from its nearest sample, in a match that also contains a fast AmbroseValley segment.

**Decision:** the working explanation is that the player was moving or traversing while looting or fighting. Event coordinates are never snapped onto a nearby sample, and a kill's coordinates are never treated as the victim's position. Traffic now uses a player's position samples *plus* the loot and kill rows between their first and last position sample, in recorded order. This is the same path the Replay trail draws, so a loot or kill marker no longer sits off the Traffic route. The lines between points are still estimates.

Evidence: [`event_position_leads.csv`](docs/data-findings/telemetry-audit-evidence/event_position_leads.csv).

### 13. Repeated actions in the same second

After cleaning, some events repeat with identical time and position:

| Event | Repeated groups | Rows in those groups | Extra copies | Sessions |
|---|---:|---:|---:|---:|
| `BotKill` | 27 | 57 | 30 | 24 |
| `Loot` | 1,065 | 2,262 | 1,197 | 441 |

That is 9.3% of all `Loot` rows and 1.3% of all `BotKill` rows. Timestamps have one-second resolution, and rows carry no item, victim or event IDs. A kill row stores the killer's position (a median 1.4 units from their nearest position sample), not the victim's, so one explosion killing several bots would produce identical rows. So would taking several items from one container. Recording the same action twice would look the same. One clue favours real actions: once the doubled files are removed, events recorded once at a time, such as `Position` and `BotKilled` never repeat. Only events that can happen several times in one tick do.

**Decision:** keep and count every row, because collapsing them would undercount real kills of several opponents and pickups of several items. Each extra `BotKill` copy is flagged as a possible multi-kill. Counts are described as "recorded events", never as a number of items or containers.

For reference, there are **2,236 player-side `BotKill` rows**, or 2,206 without the 30 flagged copies. The often-quoted 2,406 includes 170 bot-side rows.

Evidence: [`repeated_event_groups.csv`](docs/data-findings/telemetry-audit-evidence/repeated_event_groups.csv) lists every member of every group (2,319 rows), not just the extra copies.

### 14. Tracks are incomplete and end early

- **794 of 796 matches have only one recorded player.** That doesn't mean the match was solo or that you are seeing the whole fight. Nothing in the app assumes one player per match.
- **Only 52 matches have bot tracks**, so 95% of player `BotKill` rows have no bot-side counterpart at all. The bot tracks hold 170 bot-side kills and 296 bot-side deaths, and none names the other party. Bot-side counts don't mirror player-side ones: in those matches there are 170 bot `BotKill` rows but only 21 player `BotKilled` rows. One match shows a bot killing another bot, and 11 of its 14 bot deaths have no recorded killer. Pairing these events by time or position isn't safe.
- **355 player sessions and 148 bot sessions end with no death.** Extraction, disconnect, logging cutoff and survival all look the same, and there is no extraction event.
- **398 tracks end before their match's last row:** 355 bot tracks and 43 player tracks. Of those, 286 bots and 18 players have a recorded death. The longest gap to the match's end is 733 seconds for a dead bot and 403 seconds for a player.

**Decision:**

- Bot-side events are drawn as bot events with a dashed grey outline. They never enter the kill and death heatmaps, which stay player-side, and the app never guesses the other party.
- A match with no bot tracks is labelled with "recorded bot tracks", never as having no bots.
- A session without a death is never called an extraction or survival.
- Match length runs from the first exported row to the last.
- In Replay, each actor's marker shows what the data supports at that moment:

| State | When |
|---|---|
| Moving | Between two rows at different positions |
| Waiting | Between two rows at exactly the same world X and Z; the later row proves the actor was alive |
| Dead here | At or after the actor's recorded death |
| Last seen here | After the actor's final row, with no recorded death |

A track that has ended never looks like a live actor.

## Checks that came back clean

- **Map placement.** Every X, Y and Z value is finite, no required field is null, and every X/Z point lies inside its map's bounds. Being in bounds doesn't prove the map calibration is right.
- **Consistency.** No file mixes player and bot positions. There are no unknown event codes, no conflicts between file names and contents, no match assigned to two maps, no zero-length matches and no overlapping sessions for the same UUID player.
- **Export round trip.** For all 88,826 rows across 1,242 actors, the generated files match the cleaned source exactly: event codes, timestamps, repeat flags and coordinates. Source coordinates use 32-bit floating-point numbers, so this export loses no precision. Future input using 64-bit numbers would lose precision when converted to 32-bit numbers.

## Open questions for the game team

1. **PvP pairs (finding 6).** What do the six `Kill`/`Killed` rows mean? We need actor, killer and victim IDs, and the code paths that write both events.
2. **Numeric IDs (finding 2).** How are numeric IDs allocated, and can a player session receive one?
3. **Bot events (finding 14).** In a bot's own file, do `BotKill` and `BotKilled` include bot-vs-bot kills, and do storm deaths appear as plain `BotKilled`? Why do only 52 of 796 matches have bot files? Can the logger write a death event twice?
4. **Missing players (finding 14).** The README describes multiplayer matches, but 794 of 796 matches have one player file. Were other players' files left out of the export? Without them, player-vs-player analysis and full match timelines aren't possible.
5. **Outcomes (finding 14).** Is there an extraction event that wasn't exported?
6. **Timing (finding 7).** Does a timestamp record when an event happened or when it was logged? Can damage score a kill after the shooter has died?

Future telemetry would answer most of these with sub-second timestamps, event IDs, participant IDs, a movement mode and an explicit outcome for how each session ended.

## Reproducing the audit

From the project root, after `make setup`:

```sh
pipeline/.venv/bin/python -m lila_pipeline.telemetry_audit_cli --output /tmp/lila-telemetry-audit
```

The audit validates the data against the build's data contract and applies the same cleaning rules. It then writes the nine evidence tables and a `summary.json`. It doesn't run in normal builds or change their output. [`raw_files.csv`](docs/data-findings/telemetry-audit-evidence/raw_files.csv) records the SHA-256 of every input file, so we can identify the exact files used. In `sessions.csv`, an empty death timestamp means no death was recorded, not that the player survived. The pipeline tests check the committed evidence against the raw files and against the figures in this document.
