"""Investigation regressions: find contradictions without silently changing evidence."""

import json
from pathlib import Path

import pandas as pd
import pyarrow as arrow
import pyarrow.parquet as parquet
import pytest

from fixtures import write_drop_folder, write_raw_file
from lila_pipeline.telemetry_audit import build_audit_tables, build_event_position_distances
from lila_pipeline.telemetry_audit_cli import write_telemetry_audit


def audit_rows(events: list[tuple[int, float, float, str]]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "match_id": "match",
                "actor_key": "player",
                "user_id": "player",
                "actor_type": "human",
                "map_id": "AmbroseValley",
                "source_file": "February_10/player_match",
                "timestamp_seconds": seconds,
                "world_x": world_x,
                "world_z": world_z,
                "event": event,
                "is_same_tick_repeat": False,
            }
            for seconds, world_x, world_z, event in events
        ]
    )


def test_finds_pairs_post_death_and_same_second_disagreement_without_dropping_rows() -> None:
    rows = audit_rows(
        [
            (0, 0, 0, "Position"),
            (5, 10, 0, "Position"),
            (5, 11, 0, "Kill"),
            (5, 11, 0, "Killed"),
            (8, 11, 0, "BotKill"),
            (10, 11, 0, "Position"),
        ]
    )
    before = rows.copy(deep=True)
    tables = build_audit_tables(rows)
    pairs = tables["same_second_combat"]
    assert pairs[["event_kill", "event_death", "has_same_world_position"]].values.tolist() == [
        ["Kill", "Killed", True]
    ]
    assert tables["post_death_rows"].seconds_after_death.tolist() == [3, 5]
    assert tables["post_death_rows"].event.tolist() == ["BotKill", "Position"]
    assert tables["same_second_different_positions"].timestamp_seconds.tolist() == [5]
    assert tables["sessions"].traffic_seconds.tolist() == [5]
    pd.testing.assert_frame_equal(rows, before)


def test_long_death_tail_does_not_become_traffic_or_a_position_interval() -> None:
    tables = build_audit_tables(
        audit_rows(
            [
                (0, 0, 0, "Position"),
                (10, 2, 0, "Position"),
                (464, 2, 0, "KilledByStorm"),
            ]
        )
    )
    assert tables["sessions"].traffic_seconds.tolist() == [10]
    assert tables["sessions"].uncredited_tail_seconds.tolist() == [454]
    assert tables["long_position_gaps"].empty
    assert tables["event_position_leads"].nearest_position_gap_seconds.tolist() == [454]


def test_thresholds_are_strict_and_repeats_are_preserved() -> None:
    tables = build_audit_tables(
        audit_rows(
            [
                (0, 0, 0, "Position"),
                (5, 40, 0, "Position"),
                (10, 81, 0, "Position"),
                (10, 81, 0, "BotKill"),
                (10, 81, 0, "BotKill"),
                (40, 81, 0, "Position"),
                (71, 82, 0, "Position"),
            ]
        )
    )
    assert tables["fast_position_segments"].speed_world_units_per_second.tolist() == [8.2]
    assert tables["long_position_gaps"].duration_seconds.tolist() == [31]
    assert tables["repeated_event_groups"].event.tolist() == ["BotKill", "BotKill"]
    assert tables["sessions"].death_count.tolist() == [0]
    assert tables["sessions"].traffic_seconds.tolist() == [71]


def test_nearest_position_ties_use_minimum_distance_and_do_not_cross_actors() -> None:
    first = audit_rows([(0, 0, 0, "Position"), (5, 9, 0, "Loot"), (10, 10, 0, "Position")])
    second = audit_rows([(5, 100, 0, "Position"), (6, 100, 0, "Position")])
    second["actor_key"] = "other"
    distances = build_event_position_distances(pd.concat([first, second], ignore_index=True))
    assert distances.nearest_position_gap_seconds.tolist() == [5]
    assert distances.nearest_position_distance_world_units.tolist() == [1]


def test_position_only_and_one_position_sessions_are_valid() -> None:
    tables = build_audit_tables(audit_rows([(0, 0, 0, "Position")]))
    assert tables["event_position_leads"].empty
    assert tables["sessions"].traffic_seconds.tolist() == [0]
    with pytest.raises(ValueError, match="no cleaned rows"):
        build_audit_tables(pd.DataFrame())
    with pytest.raises(ValueError, match="February_10/player_match: no position samples"):
        build_event_position_distances(audit_rows([(0, 0, 0, "Loot")]))


def test_cli_validates_and_writes_traceable_inventory_without_touching_source(
    tmp_path: Path,
) -> None:
    source_directory = write_drop_folder(tmp_path / "input")
    source_file = write_raw_file(
        source_directory / "February_10",
        "player",
        "match",
        "AmbroseValley",
        [
            (0, 0, 1770700000, "Position"),
            (1.2345678, 0, 1770700005, "Position"),
            (1.2345678, 0, 1770700005, "Kill"),
            (1.2345678, 0, 1770700005, "Killed"),
        ],
    )
    original_bytes = source_file.read_bytes()
    output_directory = tmp_path / "audit"
    config_path = Path(__file__).resolve().parents[2] / "config/event_types.json"
    write_telemetry_audit(source_directory, config_path, output_directory)
    summary = json.loads((output_directory / "summary.json").read_text())
    assert summary["cleaned_rows"] == 4
    assert summary["player_traffic_seconds"] == 5
    inventory = pd.read_csv(output_directory / "raw_files.csv")
    assert inventory.source_file.tolist() == ["February_10/player_match"]
    assert inventory.raw_row_count.tolist() == [4]
    segments = pd.read_csv(output_directory / "sessions.csv")
    assert segments.traffic_seconds.tolist() == [5]
    pairs = pd.read_csv(output_directory / "same_second_combat.csv", float_precision="round_trip")
    assert pairs.world_x_kill.tolist() == [parquet.read_table(source_file).column("x")[1].as_py()]
    assert source_file.read_bytes() == original_bytes
    with pytest.raises(ValueError, match="outside the raw input"):
        write_telemetry_audit(source_directory, config_path, source_directory / "audit")


@pytest.mark.parametrize("is_bot", [False, True])
def test_cli_reports_absent_intervals_as_null_for_one_position_death(
    tmp_path: Path, is_bot: bool
) -> None:
    source_directory = write_drop_folder(tmp_path / "input")
    write_raw_file(
        source_directory / "February_10",
        "1429",
        "match",
        "AmbroseValley",
        [
            (0, 0, 1770700000, "BotPosition" if is_bot else "Position"),
            (0, 0, 1770700013, "BotKilled" if is_bot else "KilledByStorm"),
        ],
    )
    config_path = Path(__file__).resolve().parents[2] / "config/event_types.json"
    output_directory = tmp_path / "audit"
    write_telemetry_audit(source_directory, config_path, output_directory)
    summary = json.loads((output_directory / "summary.json").read_text())
    assert summary["maximum_position_gap_seconds"] is None
    assert summary["maximum_player_position_gap_seconds"] is None
    assert summary["player_sessions"] == (0 if is_bot else 1)
    assert summary["player_traffic_seconds"] == 0
    sessions = pd.read_csv(output_directory / "sessions.csv")
    assert sessions.death_count.tolist() == [1]
    assert sessions.uncredited_tail_seconds.tolist() == [13]


@pytest.mark.parametrize("elevation_value", [float("nan"), float("inf"), None])
def test_cli_rejects_bad_raw_elevation_before_writing_evidence(
    tmp_path: Path, elevation_value: float | None
) -> None:
    source_directory = write_drop_folder(tmp_path / "input")
    source_file = write_raw_file(
        source_directory / "February_10",
        "player",
        "match",
        "AmbroseValley",
        [(0, 0, 1770700000, "Position"), (1, 0, 1770700005, "Position")],
    )
    raw_table = parquet.read_table(source_file)
    if elevation_value is None:
        raw_table = raw_table.drop(["y"])
        expected_problem = "missing raw coordinate column y"
    else:
        raw_table = raw_table.set_column(
            raw_table.schema.get_field_index("y"),
            "y",
            arrow.array([elevation_value, elevation_value], type=arrow.float32()),
        )
        expected_problem = "non-finite raw coordinates in y"
    parquet.write_table(raw_table, source_file)
    output_directory = tmp_path / "audit"
    config_path = Path(__file__).resolve().parents[2] / "config/event_types.json"
    with pytest.raises(ValueError, match=f"February_10/player_match: {expected_problem}"):
        write_telemetry_audit(source_directory, config_path, output_directory)
    assert not output_directory.exists()
