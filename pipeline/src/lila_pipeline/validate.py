"""Data-contract validation: collect every problem in every file, then fail once."""

from collections.abc import Sequence
from pathlib import Path

import numpy as np
import pandas as pd

from lila_pipeline.classify import FileLabel, classify_file
from lila_pipeline.config import EventConfig, MapConfig
from lila_pipeline.errors import DataContractError
from lila_pipeline.raw_files import RawFile

CHECKED_COLUMNS = (
    "user_id",
    "match_id",
    "map_id",
    "world_x",
    "world_z",
    "timestamp_seconds",
    "event",
)


def _check_single_values(rows: pd.DataFrame, where: str) -> list[str]:
    problems: list[str] = []
    for column in ("user_id", "match_id", "map_id"):
        if rows[column].dropna().nunique() > 1:
            problems.append(f"{where}: more than one {column} in the file")
    return problems


def _check_filename(raw_file: RawFile, where: str) -> list[str]:
    user_part, separator, match_part = raw_file.file_name.partition("_")
    user_ids = raw_file.telemetry_rows["user_id"].dropna().unique()
    match_ids = raw_file.telemetry_rows["match_id"].dropna().unique()
    if not separator:
        if len(user_ids) == 1 or len(match_ids) == 1:
            return [f"{where}: file name is not in {{user_id}}_{{match_id}} form"]
        return []
    problems: list[str] = []
    if len(user_ids) == 1 and str(user_ids[0]) != user_part:
        problems.append(
            f"{where}: user_id '{user_ids[0]}' does not match the file name "
            "(expected {user_id}_{match_id})"
        )
    if len(match_ids) == 1 and match_part != str(match_ids[0]):
        problems.append(
            f"{where}: match_id '{match_ids[0]}' does not match the file name "
            "(expected {user_id}_{match_id})"
        )
    return problems


def _check_missing(rows: pd.DataFrame, where: str) -> list[str]:
    problems: list[str] = []
    for column in CHECKED_COLUMNS:
        missing_value_count = int(rows[column].isna().sum())
        if missing_value_count:
            problems.append(
                f"{where}: {missing_value_count} row(s) have missing values in '{column}'"
            )
    return problems


def _check_maps_and_bounds(
    rows: pd.DataFrame, map_configs_by_id: dict[str, MapConfig], where: str
) -> list[str]:
    problems: list[str] = []
    for map_id in sorted(str(value) for value in rows["map_id"].dropna().unique()):
        config = map_configs_by_id.get(map_id)
        if config is None:
            problems.append(f"{where}: map '{map_id}' has no entry in maps.json")
            continue
        map_rows = rows[rows["map_id"] == map_id].dropna(subset=["world_x", "world_z"])
        world_x = map_rows["world_x"].to_numpy(dtype=np.float64)
        world_z = map_rows["world_z"].to_numpy(dtype=np.float64)
        minimap_fraction_x = (world_x - config.world_origin_x) / config.world_scale
        minimap_fraction_y = (world_z - config.world_origin_z) / config.world_scale
        is_outside_minimap = (
            (minimap_fraction_x < 0)
            | (minimap_fraction_x > 1)
            | (minimap_fraction_y < 0)
            | (minimap_fraction_y > 1)
        )
        outside_point_count = int(is_outside_minimap.sum())
        if outside_point_count:
            first_outside_index = int(np.argmax(is_outside_minimap))
            problems.append(
                f"{where}: {outside_point_count} point(s) outside the minimap; "
                f"first at world_x={world_x[first_outside_index]}, "
                f"world_z={world_z[first_outside_index]}"
            )
    return problems


def _check_events(
    rows: pd.DataFrame, label: FileLabel, event_config: EventConfig, where: str
) -> list[str]:
    known_rules_by_event_name = (
        event_config.player_rules_by_event_name
        if label.path_type == "player"
        else event_config.bot_rules_by_event_name
    )
    unknown_event_names = sorted(
        str(event_name)
        for event_name in rows["event"].dropna().unique()
        if event_name not in known_rules_by_event_name
    )
    return [
        f"{where}: unknown event '{event_name}' for a {label.path_type} file"
        for event_name in unknown_event_names
    ]


def find_file_problems(
    raw_file: RawFile,
    label: FileLabel,
    map_configs_by_id: dict[str, MapConfig],
    event_config: EventConfig,
) -> list[str]:
    where = f"{raw_file.day_folder}/{raw_file.file_name}"
    rows = raw_file.telemetry_rows
    if rows.empty:
        return [f"{where}: file has no rows"]
    return [
        *_check_missing(rows, where),
        *_check_single_values(rows, where),
        *_check_filename(raw_file, where),
        *_check_maps_and_bounds(rows, map_configs_by_id, where),
        *_check_events(rows, label, event_config, where),
    ]


def find_missing_minimap_problems(
    raw_files: Sequence[RawFile],
    map_configs_by_id: dict[str, MapConfig],
    minimap_directory: Path,
) -> list[str]:
    """One problem per used map whose minimap image file is not in `minimap_directory`."""
    used_map_ids: set[str] = set()
    for raw_file in raw_files:
        used_map_ids.update(str(value) for value in raw_file.telemetry_rows["map_id"].dropna())
    problems: list[str] = []
    for map_id in sorted(used_map_ids):
        config = map_configs_by_id.get(map_id)
        if config is None:
            continue  # reported per file as a map with no maps.json entry
        image_path = minimap_directory / config.image_file
        if not image_path.is_file():
            problems.append(f"{image_path}: minimap image for map '{map_id}' not found")
    return problems


def find_zero_length_match_problems(raw_files: Sequence[RawFile]) -> list[str]:
    """One problem per match whose rows, across all its files, share one timestamp.

    The build derives a match's length as its latest row time minus its earliest, so such a match
    has length 0: events were recorded but their timestamps are wrong. Cleaning only drops
    duplicate rows, which share a kept row's timestamp, so raw rows give the same answer.
    Missing match ids or timestamps are reported by the per-file checks.
    """
    file_names_by_match_id: dict[str, list[str]] = {}
    distinct_timestamps_by_match_id: dict[str, set[int]] = {}
    row_count_by_match_id: dict[str, int] = {}
    for raw_file in raw_files:
        where = f"{raw_file.day_folder}/{raw_file.file_name}"
        dated_rows = raw_file.telemetry_rows.dropna(subset=["match_id", "timestamp_seconds"])
        for match_id, match_rows in dated_rows.groupby("match_id", sort=True):
            match_key = str(match_id)
            file_names_by_match_id.setdefault(match_key, []).append(where)
            distinct_timestamps_by_match_id.setdefault(match_key, set()).update(
                int(timestamp_seconds) for timestamp_seconds in match_rows["timestamp_seconds"]
            )
            previous_row_count = row_count_by_match_id.get(match_key, 0)
            row_count_by_match_id[match_key] = previous_row_count + len(match_rows)
    problems: list[str] = []
    for match_id in sorted(distinct_timestamps_by_match_id):
        distinct_timestamps = distinct_timestamps_by_match_id[match_id]
        if len(distinct_timestamps) != 1:
            continue  # valid path: the match spans more than one second
        only_timestamp_seconds = next(iter(distinct_timestamps))
        file_names = ", ".join(sorted(file_names_by_match_id[match_id]))
        row_count = row_count_by_match_id[match_id]
        row_count_text = "1 row" if row_count == 1 else f"{row_count} rows"
        problems.append(
            f"{file_names}: match '{match_id}' has every row ({row_count_text}) recorded at the "
            f"same second (timestamp {only_timestamp_seconds}), so its length is 0 s. Events "
            "were recorded but their timestamps are wrong."
        )
    return problems


def find_match_map_conflict_problems(raw_files: Sequence[RawFile]) -> list[str]:
    """One problem per match whose files, taken together, name more than one map.

    Rows with a missing match id or map id are reported by the per-file checks. A match whose
    only file names two maps is also reported there, so it is skipped here; once a second file
    is involved, the conflict is reported here too, naming every map and its files.
    """
    file_names_by_map_id_by_match_id: dict[str, dict[str, set[str]]] = {}
    for raw_file in raw_files:
        where = f"{raw_file.day_folder}/{raw_file.file_name}"
        mapped_rows = raw_file.telemetry_rows.dropna(subset=["match_id", "map_id"])
        for match_id, map_id in (
            mapped_rows[["match_id", "map_id"]].drop_duplicates().itertuples(index=False)
        ):
            file_names_by_map_id = file_names_by_map_id_by_match_id.setdefault(str(match_id), {})
            file_names_by_map_id.setdefault(str(map_id), set()).add(where)
    problems: list[str] = []
    for match_id in sorted(file_names_by_map_id_by_match_id):
        file_names_by_map_id = file_names_by_map_id_by_match_id[match_id]
        all_file_names = set().union(*file_names_by_map_id.values())
        if len(file_names_by_map_id) == 1 or len(all_file_names) == 1:
            continue  # valid path, or a single two-map file already reported per file
        map_descriptions = "; ".join(
            f"'{map_id}' in {', '.join(sorted(file_names_by_map_id[map_id]))}"
            for map_id in sorted(file_names_by_map_id)
        )
        problems.append(
            f"{', '.join(sorted(all_file_names))}: match '{match_id}' has files on more than one "
            f"map: {map_descriptions}. Every file of a match must name the same map."
        )
    return problems


def find_all_problems(
    raw_files: Sequence[RawFile],
    labels: Sequence[FileLabel | None],
    map_configs_by_id: dict[str, MapConfig],
    event_config: EventConfig,
    minimap_directory: Path,
) -> list[str]:
    """Every problem in every file, zero-length matches, matches on two maps, missing minimaps.

    A label of None is classified here.
    """
    if len(raw_files) != len(labels):
        raise ValueError("find_all_problems: raw_files and labels must have the same length")
    problems: list[str] = []
    for raw_file, given_label in zip(raw_files, labels, strict=True):
        label = given_label
        if label is None:
            try:
                label = classify_file(raw_file)
            except DataContractError as error:
                problems.extend(error.problems)
                continue
        problems.extend(find_file_problems(raw_file, label, map_configs_by_id, event_config))
    problems.extend(find_zero_length_match_problems(raw_files))
    problems.extend(find_match_map_conflict_problems(raw_files))
    problems.extend(find_missing_minimap_problems(raw_files, map_configs_by_id, minimap_directory))
    return problems
