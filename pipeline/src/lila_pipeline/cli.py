"""Command line: `python -m lila_pipeline build --input ... --event-config ... --output ...`."""

import argparse
import sys
from collections import Counter
from pathlib import Path

from lila_pipeline.clean import clean_dataset
from lila_pipeline.config import load_event_config, load_map_configs
from lila_pipeline.errors import DataContractError
from lila_pipeline.export import write_site_data
from lila_pipeline.raw_files import discover_raw_files, read_all_raw_files
from lila_pipeline.validate import find_all_problems


def _parse_build_arguments(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="lila_pipeline")
    command_parsers = parser.add_subparsers(dest="command", required=True)
    build_parser = command_parsers.add_parser(
        "build", help="clean the telemetry and write the site data"
    )
    build_parser.add_argument("--input", type=Path, required=True)
    build_parser.add_argument("--event-config", type=Path, required=True)
    build_parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def _run_build(arguments: argparse.Namespace) -> int:
    input_directory: Path = arguments.input
    day_folder_and_paths = discover_raw_files(input_directory)
    if not day_folder_and_paths:
        print(f"{input_directory}: no telemetry files found in any day folder", file=sys.stderr)
        return 1
    map_configs_by_id = load_map_configs(input_directory / "maps.json")
    event_config = load_event_config(arguments.event_config)
    minimap_directory = input_directory / "minimaps"
    raw_files, read_problems = read_all_raw_files(day_folder_and_paths)
    problems = [
        *read_problems,
        *find_all_problems(
            raw_files, [None] * len(raw_files), map_configs_by_id, event_config, minimap_directory
        ),
    ]
    if problems:
        raise DataContractError(problems)
    dataset = clean_dataset(raw_files)
    write_site_data(dataset, map_configs_by_id, event_config, minimap_directory, arguments.output)

    report = dataset.report
    match_day_utc_values = dataset.cleaned_rows.drop_duplicates("match_id")["day_utc"]
    match_count_by_day_utc = dict(sorted(Counter(match_day_utc_values).items()))
    human_misid_actor_count = dataset.cleaned_rows.loc[
        dataset.cleaned_rows["actor_type"] == "human_misid", "actor_key"
    ].nunique()
    print(f"files read: {report.files_read}")
    print(f"duplicate-file rows dropped: {report.duplicate_file_rows_dropped}")
    print(f"duplicate-block rows dropped: {report.duplicate_block_rows_dropped}")
    print(f"duplicate BotKilled rows dropped: {report.duplicate_botkilled_rows_dropped}")
    print(f"same-tick-repeat rows: {report.same_tick_repeat_rows}")
    print(f"rows kept: {len(dataset.cleaned_rows)}")
    print(f"matches: {len(match_day_utc_values)}")
    print(f"matches by day: {match_count_by_day_utc}")
    print(f"human_misid actors: {human_misid_actor_count}")
    return 0


def main(argv: list[str]) -> int:
    arguments = _parse_build_arguments(argv)
    try:
        return _run_build(arguments)
    except (DataContractError, ValueError, FileNotFoundError) as error:
        print(str(error), file=sys.stderr)
        return 1
