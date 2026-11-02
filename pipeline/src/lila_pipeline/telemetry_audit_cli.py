"""Reproduce the telemetry investigation without modifying raw files or app output.

Run from the project root:
  pipeline/.venv/bin/python -m lila_pipeline.telemetry_audit_cli --output /tmp/lila-audit
"""

import argparse
import hashlib
import json
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as parquet

from lila_pipeline.clean import clean_dataset
from lila_pipeline.config import load_event_config, load_map_configs
from lila_pipeline.errors import DataContractError
from lila_pipeline.raw_files import discover_raw_files, read_all_raw_files
from lila_pipeline.telemetry_audit import build_audit_tables, build_position_segments
from lila_pipeline.validate import find_all_problems


def write_telemetry_audit(
    input_directory: Path, event_config_path: Path, output_directory: Path
) -> None:
    """Validate first, then write the evidence inventory. No cleaning policy changes."""
    if input_directory.resolve() in [
        output_directory.resolve(),
        *output_directory.resolve().parents,
    ]:
        raise ValueError(
            f"{output_directory}: audit output must be outside the raw input directory"
        )
    raw_paths = discover_raw_files(input_directory)
    raw_files, read_problems = read_all_raw_files(raw_paths)
    map_configs = load_map_configs(input_directory / "maps.json")
    event_config = load_event_config(event_config_path)
    problems = [
        *read_problems,
        *find_all_problems(
            raw_files,
            [None] * len(raw_files),
            map_configs,
            event_config,
            input_directory / "minimaps",
        ),
    ]
    if problems:
        raise DataContractError(problems)
    dataset = clean_dataset(raw_files)
    source_files_by_session: dict[tuple[str, str], str] = {}
    source_records: list[dict[str, object]] = []
    for raw_file, (_, source_path) in zip(raw_files, raw_paths, strict=True):
        source_file = f"{raw_file.day_folder}/{raw_file.file_name}"
        source_rows = raw_file.telemetry_rows
        session_key = (str(source_rows.user_id.iloc[0]), str(source_rows.match_id.iloc[0]))
        is_duplicate_file = session_key in source_files_by_session
        if not is_duplicate_file:
            source_files_by_session[session_key] = source_file
        # The app intentionally ignores elevation; audit it for invalid raw values too.
        raw_table = parquet.read_table(source_path)
        for column in ["x", "y", "z"]:
            if column not in raw_table.column_names:
                raise ValueError(f"{source_file}: missing raw coordinate column {column}")
            if not np.isfinite(raw_table.column(column).to_numpy()).all():
                raise ValueError(f"{source_file}: non-finite raw coordinates in {column}")
        row_count = len(source_rows)
        half_row_count = row_count // 2
        has_doubled_session = row_count % 2 == 0 and source_rows.iloc[:half_row_count].reset_index(
            drop=True
        ).equals(source_rows.iloc[half_row_count:].reset_index(drop=True))
        first_day_utc = datetime.fromtimestamp(
            int(source_rows.timestamp_seconds.min()), UTC
        ).strftime("%Y-%m-%d")
        source_records.append(
            {
                "source_file": source_file,
                "sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
                "raw_row_count": row_count,
                "is_duplicate_file": is_duplicate_file,
                "has_doubled_session": has_doubled_session,
                "has_backward_timestamps": bool(source_rows.timestamp_seconds.diff().lt(0).any()),
                "first_day_utc": first_day_utc,
                "user_id": session_key[0],
                "match_id": session_key[1],
            }
        )
    rows = dataset.cleaned_rows.copy()
    # Widen before calculations/CSV serialization to preserve every source float32 bit.
    rows["world_x"] = rows.world_x.astype("float64")
    rows["world_z"] = rows.world_z.astype("float64")
    rows["source_file"] = [
        source_files_by_session[(user_id, match_id)]
        for user_id, match_id in zip(rows.user_id, rows.match_id, strict=True)
    ]
    tables = build_audit_tables(rows)
    tables["raw_files"] = pd.DataFrame(source_records)
    sessions = tables["sessions"]
    player_sessions = sessions[sessions.actor_type != "bot"]
    segments = build_position_segments(rows)
    player_count_by_match = player_sessions.groupby("match_id").size()
    player_segments = segments[segments.actor_type != "bot"]
    summary = {
        "cleaning": asdict(dataset.report),
        "raw_rows": sum(len(raw_file.telemetry_rows) for raw_file in raw_files),
        "cleaned_rows": len(rows),
        "matches": int(rows.match_id.nunique()),
        "player_sessions": len(player_sessions),
        "bot_sessions": int((sessions.actor_type == "bot").sum()),
        "matches_with_bot_tracks": int(rows[rows.actor_type == "bot"].match_id.nunique()),
        "matches_with_one_player": int((player_count_by_match == 1).sum()),
        "player_sessions_without_death": int((player_sessions.death_count == 0).sum()),
        "bot_sessions_without_death": int(
            ((sessions.actor_type == "bot") & (sessions.death_count == 0)).sum()
        ),
        "player_traffic_seconds": int(player_sessions.traffic_seconds.sum()),
        "player_uncredited_tail_seconds": int(player_sessions.uncredited_tail_seconds.sum()),
        "player_sessions_with_uncredited_tail": int(
            (player_sessions.uncredited_tail_seconds > 0).sum()
        ),
        # A one-position session has no interval; a bot-only drop has no player intervals.
        "maximum_position_gap_seconds": (
            None if segments.empty else int(segments.duration_seconds.max())
        ),
        "maximum_player_position_gap_seconds": (
            None if player_segments.empty else int(player_segments.duration_seconds.max())
        ),
        "events_by_actor_type": [
            {
                "actor_type": str(record["actor_type"]),
                "event": str(record["event"]),
                "count": int(record["count"]),
            }
            for record in rows.groupby(["actor_type", "event"])
            .size()
            .reset_index(name="count")
            .to_dict("records")
        ],
        "evidence_table_row_counts": {name: len(table) for name, table in tables.items()},
    }
    output_directory.mkdir(parents=True, exist_ok=True)
    for name, table in tables.items():
        table.to_csv(output_directory / f"{name}.csv", index=False)
    (output_directory / "summary.json").write_text(
        json.dumps(summary, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, indent=2, allow_nan=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("player_data"))
    parser.add_argument("--event-config", type=Path, default=Path("config/event_types.json"))
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    write_telemetry_audit(arguments.input, arguments.event_config, arguments.output)
