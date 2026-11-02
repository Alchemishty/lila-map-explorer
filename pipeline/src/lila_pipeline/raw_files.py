"""Discover and read raw telemetry parquet files. `player_data/` is never modified."""

import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from lila_pipeline.errors import DataContractError

DAY_FOLDER_PATTERN = re.compile(r"^[A-Za-z]+_\d+$")
MINIMAPS_FOLDER_NAME = "minimaps"
REQUIRED_COLUMNS = ("user_id", "match_id", "map_id", "x", "z", "ts", "event")
OUTPUT_COLUMNS = (
    "user_id",
    "match_id",
    "map_id",
    "world_x",
    "world_z",
    "timestamp_seconds",
    "event",
)


@dataclass(frozen=True)
class RawFile:
    day_folder: str
    file_name: str
    telemetry_rows: pd.DataFrame


def discover_raw_files(input_directory: Path) -> list[tuple[str, Path]]:
    if not input_directory.is_dir():
        raise FileNotFoundError(f"{input_directory}: input folder not found")
    day_folder_and_paths: list[tuple[str, Path]] = []
    problems: list[str] = []
    for folder in input_directory.iterdir():
        # Skip hidden entries: macOS `.DS_Store` and `._` files on external drives
        # are not telemetry.
        if folder.name.startswith(".") or not folder.is_dir():
            continue
        if folder.name == MINIMAPS_FOLDER_NAME:
            continue
        if not DAY_FOLDER_PATTERN.match(folder.name):
            problems.append(
                f"{folder.name}: unexpected folder in the input "
                f"(expected a day folder like February_10, or {MINIMAPS_FOLDER_NAME})"
            )
            continue
        for path in folder.iterdir():
            # Same reason as above: hidden files inside a day folder are not telemetry.
            if path.name.startswith("."):
                continue
            if not path.is_file():
                problems.append(
                    f"{folder.name}/{path.name}: unexpected folder inside a day folder "
                    "(telemetry files must sit directly in the day folder)"
                )
                continue
            day_folder_and_paths.append((folder.name, path))
    if problems:
        raise DataContractError(sorted(problems))
    return sorted(day_folder_and_paths, key=lambda item: (item[0], item[1].name))


def read_raw_file(path: Path, day_folder: str) -> RawFile:
    where = f"{day_folder}/{path.name}"
    try:
        table = pq.read_table(path)
    except (pa.ArrowException, OSError) as error:
        raise DataContractError(
            [f"{where}: could not be read as a parquet file ({error})"]
        ) from error
    missing_columns = [name for name in REQUIRED_COLUMNS if name not in table.column_names]
    if missing_columns:
        raise DataContractError([f"{where}: missing columns {missing_columns}"])
    # `ts` is typed timestamp[ms] but holds epoch SECONDS: cast to int64, never divide.
    timestamp_seconds = pc.cast(table.column("ts"), pa.int64())
    event_text = pc.cast(table.column("event"), pa.string())
    telemetry_rows = pd.DataFrame(
        {
            "user_id": table.column("user_id").to_pandas(),
            "match_id": table.column("match_id").to_pandas(),
            "map_id": table.column("map_id").to_pandas(),
            "world_x": table.column("x").to_pandas(),
            "world_z": table.column("z").to_pandas(),
            "timestamp_seconds": timestamp_seconds.to_pandas(),
            "event": event_text.to_pandas(),
        }
    )[list(OUTPUT_COLUMNS)]
    return RawFile(day_folder=day_folder, file_name=path.name, telemetry_rows=telemetry_rows)


def read_all_raw_files(
    day_folder_and_paths: list[tuple[str, Path]],
) -> tuple[list[RawFile], list[str]]:
    """Read every file. Returns the files that read fine and one problem line per failure."""
    raw_files: list[RawFile] = []
    problems: list[str] = []
    for day_folder, path in day_folder_and_paths:
        try:
            raw_files.append(read_raw_file(path, day_folder))
        except DataContractError as error:
            problems.extend(error.problems)
    return raw_files, problems
