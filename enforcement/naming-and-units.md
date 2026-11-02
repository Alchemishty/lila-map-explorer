# Enforcement: Naming and Units

**Rule:** Names say exactly what a value is, with its unit or coordinate space in the name. No abbreviations.

**Why:** Wrong time units and wrong coordinate spaces are the most likely source of wrong numbers (an anti-goal in `AGENTS.md`). `ts` holds epoch seconds despite its type, and world and pixel points look identical as numbers.

## Violations

### Missing unit or space
```ts
// VIOLATION
const t = row.ts - startTs;
const x = row.x;
const duration = 120;

// REQUIRED
const elapsedSeconds = row.timestampSeconds - matchStartTimestampSeconds;
const worldX = row.worldX;
const matchLengthSeconds = 120;
```
```python
# VIOLATION
t = row.ts - start_ts
x = row.x
duration = 120

# REQUIRED
elapsed_seconds = row.timestamp_seconds - match_start_timestamp_seconds
world_x = row.world_x
match_length_seconds = 120
```

Standard names: `timestampSeconds`, `elapsedSeconds`, `worldX`/`worldZ`, `pixelX`/`pixelY`, `timestamp_seconds`, `world_x`, `world_z`, `pixel_x`, `pixel_y`.

### Abbreviations
```ts
// VIOLATION
const evt = events.filter((e) => e.cat === "kill");
const cfg = loadCfg();
const btn = document.querySelector("button");

// REQUIRED
const killEvents = events.filter((event) => event.category === "kill");
const mapConfig = loadMapConfig();
const playButton = document.querySelector("button");
```
```python
# VIOLATION
df = pd.read_parquet(p)
for r in rows: ...

# REQUIRED
position_frame = pd.read_parquet(parquet_path)
for row in rows: ...
```

Allowed abbreviations: `id`, `url`, `api`, `ui`, `dto`, and `i`/`j`/`k` as loop counters only.

### Booleans, collections, functions
```ts
// VIOLATION
let bot = false; const matches = new Map(); function update() {}

// REQUIRED
let isBot = false;
const matchesById = new Map<string, Match>();
function updateTimelineScrubber() {}
```
```python
# VIOLATION
dead = False; lookup = {}; def process(): ...

# REQUIRED
has_died = False
actor_rows_by_player_key: dict[str, list[Row]] = {}
def drop_duplicate_bot_killed_rows(): ...
```

Booleans read as questions (`is`/`has`/`can`/`should`). Collections say what they hold. Functions describe the action. Minimum length: locals 3+, fields 5+, functions 5+.

**Exemption (user decision, 2026-11-01):** keys of the data files (`manifest.json`, day files) and of `config/event_types.json`, and the TypeScript and Python fields that mirror them one to one (for example `maps`, `fill`, `bot`), are part of the data contract. The length rule does not apply to them. Renaming one is a contract change in the pipeline and the web app together, never a drive-by fix.

## Checking

For each new or modified identifier: full words (except data-contract keys, see the exemption above); unit or space present for any time, position or size; booleans are questions; collections describe contents; functions describe an action; no single-letter names outside loop counters.
