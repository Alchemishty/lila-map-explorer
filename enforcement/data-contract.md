# Enforcement: Data Contract

**Rule:** The build fails on any contract violation, and publishes nothing. The app validates the data once on load with zod, and shows the error view on failure. Neither side silently skips, repairs or guesses.

**Why:** Silently dropping data the tool does not understand is an anti-goal (`AGENTS.md`). A bad data drop must never take down the live tool, so a failed build leaves the previous site as it was.

## Build must fail on

- A file that mixes player (`Position`) and bot (`BotPosition`) events.
- A UUID-style ID with bot events.
- More than one map or match in a file.
- Points outside the minimap (edge points, u or v exactly 0 or 1, are valid).
- An event type the config does not know.
- A map with no config entry.
- A match whose rows all share one second (length 0): its timestamps were recorded wrongly.
- A match whose files, taken together, name more than one map.

The report names the file and the problem in plain words.

## Violations

### Skipping bad files
```python
# VIOLATION
for path in raw_paths:
    try:
        raw_files.append(read_raw_file(path))
    except Exception:
        continue

# REQUIRED: collect all problems, then fail
problems = [... for each violation: f"{path}: {plain_language_problem}"]
if problems:
    raise DataContractError(problems)
```

### Writing output before validating
```python
# VIOLATION
write_day_files(output_directory, cleaned)
validate(cleaned)

# REQUIRED: validate first, then write atomically (temp dir, then move into place)
validate(cleaned)
write_output_atomically(output_directory, cleaned)
```

### Unknown event dropped or defaulted
```python
# VIOLATION
rows = rows[rows.event.isin(known_events)]

# REQUIRED
unknown_events = set(rows.event) - set(known_events)
if unknown_events:
    raise DataContractError(f"{path}: unknown event types {sorted(unknown_events)}")
```

### App trusting JSON blindly
```ts
// VIOLATION
const manifest = (await response.json()) as Manifest;

// REQUIRED: validate once on load; on failure show the error view
const parsed = manifestSchema.safeParse(await response.json());
if (!parsed.success) {
  throw new Error(`manifest.json does not match the data contract: ${parsed.error.message}`);
}
```
```ts
// VIOLATION: validate again in every function, or catch and render an empty map
// REQUIRED: validate once in data/loader.ts; ui catches the thrown error and shows errorView
```

## Checking

For each pipeline change: does every contract violation still fail the build, with the file named, before anything is written? For each loader change: is the payload parsed once with zod, and does failure reach the error view in plain words? Is there a test for the failing case?
