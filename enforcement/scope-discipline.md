# Enforcement: Scope Discipline

**Rule:** Do what the task asks, nothing more. Bug fixes are minimal. No features from the non-goals in `AGENTS.md`. No refactors, renames or cleanups outside the change. No git operations.

**Why:** Small, reviewable changes keep the data correct. Non-goals are planned for later (`AGENTS.md`, "Non-goals").

## Violations

### Drive-by changes
```ts
// VIOLATION: a bug fix in filters.ts that also renames three files and reformats others
// REQUIRED: the smallest diff that fixes the bug, plus its regression test
```
```python
# VIOLATION: fixing a dedup bug and also "tidying" export.py
# REQUIRED: touch only clean.py and its test
```

### Building non-goals
Not in scope: cold-zones layer, time-into-match filter on Overview, deeper inspector (death-cause breakdowns, timing, share of matches), sample-size labels and caveat notices, loading data files in the browser, accounts, a backend, bot-side events in heatmaps or guessing the other party.
```ts
// VIOLATION: adding a bot-vs-player pairing guess "to make the inspector nicer"
// REQUIRED: say the victim/killer is not recorded
```

### Speculative additions
```ts
// VIOLATION: config options, flags, abstractions nobody asked for
// REQUIRED: only what the task requires
```

### Touching protected things
- `player_data/` parquet files are never modified.
- Never run git commands or create commits.

## Checking

Compare the diff to the task. Every changed line must trace to a requirement. Anything else comes out or is raised as a question.
