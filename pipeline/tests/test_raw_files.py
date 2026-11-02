from pathlib import Path

import pytest

from fixtures import write_drop_folder, write_raw_file
from lila_pipeline.errors import DataContractError
from lila_pipeline.raw_files import discover_raw_files, read_all_raw_files, read_raw_file


def test_read_raw_file_reads_seconds_and_decodes_events(tmp_path: Path) -> None:
    path = write_raw_file(
        tmp_path,
        "user-1",
        "match-1",
        "Lockdown",
        [(1.5, -2.25, 1770727161, "Position"), (3.0, 4.0, 1770727166, "Loot")],
    )
    raw_file = read_raw_file(path, "February_10")
    assert raw_file.day_folder == "February_10"
    assert raw_file.file_name == path.name
    assert list(raw_file.telemetry_rows.columns) == [
        "user_id",
        "match_id",
        "map_id",
        "world_x",
        "world_z",
        "timestamp_seconds",
        "event",
    ]
    assert raw_file.telemetry_rows["timestamp_seconds"].tolist() == [1770727161, 1770727166]
    assert str(raw_file.telemetry_rows["timestamp_seconds"].dtype) == "int64"
    assert raw_file.telemetry_rows["event"].tolist() == ["Position", "Loot"]
    assert raw_file.telemetry_rows["world_x"].tolist() == [1.5, 3.0]
    assert raw_file.telemetry_rows["world_z"].tolist() == [-2.25, 4.0]


def test_read_raw_file_names_day_folder_and_file_when_unreadable(tmp_path: Path) -> None:
    bad_path = tmp_path / "broken.nakama-0"
    bad_path.write_bytes(b"not parquet")
    with pytest.raises(DataContractError) as error:
        read_raw_file(bad_path, "February_10")
    assert len(error.value.problems) == 1
    assert error.value.problems[0].startswith(
        "February_10/broken.nakama-0: could not be read as a parquet file ("
    )


def test_read_raw_file_names_missing_columns(tmp_path: Path) -> None:
    import pyarrow as pa
    import pyarrow.parquet as pq

    path = tmp_path / "narrow.nakama-0"
    pq.write_table(pa.table({"user_id": ["u"]}), path)
    with pytest.raises(DataContractError) as error:
        read_raw_file(path, "February_10")
    assert error.value.problems == [
        "February_10/narrow.nakama-0: missing columns "
        "['match_id', 'map_id', 'x', 'z', 'ts', 'event']"
    ]


def test_read_all_raw_files_collects_every_failure(tmp_path: Path) -> None:
    good_path = write_raw_file(
        tmp_path / "February_10", "u", "m", "Lockdown", [(0.0, 0.0, 1, "Position")]
    )
    first_bad_path = tmp_path / "February_10" / "bad_one"
    second_bad_path = tmp_path / "February_11" / "bad_two"
    second_bad_path.parent.mkdir()
    first_bad_path.write_bytes(b"not parquet")
    second_bad_path.write_bytes(b"also not parquet")
    raw_files, problems = read_all_raw_files(
        [
            ("February_10", first_bad_path),
            ("February_10", good_path),
            ("February_11", second_bad_path),
        ]
    )
    assert [raw_file.file_name for raw_file in raw_files] == [good_path.name]
    assert len(problems) == 2
    assert problems[0].startswith("February_10/bad_one: could not be read as a parquet file")
    assert problems[1].startswith("February_11/bad_two: could not be read as a parquet file")


def test_discover_skips_minimaps_top_level_files_and_dotfiles(tmp_path: Path) -> None:
    write_drop_folder(tmp_path)
    (tmp_path / "README.md").write_text("notes", encoding="utf-8")
    one_row = [(0.0, 0.0, 1, "Position")]
    second_path = write_raw_file(tmp_path / "February_11", "u", "m", "Lockdown", one_row)
    first_b_path = write_raw_file(tmp_path / "February_10", "b", "m", "Lockdown", one_row)
    first_a_path = write_raw_file(tmp_path / "February_10", "a", "m", "Lockdown", one_row)
    (tmp_path / "February_10" / ".DS_Store").write_bytes(b"x")
    (tmp_path / ".hidden_1").mkdir()
    discovered_day_folders_and_paths = discover_raw_files(tmp_path)
    assert discovered_day_folders_and_paths == [
        ("February_10", first_a_path),
        ("February_10", first_b_path),
        ("February_11", second_path),
    ]


def test_discover_fails_on_unexpected_folder(tmp_path: Path) -> None:
    write_drop_folder(tmp_path)
    write_raw_file(tmp_path / "February_10", "u", "m", "Lockdown", [(0.0, 0.0, 1, "Position")])
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "ignored").write_bytes(b"x")
    with pytest.raises(DataContractError) as error:
        discover_raw_files(tmp_path)
    assert error.value.problems == [
        "notes: unexpected folder in the input "
        "(expected a day folder like February_10, or minimaps)"
    ]


def test_discover_fails_on_folder_inside_a_day_folder(tmp_path: Path) -> None:
    write_drop_folder(tmp_path)
    write_raw_file(tmp_path / "February_10", "u", "m", "Lockdown", [(0.0, 0.0, 1, "Position")])
    write_raw_file(
        tmp_path / "February_10" / "late_upload", "v", "m", "Lockdown", [(0, 0, 1, "Position")]
    )
    (tmp_path / "February_10" / ".hidden_folder").mkdir()
    with pytest.raises(DataContractError) as error:
        discover_raw_files(tmp_path)
    assert error.value.problems == [
        "February_10/late_upload: unexpected folder inside a day folder "
        "(telemetry files must sit directly in the day folder)"
    ]


def test_discover_accepts_other_day_folder_names(tmp_path: Path) -> None:
    path = write_raw_file(tmp_path / "March_3", "u", "m", "Lockdown", [(0, 0, 1, "Position")])
    assert discover_raw_files(tmp_path) == [("March_3", path)]


def test_discover_fails_when_input_directory_missing(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="missing_directory"):
        discover_raw_files(tmp_path / "missing_directory")
