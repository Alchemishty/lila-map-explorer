"""The GitHub workflows: full checks on pull requests, build-then-deploy to Pages on main."""

from pathlib import Path

WORKFLOW_DIRECTORY = Path(__file__).resolve().parents[2] / ".github" / "workflows"


def read_workflow(file_name: str) -> str:
    workflow_path = WORKFLOW_DIRECTORY / file_name
    assert workflow_path.exists(), f"missing workflow {workflow_path}"
    return workflow_path.read_text()


def test_checks_workflow_runs_make_check_on_pull_requests_with_both_browsers() -> None:
    workflow = read_workflow("checks.yml")
    assert "on:\n  pull_request:" in workflow
    assert "run: make setup" in workflow
    assert "npx playwright install-deps chromium webkit" in workflow
    assert "run: make check" in workflow


def test_deploy_workflow_builds_fresh_data_and_publishes_only_web_dist_from_main() -> None:
    workflow = read_workflow("deploy.yml")
    assert "push:\n    branches: [main]" in workflow
    assert "uv sync --frozen" in workflow
    assert "npm ci" in workflow
    assert "run: make build" in workflow
    assert "path: web/dist" in workflow
    assert "needs: build" in workflow
    assert "uses: actions/deploy-pages@v5" in workflow
    assert "pages: write" in workflow
    assert "id-token: write" in workflow


def test_deploy_never_cancels_a_running_publish() -> None:
    workflow = read_workflow("deploy.yml")
    assert "cancel-in-progress: false" in workflow
