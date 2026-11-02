.PHONY: setup data dev build check check-pipeline check-web

setup:
	cd pipeline && uv sync
	cd web && npm ci
	cd web && npx playwright install chromium webkit
data:
	cd pipeline && uv run python -m lila_pipeline build --input ../player_data --event-config ../config/event_types.json --output ../web/public/data
dev:
	cd web && npm run dev
build: data
	cd web && npm run build
check-pipeline:
	cd pipeline && uv run ruff check src tests
	cd pipeline && uv run ruff format --check src tests
	cd pipeline && uv run mypy src tests
	cd pipeline && uv run pytest
	@oversized="$$(find pipeline/src pipeline/tests -name '*.py' -not -path '*/.venv/*' -exec awk 'END { if (NR > 300) print FILENAME " (" NR " lines)" }' {} \;)"; \
	if [ -n "$$oversized" ]; then echo "Python files over 300 lines:"; echo "$$oversized"; exit 1; fi
# Depends on data so the smoke tests always run on fresh data, even on a clean checkout.
check-web: data
	cd web && npm run typecheck
	cd web && npm run lint
	cd web && npm run format:check
	cd web && npm test
	cd web && npm run build
	cd web && npm run e2e
check: check-pipeline check-web
