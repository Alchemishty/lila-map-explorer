"""Keep the README's local references and setup entry points usable."""

import re
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_readme_local_links_resolve_to_files() -> None:
    readme_path = PROJECT_ROOT / "README.md"
    readme_text = readme_path.read_text()
    link_targets = re.findall(r"\[[^\]]+\]\(([^)]+)\)", readme_text)
    assert link_targets, f"{readme_path}: expected links to project documentation"
    for link_target in link_targets:
        if "://" in link_target or link_target.startswith("#"):
            continue
        linked_path = PROJECT_ROOT / link_target.split("#", maxsplit=1)[0]
        assert linked_path.is_file(), f"{readme_path}: missing linked file {link_target}"


@pytest.mark.parametrize(
    "document_name", ["AGENTS.md", "ARCHITECTURE.md", "DATA_QUALITY.md", "INSIGHTS.md"]
)
def test_root_document_links_resolve(document_name: str) -> None:
    document_path = PROJECT_ROOT / document_name
    document_text = document_path.read_text()
    link_targets = re.findall(r"\[[^\]]+\]\(([^)]+)\)", document_text)
    assert link_targets, f"{document_path}: expected links to supporting material"
    for link_target in link_targets:
        if "://" in link_target or link_target.startswith("#"):
            continue
        linked_path = PROJECT_ROOT / link_target.split("#", maxsplit=1)[0]
        assert linked_path.exists(), f"{document_path}: missing linked path {link_target}"


def test_readme_quick_start_runs_existing_targets_in_dependency_order() -> None:
    readme_path = PROJECT_ROOT / "README.md"
    readme_text = readme_path.read_text()
    shell_blocks = re.findall(r"```sh\n(.*?)\n```", readme_text, flags=re.DOTALL)
    setup_blocks = [block for block in shell_blocks if "make setup" in block]
    assert len(setup_blocks) == 1, f"{readme_path}: expected one quick-start block"
    setup_commands = setup_blocks[0].splitlines()
    assert setup_commands == ["make setup", "make data", "make dev"]
    makefile_text = (PROJECT_ROOT / "Makefile").read_text()
    for command in setup_commands:
        target_name = command.removeprefix("make ")
        assert re.search(rf"^{target_name}:", makefile_text, flags=re.MULTILINE), (
            f"{readme_path}: Makefile has no target {target_name}"
        )
