# Enforcement: Null Safety (Fail Loudly)

**Rule:** Never silently consume a missing, null or bad value when the mechanism needs it. Throw (TypeScript) or raise / exit non-zero (Python) with a plain-language message naming the file and the problem. Never silently fall back.

**Why:** A wrong number or a silently dropped row is a failure even if the tool "works" (an anti-goal in `AGENTS.md`). Designers trust what they see.

## Violations

### Silent return on missing value
```ts
// VIOLATION
const mapConfig = mapConfigsByName.get(mapName);
if (mapConfig === undefined) return;

// REQUIRED
const mapConfig = mapConfigsByName.get(mapName);
if (mapConfig === undefined) {
  throw new Error(`Map "${mapName}" has no entry in maps.json`);
}
```
```python
# VIOLATION
map_config = map_configs_by_name.get(map_name)
if map_config is None:
    return

# REQUIRED
map_config = map_configs_by_name.get(map_name)
if map_config is None:
    raise DataContractError(f"{file_path}: map '{map_name}' has no entry in maps.json")
```

### Default that hides the problem
```ts
// VIOLATION: unknown event silently becomes "other"
const category = categoryByEvent[eventName] ?? "other";

// REQUIRED
const category = categoryByEvent[eventName];
if (category === undefined) {
  throw new Error(`Unknown event type "${eventName}" in ${dayFileName}`);
}
```
```python
# VIOLATION
category = category_by_event.get(event_name, "other")

# REQUIRED
if event_name not in category_by_event:
    raise DataContractError(f"{file_path}: unknown event type '{event_name}'")
category = category_by_event[event_name]
```

### Non-null assertion, any, or swallowed errors
```ts
// VIOLATION
const firstRow = rows[0]!;
try { render(); } catch { /* ignore */ }
const payload: any = await response.json();

// REQUIRED
const firstRow = rows[0];
if (firstRow === undefined) throw new Error(`${matchId} has no rows`);
const payload = manifestSchema.parse(await response.json());
```
```python
# VIOLATION
try:
    frame = pd.read_parquet(path)
except Exception:
    frame = pd.DataFrame()

# REQUIRED: let it fail, or re-raise with the file named
try:
    frame = pd.read_parquet(path)
except Exception as error:
    raise DataContractError(f"{path}: cannot read parquet file ({error})") from error
```

### Unchecked fetch
```ts
// VIOLATION
const response = await fetch(url);
const data = await response.json();

// REQUIRED
const response = await fetch(url);
if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
```

## When absence IS a valid state

Guard only when absence is expected and handled, and say so in the name or a comment:
```ts
// ACCEPTABLE: an actor can have zero position samples; draw a head only
if (samples.length === 0) return [];
```
```python
# ACCEPTABLE: a match with no bot files is valid
bot_files = files_by_actor_type.get("bot", [])
```

## Decision rule

"If this value is missing, is the system broken or is this one valid path?"
- Broken: throw / raise
- Valid path: guard
- Unsure: throw

## Checking

For each changed line, look for: early `return` on `undefined`/`None`, `??` / `.get(x, default)` on required data, `!`, `any`, empty `catch` / bare `except`, unchecked `fetch`.
