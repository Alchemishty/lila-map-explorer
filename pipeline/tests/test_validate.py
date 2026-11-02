from pathlib import Path

import pandas as pd
import pytest

from fixtures import write_drop_folder, write_raw_file
from lila_pipeline.classify import FileLabel, classify_file
from lila_pipeline.config import EventConfig, EventRule, MapConfig
from lila_pipeline.errors import DataContractError
from lila_pipeline.raw_files import RawFile, read_raw_file
from lila_pipeline.validate import (
    find_all_problems,
    find_file_problems,
    find_match_map_conflict_problems,
)

HUMAN_ID = "f4e072fa-b7af-4761-b567-1d95b7ad0108"
MATCH_ID = "3731eba6-1111-2222-3333-444444444444.nakama-0"
MAP_CONFIGS_BY_ID = {"Lockdown": MapConfig("Lockdown", "Lockdown_Minimap.jpg", 1000, -500, -500)}
POSITION_RULE = EventRule("position", "none", None)
EVENT_CONFIG = EventConfig(
    player_rules_by_event_name={"Position": POSITION_RULE, "Kill": POSITION_RULE},
    bot_rules_by_event_name={"BotPosition": POSITION_RULE},
    markers_by_key={},
    raw_json_content={},
)
PLAYER_LABEL = FileLabel("player", "human", HUMAN_ID)
BOT_LABEL = FileLabel("bot", "bot", "1429")
# Two rows a minute apart: a match needs a length above 0 (see test_match_length.py).
GOOD_ROWS: list[tuple[float, float, int, str]] = [
    (0.0, 0.0, 100, "Position"),
    (1.0, 1.0, 160, "Position"),
]
WHERE = f"February_10/{HUMAN_ID}_{MATCH_ID}"
FILE_NAME_HINT = "(expected {user_id}_{match_id})"


def load_raw_file(
    tmp_path: Path,
    rows: list[tuple[float, float, int, str]] = GOOD_ROWS,
    user_id: str = HUMAN_ID,
    map_id: str = "Lockdown",
) -> RawFile:
    path = write_raw_file(tmp_path / "February_10", user_id, MATCH_ID, map_id, rows)
    return read_raw_file(path, "February_10")


def make_raw(rows: pd.DataFrame, file_name: str = f"{HUMAN_ID}_{MATCH_ID}") -> RawFile:
    return RawFile("February_10", file_name, rows)


def build_rows_frame(**overrides: list[object]) -> pd.DataFrame:
    base_columns: dict[str, list[object]] = {
        "user_id": [HUMAN_ID, HUMAN_ID],
        "match_id": [MATCH_ID, MATCH_ID],
        "map_id": ["Lockdown", "Lockdown"],
        "world_x": [0.0, 1.0],
        "world_z": [0.0, 1.0],
        "timestamp_seconds": [1, 2],
        "event": ["Position", "Position"],
    }
    base_columns.update(overrides)
    return pd.DataFrame(base_columns)


def problems_for(raw_file: RawFile, label: FileLabel = PLAYER_LABEL) -> list[str]:
    return find_file_problems(raw_file, label, MAP_CONFIGS_BY_ID, EVENT_CONFIG)


def test_clean_file_has_no_problems(tmp_path: Path) -> None:
    assert problems_for(load_raw_file(tmp_path)) == []


def test_more_than_one_user() -> None:
    result = problems_for(make_raw(build_rows_frame(user_id=[HUMAN_ID, "other"])))
    assert result == [f"{WHERE}: more than one user_id in the file"]


def test_more_than_one_match() -> None:
    result = problems_for(make_raw(build_rows_frame(match_id=[MATCH_ID, "other"])))
    assert result == [f"{WHERE}: more than one match_id in the file"]


def test_more_than_one_map() -> None:
    result = problems_for(make_raw(build_rows_frame(map_id=["Lockdown", "GrandRift"])))
    assert result == [
        f"{WHERE}: more than one map_id in the file",
        f"{WHERE}: map 'GrandRift' has no entry in maps.json",
    ]


def test_user_id_not_matching_filename() -> None:
    raw_file = make_raw(build_rows_frame(), file_name=f"someone-else_{MATCH_ID}")
    assert problems_for(raw_file) == [
        f"February_10/someone-else_{MATCH_ID}: user_id '{HUMAN_ID}' "
        f"does not match the file name {FILE_NAME_HINT}"
    ]


def test_filename_without_underscore_says_form_is_wrong() -> None:
    raw_file = make_raw(build_rows_frame(), file_name="nounderscore")
    assert problems_for(raw_file) == [
        "February_10/nounderscore: file name is not in {user_id}_{match_id} form"
    ]


def test_match_id_not_matching_filename() -> None:
    raw_file = make_raw(build_rows_frame(), file_name=f"{HUMAN_ID}_other-match")
    assert problems_for(raw_file) == [
        f"February_10/{HUMAN_ID}_other-match: match_id '{MATCH_ID}' "
        f"does not match the file name {FILE_NAME_HINT}"
    ]


def test_filename_with_real_naming_matches() -> None:
    assert problems_for(make_raw(build_rows_frame(), file_name=f"{HUMAN_ID}_{MATCH_ID}")) == []


def test_doubled_suffix_filename_is_flagged() -> None:
    raw_file = make_raw(build_rows_frame(), file_name=f"{HUMAN_ID}_{MATCH_ID}.nakama-0")
    assert problems_for(raw_file) == [
        f"February_10/{HUMAN_ID}_{MATCH_ID}.nakama-0: match_id '{MATCH_ID}' "
        f"does not match the file name {FILE_NAME_HINT}"
    ]


def test_numeric_user_filename_matches() -> None:
    raw_file = make_raw(
        build_rows_frame(user_id=["1429", "1429"], event=["BotPosition", "BotPosition"]),
        file_name=f"1429_{MATCH_ID}",
    )
    assert problems_for(raw_file, BOT_LABEL) == []


def test_unknown_map(tmp_path: Path) -> None:
    result = problems_for(load_raw_file(tmp_path, map_id="Nowhere"))
    assert result == [f"{WHERE}: map 'Nowhere' has no entry in maps.json"]


def test_unknown_player_event(tmp_path: Path) -> None:
    result = problems_for(load_raw_file(tmp_path, [(0.0, 0.0, 1, "Extract")]))
    assert result == [f"{WHERE}: unknown event 'Extract' for a player file"]


def test_event_valid_for_other_path_type_is_unknown_for_bot(tmp_path: Path) -> None:
    result = problems_for(load_raw_file(tmp_path, [(0.0, 0.0, 1, "Position")]), BOT_LABEL)
    assert result == [f"{WHERE}: unknown event 'Position' for a bot file"]


def test_points_outside_minimap(tmp_path: Path) -> None:
    rows = [(0.0, 0.0, 1, "Position"), (600.0, 0.0, 2, "Position"), (0.0, -501.0, 3, "Position")]
    result = problems_for(load_raw_file(tmp_path, rows))
    assert result == [
        f"{WHERE}: 2 point(s) outside the minimap; first at world_x=600.0, world_z=0.0"
    ]


def test_point_exactly_on_edge_is_valid(tmp_path: Path) -> None:
    rows = [(500.0, -500.0, 1, "Position"), (-500.0, 500.0, 2, "Position")]  # u=1,v=0 / u=0,v=1
    assert problems_for(load_raw_file(tmp_path, rows)) == []


def test_empty_file() -> None:
    result = problems_for(make_raw(build_rows_frame().iloc[0:0]))
    assert result == [f"{WHERE}: file has no rows"]


def test_missing_values_reported_per_column() -> None:
    raw_file = make_raw(build_rows_frame(world_x=[None, 1.0], event=["Position", None]))
    assert problems_for(raw_file) == [
        f"{WHERE}: 1 row(s) have missing values in 'world_x'",
        f"{WHERE}: 1 row(s) have missing values in 'event'",
    ]


def test_missing_timestamp_is_detected_after_reading() -> None:
    raw_file = make_raw(build_rows_frame(timestamp_seconds=[1.0, float("nan")]))
    assert problems_for(raw_file) == [
        f"{WHERE}: 1 row(s) have missing values in 'timestamp_seconds'"
    ]


def test_all_problems_reported_together(tmp_path: Path) -> None:
    minimap_directory = write_drop_folder(tmp_path / "drop") / "minimaps"
    bad_map_file = load_raw_file(tmp_path, map_id="Nowhere")
    bad_event_file = load_raw_file(tmp_path / "b", [(0.0, 0.0, 1, "Extract")], user_id="x")
    labels = [PLAYER_LABEL, PLAYER_LABEL]
    problems = find_all_problems(
        [bad_map_file, bad_event_file],
        labels,
        MAP_CONFIGS_BY_ID,
        EVENT_CONFIG,
        minimap_directory,
    )
    assert problems == [
        f"{WHERE}: map 'Nowhere' has no entry in maps.json",
        f"February_10/x_{MATCH_ID}: unknown event 'Extract' for a player file",
        f"{WHERE}, February_10/x_{MATCH_ID}: match '{MATCH_ID}' has files on more than one map: "
        f"'Lockdown' in February_10/x_{MATCH_ID}; 'Nowhere' in {WHERE}. "
        "Every file of a match must name the same map.",
    ]


def test_unclassifiable_files_become_collected_problems(tmp_path: Path) -> None:
    minimap_directory = write_drop_folder(tmp_path / "drop") / "minimaps"
    mixed = load_raw_file(tmp_path, [(0.0, 0.0, 1, "Position"), (0.0, 0.0, 2, "BotPosition")])
    empty = make_raw(build_rows_frame().iloc[0:0], file_name="empty_file")
    problems = find_all_problems(
        [mixed, empty], [None, None], MAP_CONFIGS_BY_ID, EVENT_CONFIG, minimap_directory
    )
    assert problems == [
        f"{WHERE}: mixes player and bot position events",
        "February_10/empty_file: file has no rows",
    ]


def test_missing_minimap_image_is_a_problem(tmp_path: Path) -> None:
    minimap_directory = write_drop_folder(tmp_path / "drop") / "minimaps"
    (minimap_directory / "Lockdown_Minimap.jpg").unlink()
    raw_file = load_raw_file(tmp_path)
    problems = find_all_problems(
        [raw_file],
        [classify_file(raw_file)],
        MAP_CONFIGS_BY_ID,
        EVENT_CONFIG,
        minimap_directory,
    )
    assert problems == [
        f"{minimap_directory / 'Lockdown_Minimap.jpg'}: minimap image for map 'Lockdown' not found"
    ]


def test_find_all_problems_is_empty_for_clean_data(tmp_path: Path) -> None:
    minimap_directory = write_drop_folder(tmp_path / "drop") / "minimaps"
    raw_file = load_raw_file(tmp_path)
    assert (
        find_all_problems(
            [raw_file],
            [classify_file(raw_file)],
            MAP_CONFIGS_BY_ID,
            EVENT_CONFIG,
            minimap_directory,
        )
        == []
    )


def test_find_all_problems_rejects_mismatched_label_count(tmp_path: Path) -> None:
    minimap_directory = write_drop_folder(tmp_path / "drop") / "minimaps"
    with pytest.raises(
        ValueError, match="find_all_problems: raw_files and labels must have the same length"
    ):
        find_all_problems(
            [load_raw_file(tmp_path)], [], MAP_CONFIGS_BY_ID, EVENT_CONFIG, minimap_directory
        )


def test_error_message_is_plain_language() -> None:
    error = DataContractError(["a/b: first", "c/d: second"])
    assert str(error) == (
        "Build stopped: 2 problem(s) found in the data:\n  - a/b: first\n  - c/d: second"
    )


def test_match_whose_files_name_different_maps_fails_the_build(tmp_path: Path) -> None:
    minimap_directory = write_drop_folder(tmp_path / "drop") / "minimaps"
    lockdown_file = load_raw_file(tmp_path)
    grand_rift_file = load_raw_file(tmp_path, user_id="1429", map_id="GrandRift")
    map_configs_by_id = {
        **MAP_CONFIGS_BY_ID,
        "GrandRift": MapConfig("GrandRift", "GrandRift_Minimap.png", 581, -290, -290),
    }
    problems = find_all_problems(
        [lockdown_file, grand_rift_file],
        [PLAYER_LABEL, PLAYER_LABEL],
        map_configs_by_id,
        EVENT_CONFIG,
        minimap_directory,
    )
    assert problems == [
        f"February_10/1429_{MATCH_ID}, {WHERE}: match '{MATCH_ID}' has files on more than one "
        f"map: 'GrandRift' in February_10/1429_{MATCH_ID}; 'Lockdown' in {WHERE}. "
        "Every file of a match must name the same map."
    ]


def test_files_of_one_match_on_one_map_have_no_map_conflict(tmp_path: Path) -> None:
    files = [load_raw_file(tmp_path, user_id=user_id) for user_id in (HUMAN_ID, "1429", "x")]
    assert find_match_map_conflict_problems(files) == []


def test_two_maps_inside_one_file_is_left_to_the_per_file_check() -> None:
    two_map_file = make_raw(build_rows_frame(map_id=["Lockdown", "GrandRift"]))
    assert find_match_map_conflict_problems([two_map_file]) == []
