from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
import pytest

from fixtures import write_raw_file
from lila_pipeline.clean import clean_dataset
from lila_pipeline.errors import DataContractError
from lila_pipeline.raw_files import RawFile, read_raw_file

HUMAN_ID = "f4e072fa-b7af-4761-b567-1d95b7ad0108"
OTHER_HUMAN_ID = "a1e072fa-b7af-4761-b567-1d95b7ad0109"
MATCH_ID = "3731eba6-1111-2222-3333-444444444444.nakama-0"
Row = tuple[float, float, int, str]


def load_raw_file(
    tmp_path: Path,
    rows: list[Row],
    user_id: str = HUMAN_ID,
    day_folder: str = "February_10",
    match_id: str = MATCH_ID,
) -> RawFile:
    path = write_raw_file(tmp_path / day_folder, user_id, match_id, "Lockdown", rows)
    return read_raw_file(path, day_folder)


def epoch_seconds_from_iso_utc(text: str) -> int:
    return int(datetime.fromisoformat(text).replace(tzinfo=UTC).timestamp())


def test_same_user_match_in_two_day_folders_keeps_first_copy(tmp_path: Path) -> None:
    rows: list[Row] = [(1.0, 2.0, 100, "Position"), (3.0, 4.0, 101, "Position")]
    first_copy = load_raw_file(tmp_path, rows, day_folder="February_10")
    second_copy = load_raw_file(tmp_path, rows, day_folder="February_11")
    result = clean_dataset([second_copy, first_copy])
    assert len(result.cleaned_rows) == 2
    assert result.report.duplicate_file_rows_dropped == 2
    assert result.report.files_read == 2


def test_earliest_day_folder_is_the_retained_copy_whatever_the_input_order(
    tmp_path: Path,
) -> None:
    rows: list[Row] = [(1.0, 2.0, 100, "Position"), (3.0, 4.0, 101, "Position")]
    changed_rows: list[Row] = [(1.0, 2.0, 100, "Position"), (9.0, 4.0, 101, "Position")]
    earliest_copy = load_raw_file(tmp_path, rows, day_folder="February_10")
    middle_copy = load_raw_file(tmp_path, rows, day_folder="February_11")
    latest_changed_copy = load_raw_file(tmp_path, changed_rows, day_folder="February_12")
    with pytest.raises(DataContractError) as error:
        clean_dataset([latest_changed_copy, middle_copy, earliest_copy])
    file_name = earliest_copy.file_name
    assert error.value.problems == [
        f"February_12/{file_name}: same user and match as February_10/{file_name} "
        "but different contents"
    ]


def test_second_copy_with_different_contents_raises(tmp_path: Path) -> None:
    first_rows: list[Row] = [(1.0, 2.0, 100, "Position"), (3.0, 4.0, 101, "Position")]
    second_rows: list[Row] = [(1.0, 2.0, 100, "Position"), (3.5, 4.0, 101, "Position")]
    first_copy = load_raw_file(tmp_path, first_rows, day_folder="February_10")
    second_copy = load_raw_file(tmp_path, second_rows, day_folder="February_11")
    with pytest.raises(DataContractError) as error:
        clean_dataset([first_copy, second_copy])
    file_name = first_copy.file_name
    assert error.value.problems == [
        f"February_11/{file_name}: same user and match as February_10/{file_name} "
        "but different contents"
    ]


def test_no_files_raises() -> None:
    with pytest.raises(DataContractError) as error:
        clean_dataset([])
    assert error.value.problems == ["no telemetry files to clean"]


def test_session_repeated_as_block_drops_second_half(tmp_path: Path) -> None:
    row_one = (1.0, 1.0, 100, "Position")
    row_two = (2.0, 2.0, 101, "Position")
    row_three = (3.0, 3.0, 102, "Loot")
    rows = [row_one, row_two, row_three, row_one, row_two, row_three]
    result = clean_dataset([load_raw_file(tmp_path, rows)])
    assert list(result.cleaned_rows["world_x"]) == [1.0, 2.0, 3.0]
    assert result.report.duplicate_block_rows_dropped == 3


def test_odd_length_file_that_looks_repeated_is_not_halved(tmp_path: Path) -> None:
    row_a = (1.0, 1.0, 100, "Position")
    row_b = (2.0, 2.0, 101, "Position")
    result = clean_dataset([load_raw_file(tmp_path, [row_a, row_b, row_a])])
    assert list(result.cleaned_rows["world_x"]) == [1.0, 1.0, 2.0]
    assert result.report.duplicate_block_rows_dropped == 0


def test_two_identical_rows_are_a_doubled_block_and_are_halved(tmp_path: Path) -> None:
    row_a = (1.0, 1.0, 100, "Position")
    result = clean_dataset([load_raw_file(tmp_path, [row_a, row_a])])
    assert len(result.cleaned_rows) == 1
    assert result.report.duplicate_block_rows_dropped == 1


def test_three_identical_position_rows_are_all_kept(tmp_path: Path) -> None:
    row_a = (1.0, 1.0, 100, "Position")
    result = clean_dataset([load_raw_file(tmp_path, [row_a, row_a, row_a])])
    assert len(result.cleaned_rows) == 3
    assert result.report.duplicate_block_rows_dropped == 0
    assert result.report.duplicate_botkilled_rows_dropped == 0
    assert result.report.same_tick_repeat_rows == 0


def test_three_identical_botkill_rows_are_kept_and_two_flagged(tmp_path: Path) -> None:
    kill = (1.0, 1.0, 100, "BotKill")
    result = clean_dataset(
        [load_raw_file(tmp_path, [(0.0, 0.0, 99, "Position"), kill, kill, kill])]
    )
    assert len(result.cleaned_rows) == 4
    assert result.report.same_tick_repeat_rows == 2
    assert result.report.duplicate_botkilled_rows_dropped == 0


def test_three_identical_botkilled_rows_keep_only_the_first(tmp_path: Path) -> None:
    death = (1.0, 1.0, 100, "BotKilled")
    rows = [(0.0, 0.0, 99, "Position"), death, death, death]
    result = clean_dataset([load_raw_file(tmp_path, rows)])
    assert len(result.cleaned_rows) == 2
    assert result.report.duplicate_botkilled_rows_dropped == 2
    assert result.report.duplicate_block_rows_dropped == 0


def test_doubled_block_containing_botkilled_counts_only_as_block_rows(tmp_path: Path) -> None:
    position = (0.0, 0.0, 99, "Position")
    death = (1.0, 1.0, 100, "BotKilled")
    result = clean_dataset([load_raw_file(tmp_path, [position, death, position, death])])
    assert len(result.cleaned_rows) == 2
    assert result.report.duplicate_block_rows_dropped == 2
    assert result.report.duplicate_botkilled_rows_dropped == 0


def test_repeated_botkilled_dropped_but_botkill_kept_and_flagged(tmp_path: Path) -> None:
    rows: list[Row] = [
        (1.0, 1.0, 100, "BotKill"),
        (1.0, 1.0, 100, "BotKill"),
        (2.0, 2.0, 101, "BotKilled"),
        (2.0, 2.0, 101, "BotKilled"),
    ]
    # Odd split so the block rule does not apply: add a distinct row.
    rows.append((9.0, 9.0, 102, "Position"))
    result = clean_dataset([load_raw_file(tmp_path, rows)])
    cleaned_rows = result.cleaned_rows
    kills = cleaned_rows[cleaned_rows["event"] == "BotKill"]
    assert len(kills) == 2
    assert int(kills["is_same_tick_repeat"].sum()) == 1
    assert len(cleaned_rows[cleaned_rows["event"] == "BotKilled"]) == 1
    assert result.report.duplicate_botkilled_rows_dropped == 1
    assert result.report.same_tick_repeat_rows == 1


def test_repeated_loot_kept_unflagged(tmp_path: Path) -> None:
    rows: list[Row] = [
        (1.0, 1.0, 100, "Loot"),
        (1.0, 1.0, 100, "Loot"),
        (5.0, 5.0, 101, "Position"),
    ]
    result = clean_dataset([load_raw_file(tmp_path, rows)])
    assert len(result.cleaned_rows) == 3
    assert not result.cleaned_rows["is_same_tick_repeat"].any()


def test_rows_sorted_by_time_within_file_stably(tmp_path: Path) -> None:
    rows: list[Row] = [
        (1.0, 0.0, 105, "Position"),
        (2.0, 0.0, 100, "Position"),
        (3.0, 0.0, 105, "Loot"),
        (4.0, 0.0, 100, "Loot"),
    ]
    result = clean_dataset([load_raw_file(tmp_path, rows)])
    assert list(result.cleaned_rows["world_x"]) == [2.0, 4.0, 1.0, 3.0]


def test_day_utc_is_match_start_date_for_all_actors(tmp_path: Path) -> None:
    late_timestamp_seconds = epoch_seconds_from_iso_utc("2026-02-09T23:58:00")
    early_timestamp_seconds = epoch_seconds_from_iso_utc("2026-02-10T00:05:00")
    late_file = load_raw_file(
        tmp_path, [(1.0, 1.0, late_timestamp_seconds, "Position")], user_id=HUMAN_ID
    )
    early_file = load_raw_file(
        tmp_path, [(2.0, 2.0, early_timestamp_seconds, "Position")], user_id=OTHER_HUMAN_ID
    )
    result = clean_dataset([late_file, early_file])
    assert set(result.cleaned_rows["day_utc"]) == {"2026-02-09"}
    assert len(result.cleaned_rows) == 2


def test_output_columns_and_actor_key(tmp_path: Path) -> None:
    result = clean_dataset([load_raw_file(tmp_path, [(1.0, 1.0, 100, "Position")], user_id="1429")])
    assert list(result.cleaned_rows.columns) == [
        "match_id", "map_id", "actor_key", "user_id", "actor_type", "world_x", "world_z",
        "timestamp_seconds", "event", "is_same_tick_repeat", "day_utc",
    ]  # fmt: skip
    assert result.cleaned_rows["actor_key"].iloc[0] == "misid-1429-3731eba6"
    assert result.cleaned_rows["actor_type"].iloc[0] == "human_misid"
    assert isinstance(result.cleaned_rows, pd.DataFrame)
