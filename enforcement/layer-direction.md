# Enforcement: Layer Direction

**Rule:** Layers are one-way. `domain` imports nothing from the app. `data` and `render` each import only `domain`, and never each other. `ui` may import all three. Nothing imports `ui`. `domain` is pure: no DOM, no fetch, no Leaflet, no canvas. No source file over 300 lines.

**Why:** Pure logic stays testable and exact, and the UI stays swappable. ESLint enforces it; review confirms it.

## Violations

### Logic importing UI or rendering
```ts
// VIOLATION: web/src/domain/heatmap.ts
import { store } from "../ui/store";
import L from "leaflet";

// REQUIRED: domain takes plain inputs and returns plain outputs
export function countEventsPerCell(events: readonly GameEvent[], cellSizeWorldUnits: number): CellCounts { ... }
```

### Logic that touches the DOM or network
```ts
// VIOLATION: in domain/
const canvas = document.createElement("canvas");
const response = await fetch("data/manifest.json");

// REQUIRED: domain/ receives already-parsed data; fetching lives in data/, drawing in render/
```

### Data layer reaching up
```ts
// VIOLATION: web/src/data/loader.ts
import { showErrorView } from "../ui/errorView";

// REQUIRED: loader throws; ui catches and shows the error view
```

### Python equivalent
```python
# VIOLATION: clean.py reading files or writing output
def drop_duplicate_blocks(path): frame = pd.read_parquet(path) ...

# REQUIRED: clean.py is pure over already-read data; raw_files.py reads, export.py writes
def drop_duplicate_blocks(raw_file: RawFile) -> RawFile: ...
```
Pipeline order: `errors`, `config`, `raw_files`, `classify`, `clean`, `validate`, `export`, `cli`. No module imports a later one.

### File size
```ts
// VIOLATION: a 450-line file
// REQUIRED: split by responsibility to stay at or under 300 lines
```

## Checking

For each new import, name the layer of both files and confirm the direction. Confirm nothing in `domain/` mentions `document`, `window`, `fetch`, `L.`, or `ui/` / `render/` / `data/` imports. Confirm line counts.
