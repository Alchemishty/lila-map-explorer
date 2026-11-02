"""`main` must turn every failure into a plain stderr message and exit code 1, never a traceback."""

import shutil
from pathlib import Path
from typing import Any

from fixtures import write_drop_folder, write_raw_file
from lila_pipeline.cli import main

EVENT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "event_types.json"
HUMAN_ID = "f4e072fa-b7af-4761-b567-1d95b7ad0108"
MATCH_ID = "3731eba6-1111-2222-3333-444444444444.nakama-0"
# Two rows a minute apart: a match needs a length above 0.
GOOD_ROWS: list[tuple[float, float, int, str]] = [
    (1.0, 2.0, 100, "Position"),
    (3.0, 4.0, 160, "Position"),
]


def run_build(drop: Path, output: Path, event_config_path: Path = EVENT_CONFIG_PATH) -> int:
    return main(
        ["build", "--input", str(drop), "--event-config", str(event_config_path),
         "--output", str(output)]
    )  # fmt: skip


def build_good_drop(tmp_path: Path) -> Path:
    drop = write_drop_folder(tmp_path / "drop")
    write_raw_file(drop / "February_10", HUMAN_ID, MATCH_ID, "Lockdown", GOOD_ROWS)
    return drop


def assert_plain_failure(capsys: Any, output: Path, expected_text: str) -> str:
    captured = capsys.readouterr()
    assert "Traceback" not in captured.err
    assert expected_text in captured.err
    assert captured.out == ""
    assert not output.exists()
    return str(captured.err)


def test_good_drop_succeeds(tmp_path: Path, capsys: Any) -> None:
    output = tmp_path / "out"
    assert run_build(build_good_drop(tmp_path), output) == 0
    assert "same-tick-repeat rows: 0" in capsys.readouterr().out
    assert (output / "manifest.json").is_file()


def test_missing_maps_json_fails_plainly(tmp_path: Path, capsys: Any) -> None:
    drop = build_good_drop(tmp_path)
    (drop / "maps.json").unlink()
    output = tmp_path / "out"
    assert run_build(drop, output) == 1
    expected_text = f"{drop / 'maps.json'}: file not found"
    assert_plain_failure(capsys, output, expected_text)


def test_bad_event_types_json_fails_plainly(tmp_path: Path, capsys: Any) -> None:
    drop = build_good_drop(tmp_path)
    bad_event_config_path = tmp_path / "event_types.json"
    bad_event_config_path.write_text("{not json", encoding="utf-8")
    output = tmp_path / "out"
    assert run_build(drop, output, bad_event_config_path) == 1
    assert_plain_failure(capsys, output, f"{bad_event_config_path}: not valid JSON")


def test_unreadable_parquet_file_fails_plainly(tmp_path: Path, capsys: Any) -> None:
    drop = build_good_drop(tmp_path)
    (drop / "February_10" / "broken_file").write_bytes(b"not parquet")
    output = tmp_path / "out"
    assert run_build(drop, output) == 1
    error_text = assert_plain_failure(
        capsys, output, "February_10/broken_file: could not be read as a parquet file"
    )
    assert "1 problem(s) found in the data" in error_text


def test_every_unreadable_file_and_validation_problem_is_reported_together(
    tmp_path: Path, capsys: Any
) -> None:
    drop = build_good_drop(tmp_path)
    (drop / "February_10" / "broken_one").write_bytes(b"not parquet")
    (drop / "February_11").mkdir()
    (drop / "February_11" / "broken_two").write_bytes(b"not parquet")
    write_raw_file(drop / "February_10", "x", MATCH_ID, "Nowhere", GOOD_ROWS)
    output = tmp_path / "out"
    assert run_build(drop, output) == 1
    # The extra file also puts the match on a second map, which is the fourth problem.
    error_text = assert_plain_failure(capsys, output, "4 problem(s) found in the data")
    assert "February_10/broken_one: could not be read as a parquet file" in error_text
    assert "February_11/broken_two: could not be read as a parquet file" in error_text
    assert f"February_10/x_{MATCH_ID}: map 'Nowhere' has no entry in maps.json" in error_text
    assert f"match '{MATCH_ID}' has files on more than one map" in error_text


def test_missing_minimap_fails_before_anything_is_written(tmp_path: Path, capsys: Any) -> None:
    drop = build_good_drop(tmp_path)
    (drop / "minimaps" / "Lockdown_Minimap.jpg").unlink()
    output = tmp_path / "out"
    assert run_build(drop, output) == 1
    expected_text = (
        f"{drop / 'minimaps' / 'Lockdown_Minimap.jpg'}: minimap image for map 'Lockdown' not found"
    )
    assert_plain_failure(capsys, output, expected_text)
    assert [path.name for path in tmp_path.iterdir() if path.name.startswith(".")] == []


def test_missing_input_folder_fails_plainly(tmp_path: Path, capsys: Any) -> None:
    missing_drop = tmp_path / "no_such_drop"
    output = tmp_path / "out"
    assert run_build(missing_drop, output) == 1
    assert_plain_failure(capsys, output, f"{missing_drop}: input folder not found")


def test_input_without_telemetry_files_fails_plainly(tmp_path: Path, capsys: Any) -> None:
    drop = write_drop_folder(tmp_path / "drop")
    (drop / "February_10").mkdir()
    output = tmp_path / "out"
    assert run_build(drop, output) == 1
    error_text = assert_plain_failure(
        capsys, output, f"{drop}: no telemetry files found in any day folder"
    )
    assert error_text == f"{drop}: no telemetry files found in any day folder\n"


def test_unexpected_input_folder_fails_plainly(tmp_path: Path, capsys: Any) -> None:
    drop = build_good_drop(tmp_path)
    (drop / "notes").mkdir()
    output = tmp_path / "out"
    assert run_build(drop, output) == 1
    assert_plain_failure(
        capsys,
        output,
        "notes: unexpected folder in the input "
        "(expected a day folder like February_10, or minimaps)",
    )


def test_copies_with_different_contents_fail_plainly(tmp_path: Path, capsys: Any) -> None:
    drop = build_good_drop(tmp_path)
    changed_rows: list[tuple[float, float, int, str]] = [(9.0, 2.0, 100, "Position")]
    write_raw_file(drop / "February_11", HUMAN_ID, MATCH_ID, "Lockdown", changed_rows)
    output = tmp_path / "out"
    assert run_build(drop, output) == 1
    file_name = f"{HUMAN_ID}_{MATCH_ID}"
    assert_plain_failure(
        capsys,
        output,
        f"February_11/{file_name}: same user and match as February_10/{file_name} "
        "but different contents",
    )


def test_identical_copies_in_two_day_folders_still_build(tmp_path: Path, capsys: Any) -> None:
    drop = build_good_drop(tmp_path)
    shutil.copytree(drop / "February_10", drop / "February_11")
    output = tmp_path / "out"
    assert run_build(drop, output) == 0
    assert "duplicate-file rows dropped: 2" in capsys.readouterr().out


def test_zero_length_match_fails_the_build_and_publishes_nothing(
    tmp_path: Path, capsys: Any
) -> None:
    drop = write_drop_folder(tmp_path / "drop")
    same_second_rows: list[tuple[float, float, int, str]] = [
        (1.0, 2.0, 100, "Position"),
        (3.0, 4.0, 100, "Loot"),
    ]
    write_raw_file(drop / "February_10", HUMAN_ID, MATCH_ID, "Lockdown", same_second_rows)
    output = tmp_path / "out"
    assert run_build(drop, output) == 1
    assert_plain_failure(
        capsys,
        output,
        f"February_10/{HUMAN_ID}_{MATCH_ID}: match '{MATCH_ID}' has every row (2 rows) recorded "
        "at the same second (timestamp 100), so its length is 0 s.",
    )


def test_match_on_two_maps_fails_the_build_and_keeps_the_old_output(
    tmp_path: Path, capsys: Any
) -> None:
    drop = build_good_drop(tmp_path)
    output = tmp_path / "out"
    assert run_build(drop, output) == 0
    old_manifest_text = (output / "manifest.json").read_text(encoding="utf-8")
    capsys.readouterr()
    write_raw_file(drop / "February_10", "1429", MATCH_ID, "GrandRift", [
        (1.0, 2.0, 100, "BotPosition"), (3.0, 4.0, 160, "BotPosition")
    ])  # fmt: skip
    assert run_build(drop, output) == 1
    captured = capsys.readouterr()
    assert "Traceback" not in captured.err
    assert (
        f"match '{MATCH_ID}' has files on more than one map: 'GrandRift' in "
        f"February_10/1429_{MATCH_ID}; 'Lockdown' in February_10/{HUMAN_ID}_{MATCH_ID}"
    ) in captured.err
    assert (output / "manifest.json").read_text(encoding="utf-8") == old_manifest_text
