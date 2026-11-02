#!/usr/bin/env bash
# Snapshot-based review packages, so agents can review changes without running git.
# Everything it writes lives in .review/ at the project root (gitignored, local to each machine).
# The first run creates .review/ledger.md, the running log of tasks, reviews and rulings.
# Usage:
#   scripts/snap.sh take NAME             copy the project source into .review/snapshots/NAME
#   scripts/snap.sh diff BASE HEAD [OUT]  write a review package (changed files + unified diff);
#                                         OUT defaults to .review/HEAD-package.md
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REVIEW_DIRECTORY="$PROJECT_ROOT/.review"
SNAPSHOT_DIRECTORY="$REVIEW_DIRECTORY/snapshots"
LEDGER_PATH="$REVIEW_DIRECTORY/ledger.md"
EXCLUDES=(--exclude .git --exclude .review --exclude .superpowers --exclude node_modules
  --exclude .venv --exclude dist --exclude 'web/public/data' --exclude __pycache__
  --exclude .pytest_cache --exclude .mypy_cache --exclude .ruff_cache --exclude test-results
  --exclude playwright-report --exclude __screenshots__ --exclude .DS_Store
  --exclude 'player_data/February_*' --exclude 'player_data/minimaps' --exclude '*.parquet'
  --exclude package-lock.json --exclude uv.lock)

usage() {
  echo "usage: scripts/snap.sh take NAME | diff BASE HEAD [OUT]" >&2
  exit 2
}

ensure_ledger() {
  mkdir -p "$SNAPSHOT_DIRECTORY"
  if [ ! -f "$LEDGER_PATH" ]; then
    cat > "$LEDGER_PATH" <<'LEDGER'
# Review ledger

Local and gitignored. One section per task, newest last:

- **Task:** short id and one-line goal, with the brief's path if there is one
- **Snapshots:** base and head names, and the review package path
- **Reviews:** each verdict (Approved / Needs fixes) and the fix rounds
- **Rulings:** decisions made during the task that later work must respect
LEDGER
    echo "created $LEDGER_PATH"
  fi
}

require_snapshot() {
  if [ ! -d "$SNAPSHOT_DIRECTORY/$1" ]; then
    echo "snap.sh: no snapshot named '$1' in $SNAPSHOT_DIRECTORY (take it first)" >&2
    exit 1
  fi
}

[ $# -ge 1 ] || usage
case "$1" in
  take)
    [ $# -eq 2 ] || usage
    ensure_ledger
    rm -rf "${SNAPSHOT_DIRECTORY:?}/$2"
    mkdir -p "$SNAPSHOT_DIRECTORY/$2"
    rsync -a "${EXCLUDES[@]}" "$PROJECT_ROOT/" "$SNAPSHOT_DIRECTORY/$2/"
    echo "snapshot $2 taken"
    ;;
  diff)
    [ $# -eq 3 ] || [ $# -eq 4 ] || usage
    ensure_ledger
    require_snapshot "$2"
    require_snapshot "$3"
    package_path="${4:-$REVIEW_DIRECTORY/$3-package.md}"
    {
      echo "# Review package: $2 -> $3"
      echo
      echo "## Changed files"
      diff -rq "$SNAPSHOT_DIRECTORY/$2" "$SNAPSHOT_DIRECTORY/$3" | sed "s#$SNAPSHOT_DIRECTORY/##g" || true
      echo
      echo "## Diff"
      (cd "$SNAPSHOT_DIRECTORY" && diff -ruN -U10 "$2" "$3") || true
    } > "$package_path"
    echo "wrote $package_path ($(wc -l < "$package_path" | tr -d ' ') lines)"
    ;;
  *) usage ;;
esac
