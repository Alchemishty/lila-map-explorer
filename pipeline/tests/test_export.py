import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from fixtures import MAP_CONFIGS_FOR_FIXTURES, write_drop_folder, write_raw_file
from lila_pipeline import export
from lila_pipeline.clean import clean_dataset
from lila_pipeline.cli import main
from lila_pipeline.config import load_event_config, load_map_configs
from lila_pipeline.export import write_site_data
from lila_pipeline.raw_files import discover_raw_files, read_raw_file

EVENT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "event_types.json"
HUMAN_ID = "f4e072fa-b7af-4761-b567-1d95b7ad0108"
MATCH_ID = "3731eba6-1111-2222-3333-444444444444.nakama-0"
Row = tuple[float, float, int, str]
# 2026-02-10 23:59:50 UTC and 2026-02-11 00:00:10 UTC
BEFORE_MIDNIGHT_TIMESTAMP_SECONDS = 1770767990
AFTER_MIDNIGHT_TIMESTAMP_SECONDS = BEFORE_MIDNIGHT_TIMESTAMP_SECONDS + 20


def build_input(
    root: Path, rows: list[Row], image_size_pixels: tuple[int, int] | None = None
) -> Path:
    drop = write_drop_folder(root / "drop")
    if image_size_pixels is not None:
        Image.new("RGB", image_size_pixels, (1, 2, 3)).save(
            drop / "minimaps" / "Lockdown_Minimap.jpg"
        )
    write_raw_file(drop / "February_10", HUMAN_ID, MATCH_ID, "Lockdown", rows)
    return drop


def run_write(drop: Path, output: Path) -> None:
    raw_files = [read_raw_file(path, day_folder) for day_folder, path in discover_raw_files(drop)]
    map_configs_by_id = load_map_configs(drop / "maps.json")
    event_config = load_event_config(EVENT_CONFIG_PATH)
    write_site_data(
        clean_dataset(raw_files), map_configs_by_id, event_config, drop / "minimaps", output
    )


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def hidden_names(directory: Path) -> list[str]:
    return sorted(path.name for path in directory.iterdir() if path.name.startswith("."))


def test_match_crossing_midnight_is_in_one_day_file(tmp_path: Path) -> None:
    rows: list[Row] = [
        (1.0, 2.0, BEFORE_MIDNIGHT_TIMESTAMP_SECONDS, "Position"),
        (3.0, 4.0, AFTER_MIDNIGHT_TIMESTAMP_SECONDS, "Position"),
    ]
    output = tmp_path / "out"
    run_write(build_input(tmp_path, rows), output)
    day_file = read_json(output / "days" / "Lockdown" / "2026-02-10.json")
    assert [match["matchId"] for match in day_file["matches"]] == [MATCH_ID]
    assert day_file["matches"][0]["actors"][0]["timestampSeconds"] == [
        BEFORE_MIDNIGHT_TIMESTAMP_SECONDS,
        AFTER_MIDNIGHT_TIMESTAMP_SECONDS,
    ]
    assert not (output / "days" / "Lockdown" / "2026-02-11.json").exists()
    manifest = read_json(output / "manifest.json")
    assert manifest["matches"][0]["dayFile"] == "days/Lockdown/2026-02-10.json"
    assert manifest["matches"][0]["durationSeconds"] == 20


def test_same_tick_repeat_flag_is_written_under_new_name(tmp_path: Path) -> None:
    rows: list[Row] = [
        (1.0, 2.0, 100, "BotKill"),
        (1.0, 2.0, 100, "BotKill"),
        (1.0, 2.0, 101, "Position"),
    ]
    output = tmp_path / "out"
    run_write(build_input(tmp_path, rows), output)
    actor = read_json(output / "days" / "Lockdown" / "1970-01-01.json")["matches"][0]["actors"][0]
    assert actor["isSameTickRepeat"] == [False, True, False]
    assert "sameTickMulti" not in actor


def test_coordinates_written_unrounded(tmp_path: Path) -> None:
    value = float(np.float32(-301.4536743164062))
    rows: list[Row] = [(value, 5.5, 100, "Position")]
    output = tmp_path / "out"
    run_write(build_input(tmp_path, rows), output)
    day_file = read_json(output / "days" / "Lockdown" / "1970-01-01.json")
    written = day_file["matches"][0]["actors"][0]["worldX"][0]
    assert written == value  # exact float32 value as a double, never rounded
    assert np.float32(written) == np.float32(value)


def test_minimap_resized_to_4096_keeping_aspect(tmp_path: Path) -> None:
    rows: list[Row] = [(1.0, 2.0, 100, "Position")]
    output = tmp_path / "out"
    run_write(build_input(tmp_path, rows, image_size_pixels=(5000, 4000)), output)
    with Image.open(output / "minimaps" / "Lockdown.jpg") as image:
        assert image.size == (4096, 3277)
        assert image.format == "JPEG"
    map_entry = next(
        entry
        for entry in read_json(output / "manifest.json")["maps"]
        if entry["mapId"] == "Lockdown"
    )
    assert (map_entry["imageWidthPixels"], map_entry["imageHeightPixels"]) == (4096, 3277)
    assert map_entry["imageFile"] == "minimaps/Lockdown.jpg"
    assert map_entry["worldScale"] == MAP_CONFIGS_FOR_FIXTURES["Lockdown"]["world_scale"]


def test_failed_validation_leaves_previous_output_untouched(tmp_path: Path, capsys: Any) -> None:
    output = tmp_path / "out"
    output.mkdir()
    (output / "keep.txt").write_text("previous", encoding="utf-8")
    rows: list[Row] = [(99999.0, 2.0, 100, "Position")]  # outside the minimap
    drop = build_input(tmp_path, rows)
    exit_code = main(
        ["build", "--input", str(drop), "--event-config", str(EVENT_CONFIG_PATH),
         "--output", str(output)]
    )  # fmt: skip
    assert exit_code == 1
    assert "outside the minimap" in capsys.readouterr().err
    assert (output / "keep.txt").read_text(encoding="utf-8") == "previous"
    assert sorted(path.name for path in output.iterdir()) == ["keep.txt"]
    assert hidden_names(tmp_path) == []


def test_failure_while_writing_leaves_previous_output_and_removes_temporary_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "out"
    output.mkdir()
    (output / "keep.txt").write_text("previous", encoding="utf-8")
    drop = build_input(tmp_path, [(1.0, 2.0, 100, "Position")])

    def fail_writing(path: Path, content: object) -> None:
        raise RuntimeError("disk full")

    monkeypatch.setattr(export, "_write_json", fail_writing)
    with pytest.raises(RuntimeError, match="disk full"):
        run_write(drop, output)
    assert sorted(path.name for path in output.iterdir()) == ["keep.txt"]
    assert (output / "keep.txt").read_text(encoding="utf-8") == "previous"
    assert hidden_names(tmp_path) == []


def test_swap_replaces_previous_output_and_deletes_old_directory(tmp_path: Path) -> None:
    output = tmp_path / "out"
    output.mkdir()
    (output / "old.txt").write_text("old", encoding="utf-8")
    temporary_directory = tmp_path / "new"
    temporary_directory.mkdir()
    (temporary_directory / "new.txt").write_text("new", encoding="utf-8")
    export._swap_into_place(temporary_directory, output)
    assert sorted(path.name for path in output.iterdir()) == ["new.txt"]
    assert hidden_names(tmp_path) == []


def test_swap_warns_but_succeeds_when_old_directory_cannot_be_deleted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: Any
) -> None:
    output = tmp_path / "out"
    output.mkdir()
    (output / "old.txt").write_text("old", encoding="utf-8")
    temporary_directory = tmp_path / "new"
    temporary_directory.mkdir()
    (temporary_directory / "new.txt").write_text("new", encoding="utf-8")

    def fail_to_delete(path: Path) -> None:
        raise OSError("disk is read-only")

    monkeypatch.setattr("lila_pipeline.export.shutil.rmtree", fail_to_delete)
    export._swap_into_place(temporary_directory, output)
    assert sorted(path.name for path in output.iterdir()) == ["new.txt"]
    leftover_names = hidden_names(tmp_path)
    assert len(leftover_names) == 1
    assert leftover_names[0].startswith(".out.old-")
    assert capsys.readouterr().err == (
        f"warning: the new output is in place, but the previous output could not be deleted "
        f"(disk is read-only). The leftover folder {tmp_path / leftover_names[0]} can be "
        "deleted.\n"
    )


def test_swap_restores_previous_output_when_move_fails(tmp_path: Path) -> None:
    output = tmp_path / "out"
    output.mkdir()
    (output / "keep.txt").write_text("previous", encoding="utf-8")
    missing_temporary_directory = tmp_path / "never-created"
    with pytest.raises(FileNotFoundError):
        export._swap_into_place(missing_temporary_directory, output)
    assert (output / "keep.txt").read_text(encoding="utf-8") == "previous"
    assert hidden_names(tmp_path) == []


def test_event_counts_by_marker_count_player_and_bot_events(tmp_path: Path) -> None:
    rows: list[Row] = [
        (1.0, 2.0, 100, "Position"),
        (1.0, 2.0, 101, "Kill"),
        (1.0, 2.0, 102, "BotKill"),
        (1.0, 2.0, 103, "Loot"),
    ]
    drop = build_input(tmp_path, rows)
    bot_rows: list[Row] = [(1.0, 2.0, 100, "BotPosition"), (1.0, 2.0, 105, "BotKill")]
    write_raw_file(drop / "February_10", "1234", MATCH_ID, "Lockdown", bot_rows)
    output = tmp_path / "out"
    run_write(drop, output)
    manifest_match = read_json(output / "manifest.json")["matches"][0]
    assert manifest_match["eventCountsByMarker"] == {
        "kill_player": 1,
        "kill_bot": 1,
        "loot": 1,
        "bot_kill": 1,
    }
    assert (manifest_match["playerCount"], manifest_match["botCount"]) == (1, 1)


def test_rows_fed_out_of_time_order_are_written_sorted_by_time(tmp_path: Path) -> None:
    rows: list[Row] = [
        (3.0, 0.0, 300, "Position"),
        (1.0, 0.0, 100, "Position"),
        (2.0, 0.0, 200, "Position"),
    ]
    output = tmp_path / "out"
    run_write(build_input(tmp_path, rows), output)
    day_file_match = next(iter(output.glob("days/Lockdown/*.json")))
    actor = read_json(day_file_match)["matches"][0]["actors"][0]
    assert actor["timestampSeconds"] == [100, 200, 300]
    assert actor["worldX"] == [1.0, 2.0, 3.0]
