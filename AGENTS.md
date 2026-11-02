# LILA Map Explorer: agent guide

A Python build step cleans and validates telemetry from `player_data/` and writes static files. A TypeScript + Vite app (no React) loads them and draws trails, markers and heatmaps over the real minimaps.

## Intent

The users are Level Designers, not data scientists. They think in places on a map, so the map is the main surface and numbers support it. The tool should feel like a design tool, not a data dashboard. A designer should be able to answer a question about a map ("where do players die on Lockdown?", "how did this match unfold?") on their own, on desktop or phone. **Accuracy and depth matter more than load speed.**

### Anti-goals (failure even if it "works")

- Any wrong number or misplaced point, for example from the wrong time unit, the wrong coordinate space or duplicate rows counted twice.
- Silently dropping data the tool doesn't understand. Unknown event types, bad files and contract violations are reported in plain words.
- Approximations that lose detail: rounding coordinates, thinning trails, sampling instead of counting. Heatmaps are *drawn* smoothed to show clusters, but counts, markers and the inspector stay exact.
- A UI that reads like a data-science tool, with tables first and jargon.
- A bad data drop that takes down the live tool.

### Non-goals (don't build these unless asked)

- Planned for later: a "cold zones" layer, a time-into-match filter on Overview, a deeper inspector (death-cause breakdowns, timing, share of matches), and sample-size labels and caveat notices throughout the UI.
- Out of scope: loading data files in the browser, accounts or logins, a backend, and adding bot-side kill and death events to heatmaps or pairing them with player events to guess the other party.

## Non-negotiable rules

1. **Fail loudly** on missing or bad data, and never silently fall back. Missing or bad data throws or exits non-zero with a plain-language message naming the file and the problem.
2. **Descriptive names**, with units and coordinate spaces in the name (`timestampSeconds`, `worldX`, `pixelY`, `world_x`).
3. **Every change includes tests.**
4. **Bug fixes stay minimal.** Fix the bug, nothing else.
5. **Read `docs/` before changing code.**
6. **No git operations by the agent.** Never run git commands or create commits. The developer commits.

## Workflow

1. Read the docs below that touch your change.
2. Take a base snapshot: `scripts/snap.sh take <task>-base`.
3. Make the change with tests.
4. Run `make check`. It must pass before anything is called done.
5. Take a head snapshot and build the review package:
   `scripts/snap.sh take <task>-head`, then `scripts/snap.sh diff <task>-base <task>-head`.
6. Dispatch the `code-reviewer` agent (`.claude/agents/code-reviewer.md`, never a general-purpose agent) with the task brief, the package path and the ledger. Fix every violation, take a new snapshot (`<task>-fix1`, …), diff it against the previous head and re-review until approved.
7. Log the task, its snapshots, each verdict and any rulings in `.review/ledger.md`.

### Review workspace

Agents don't use git, so diffs come from snapshots. `scripts/snap.sh` keeps everything in `.review/` at the project root. That folder is gitignored and local to each machine. The first run creates `.review/ledger.md`. If several sessions share the folder, check the ledger and recent file changes before editing, so you don't overwrite another session's work.

The ledger is working memory. When a ruling changes how the tool behaves, also record it in the matching `docs/` file, because the ledger isn't committed.

### Review rules

- **Any enforcement violation blocks.** A reviewer may never file a rule break as Minor. Polish that breaks no rule may be Minor.
- **The reviewer runs `make check` itself** rather than trusting the implementer's report.

## Docs

- [`docs/architecture.md`](docs/architecture.md): build step, layers, data flow, settled design rules, file structure.
- [`docs/domain.md`](docs/domain.md): verified data facts, cleaning rules, minimap mapping, counting rules, event categories and markers.
- [`docs/conventions.md`](docs/conventions.md): naming with units, pure logic in `domain/`, fail-loudly patterns, approved UI wording.
- [`docs/testing.md`](docs/testing.md): required tests, edge cases to cover, and how to run each suite.
- [`DATA_QUALITY.md`](DATA_QUALITY.md): every data error and ambiguity found, with its evidence and decision. Its evidence tables are in `docs/data-findings/telemetry-audit-evidence/`.

`README.md`, `ARCHITECTURE.md`, `INSIGHTS.md` and `DATA_QUALITY.md` at the root are written for human readers. Keep their voice neutral, and don't link them to `docs/`. `scripts/verify-insights.mjs` checks the figures in `INSIGHTS.md`. It isn't part of `make check`, so run it after `make data` whenever Traffic or counting changes.

## Enforcement (hard gates at review)

- [`enforcement/null-safety.md`](enforcement/null-safety.md)
- [`enforcement/naming-and-units.md`](enforcement/naming-and-units.md)
- [`enforcement/coordinate-spaces.md`](enforcement/coordinate-spaces.md)
- [`enforcement/layer-direction.md`](enforcement/layer-direction.md)
- [`enforcement/tests-required.md`](enforcement/tests-required.md)
- [`enforcement/scope-discipline.md`](enforcement/scope-discipline.md)
- [`enforcement/data-contract.md`](enforcement/data-contract.md)

## Commands

| Command | Purpose |
|---|---|
| `make setup` | Install Python and Node dependencies and the test browsers |
| `make data` | Run the build step: `player_data/` to `web/public/data/` |
| `make dev` | Run the Vite dev server |
| `make build` | `make data`, then the production build of the app into `web/dist/` |
| `make check` | `check-pipeline` then `check-web`. Must pass before work is done |

GitHub Actions runs the same targets: `.github/workflows/checks.yml` runs `make check` on every pull request, and `.github/workflows/deploy.yml` runs `make build` on every push to `main` and publishes `web/dist/` to GitHub Pages. A failed build deploys nothing, so the live site keeps its last good version.

`check-web` runs `make data` first, so its Playwright smoke tests always run on fresh data. Stop any Vite dev or preview server before `make check`: the browser tests share Vite's dependency cache, and the e2e tests need port 4173.
