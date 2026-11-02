"""Cleaning rules: duplicate files, doubled sessions, double-logged BotKilled, time order."""

from dataclasses import dataclass

import pandas as pd

from lila_pipeline.classify import classify_file
from lila_pipeline.errors import DataContractError
from lila_pipeline.raw_files import RawFile

DUPLICATE_KEY_COLUMNS = ["world_x", "world_z", "timestamp_seconds", "event"]
OUTPUT_COLUMNS = [
    "match_id", "map_id", "actor_key", "user_id", "actor_type", "world_x", "world_z",
    "timestamp_seconds", "event", "is_same_tick_repeat", "day_utc",
]  # fmt: skip


@dataclass(frozen=True)
class CleaningReport:
    files_read: int
    duplicate_file_rows_dropped: int
    duplicate_block_rows_dropped: int
    duplicate_botkilled_rows_dropped: int
    same_tick_repeat_rows: int


@dataclass(frozen=True)
class CleanDataset:
    cleaned_rows: pd.DataFrame
    report: CleaningReport


def _is_doubled_session(rows: pd.DataFrame) -> bool:
    """True when the first half of the file equals the second half, in file order."""
    row_count = len(rows)
    if row_count == 0 or row_count % 2 != 0:
        return False
    half_row_count = row_count // 2
    first_half_rows = rows.iloc[:half_row_count][DUPLICATE_KEY_COLUMNS].reset_index(drop=True)
    second_half_rows = rows.iloc[half_row_count:][DUPLICATE_KEY_COLUMNS].reset_index(drop=True)
    return bool(first_half_rows.equals(second_half_rows))


def clean_dataset(raw_files: list[RawFile]) -> CleanDataset:
    if not raw_files:
        raise DataContractError(["no telemetry files to clean"])
    ordered_files = sorted(
        raw_files, key=lambda raw_file: (raw_file.day_folder, raw_file.file_name)
    )
    first_copy_by_session_key: dict[tuple[str, str], RawFile] = {}
    duplicate_file_rows = 0
    duplicate_block_rows = 0
    duplicate_botkilled_rows = 0
    cleaned_frames: list[pd.DataFrame] = []

    for raw_file in ordered_files:
        label = classify_file(raw_file)
        rows = raw_file.telemetry_rows.reset_index(drop=True)
        session_key = (str(rows["user_id"].iloc[0]), str(rows["match_id"].iloc[0]))
        first_copy = first_copy_by_session_key.get(session_key)
        if first_copy is not None:
            if not first_copy.telemetry_rows.reset_index(drop=True).equals(rows):
                raise DataContractError(
                    [
                        f"{raw_file.day_folder}/{raw_file.file_name}: same user and match as "
                        f"{first_copy.day_folder}/{first_copy.file_name} but different contents"
                    ]
                )
            duplicate_file_rows += len(rows)
            continue
        first_copy_by_session_key[session_key] = raw_file
        if _is_doubled_session(rows):
            half_row_count = len(rows) // 2
            duplicate_block_rows += len(rows) - half_row_count
            rows = rows.iloc[:half_row_count].copy()
        else:
            rows = rows.copy()

        duplicate_index = rows.groupby(DUPLICATE_KEY_COLUMNS, sort=False).cumcount()
        is_repeat = duplicate_index > 0
        is_repeated_botkilled = (rows["event"] == "BotKilled") & is_repeat
        duplicate_botkilled_rows += int(is_repeated_botkilled.sum())
        rows["is_same_tick_repeat"] = (rows["event"] == "BotKill") & is_repeat
        rows = rows[~is_repeated_botkilled]
        rows = rows.sort_values("timestamp_seconds", kind="mergesort")
        rows["actor_key"] = label.player_key
        rows["actor_type"] = label.actor_type
        cleaned_frames.append(rows)

    combined = pd.concat(cleaned_frames, ignore_index=True)
    match_start_timestamp_seconds = combined.groupby("match_id")["timestamp_seconds"].min()
    match_start_datetime_utc = pd.to_datetime(match_start_timestamp_seconds, unit="s", utc=True)
    day_utc_by_match_id = match_start_datetime_utc.dt.strftime("%Y-%m-%d")
    combined["day_utc"] = combined["match_id"].map(day_utc_by_match_id)

    report = CleaningReport(
        files_read=len(ordered_files),
        duplicate_file_rows_dropped=duplicate_file_rows,
        duplicate_block_rows_dropped=duplicate_block_rows,
        duplicate_botkilled_rows_dropped=duplicate_botkilled_rows,
        same_tick_repeat_rows=int(combined["is_same_tick_repeat"].sum()),
    )
    return CleanDataset(cleaned_rows=combined[OUTPUT_COLUMNS].reset_index(drop=True), report=report)
