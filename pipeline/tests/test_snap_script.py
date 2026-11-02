"""scripts/snap.sh: snapshots and review packages live in a local .review/ with its own ledger."""

import shutil
import subprocess
from pathlib import Path

import pytest

SNAP_SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "snap.sh"


def make_project_copy(tmp_path: Path) -> Path:
    project_root = tmp_path / "project"
    (project_root / "scripts").mkdir(parents=True)
    shutil.copy(SNAP_SCRIPT_PATH, project_root / "scripts" / "snap.sh")
    (project_root / "notes.txt").write_text("before\n")
    (project_root / ".git").mkdir()
    (project_root / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
    return project_root


def run_snap(project_root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(project_root / "scripts" / "snap.sh"), *arguments],
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.skipif(shutil.which("rsync") is None, reason="snap.sh needs rsync")
def test_take_creates_ledger_and_diff_writes_package_inside_review(tmp_path: Path) -> None:
    project_root = make_project_copy(tmp_path)
    assert run_snap(project_root, "take", "base").returncode == 0
    ledger_path = project_root / ".review" / "ledger.md"
    assert ledger_path.read_text().startswith("# Review ledger")
    ledger_path.write_text("# Review ledger\n\nkept\n")
    (project_root / "notes.txt").write_text("after\n")
    assert run_snap(project_root, "take", "head").returncode == 0
    assert ledger_path.read_text() == "# Review ledger\n\nkept\n"
    assert not (project_root / ".review" / "snapshots" / "head" / ".git").exists()
    assert not (project_root / ".review" / "snapshots" / "head" / ".review").exists()
    assert run_snap(project_root, "diff", "base", "head").returncode == 0
    package_text = (project_root / ".review" / "head-package.md").read_text()
    assert "# Review package: base -> head" in package_text
    assert "-before" in package_text
    assert "+after" in package_text


def test_diff_of_a_missing_snapshot_fails_with_its_name(tmp_path: Path) -> None:
    project_root = make_project_copy(tmp_path)
    result = run_snap(project_root, "diff", "never-taken", "head")
    assert result.returncode == 1
    assert "no snapshot named 'never-taken'" in result.stderr


def test_unknown_command_prints_usage(tmp_path: Path) -> None:
    project_root = make_project_copy(tmp_path)
    result = run_snap(project_root, "commit")
    assert result.returncode == 2
    assert "usage: scripts/snap.sh" in result.stderr
