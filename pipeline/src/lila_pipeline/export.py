"""Write the static site data: manifest.json, per-day match files and resized minimaps."""

import json
import shutil
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from PIL import Image

from lila_pipeline.clean import CleanDataset
from lila_pipeline.config import EventConfig, MapConfig

SCHEMA_VERSION = 1
MINIMAP_MAX_SIDE_PIXELS = 4096
MINIMAP_JPEG_QUALITY = 85
MINIMAP_PIXEL_LIMIT = 200_000_000  # explicit bound: the real Lockdown image is 81M pixels
PLAYER_PATH_TYPES = ("human", "human_misid")

Image.MAX_IMAGE_PIXELS = MINIMAP_PIXEL_LIMIT


def _write_json(path: Path, content: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content, separators=(",", ":")), encoding="utf-8")


def _write_minimap(
    map_config: MapConfig, minimap_directory: Path, target_directory: Path
) -> dict[str, Any]:
    source_image_path = minimap_directory / map_config.image_file
    if not source_image_path.is_file():
        raise FileNotFoundError(
            f"{source_image_path}: minimap image for map '{map_config.map_id}' not found"
        )
    relative_image_path = f"minimaps/{map_config.map_id}.jpg"
    with Image.open(source_image_path) as image:
        resized = image.convert("RGB")
        resized.thumbnail(
            (MINIMAP_MAX_SIDE_PIXELS, MINIMAP_MAX_SIDE_PIXELS), Image.Resampling.LANCZOS
        )
        target_image_path = target_directory / relative_image_path
        target_image_path.parent.mkdir(parents=True, exist_ok=True)
        resized.save(target_image_path, "JPEG", quality=MINIMAP_JPEG_QUALITY)
        width_pixels, height_pixels = resized.size
    return {
        "mapId": map_config.map_id,
        "imageFile": relative_image_path,
        "imageWidthPixels": width_pixels,
        "imageHeightPixels": height_pixels,
        "worldScale": map_config.world_scale,
        "worldOriginX": map_config.world_origin_x,
        "worldOriginZ": map_config.world_origin_z,
    }


def _build_actor_entry(actor_rows: pd.DataFrame) -> dict[str, Any]:
    first_actor_row = actor_rows.iloc[0]
    return {
        "actorKey": str(first_actor_row["actor_key"]),
        "userId": str(first_actor_row["user_id"]),
        "actorType": str(first_actor_row["actor_type"]),
        "worldX": actor_rows["world_x"].to_numpy(dtype=np.float32).tolist(),
        "worldZ": actor_rows["world_z"].to_numpy(dtype=np.float32).tolist(),
        "timestampSeconds": [
            int(timestamp_seconds) for timestamp_seconds in actor_rows["timestamp_seconds"]
        ],
        "eventCodes": [str(event_code) for event_code in actor_rows["event"]],
        "isSameTickRepeat": [
            bool(is_same_tick_repeat) for is_same_tick_repeat in actor_rows["is_same_tick_repeat"]
        ],
    }


def _count_events_by_marker(match_rows: pd.DataFrame, event_config: EventConfig) -> dict[str, int]:
    event_count_by_marker: dict[str, int] = {}
    is_player_path_row = match_rows["actor_type"].isin(PLAYER_PATH_TYPES)
    for event_name, is_player_path in zip(match_rows["event"], is_player_path_row, strict=True):
        rules_by_event_name = (
            event_config.player_rules_by_event_name
            if is_player_path
            else event_config.bot_rules_by_event_name
        )
        rule = rules_by_event_name[str(event_name)]
        if rule.marker is not None:
            event_count_by_marker[rule.marker] = event_count_by_marker.get(rule.marker, 0) + 1
    return event_count_by_marker


def _build_manifest_match(
    match_id: str, match_rows: pd.DataFrame, event_config: EventConfig
) -> dict[str, Any]:
    map_id = str(match_rows["map_id"].iloc[0])
    day_utc = str(match_rows["day_utc"].iloc[0])
    timestamp_seconds = match_rows["timestamp_seconds"]
    is_player_row = match_rows["actor_type"].isin(PLAYER_PATH_TYPES)
    return {
        "matchId": match_id,
        "mapId": map_id,
        "dayUtc": day_utc,
        "startTimestampSeconds": int(timestamp_seconds.min()),
        "durationSeconds": int(timestamp_seconds.max() - timestamp_seconds.min()),
        "playerCount": int(match_rows.loc[is_player_row, "actor_key"].nunique()),
        "botCount": int(match_rows.loc[~is_player_row, "actor_key"].nunique()),
        "eventCountsByMarker": _count_events_by_marker(match_rows, event_config),
        "dayFile": f"days/{map_id}/{day_utc}.json",
    }


def _write_days_and_matches(
    rows: pd.DataFrame, event_config: EventConfig, target_directory: Path
) -> list[dict[str, Any]]:
    manifest_matches: list[dict[str, Any]] = []
    for (map_id, day_utc), day_rows in rows.groupby(["map_id", "day_utc"], sort=True):
        day_file_matches: list[dict[str, Any]] = []
        for match_id, match_rows in day_rows.groupby("match_id", sort=True):
            manifest_matches.append(_build_manifest_match(str(match_id), match_rows, event_config))
            actors = [
                _build_actor_entry(actor_rows)
                for _, actor_rows in match_rows.groupby("actor_key", sort=True)
            ]
            day_file_matches.append({"matchId": str(match_id), "actors": actors})
        _write_json(
            target_directory / "days" / str(map_id) / f"{day_utc}.json",
            {
                "schemaVersion": SCHEMA_VERSION,
                "mapId": map_id,
                "dayUtc": day_utc,
                "matches": day_file_matches,
            },
        )
    manifest_matches.sort(
        key=lambda manifest_match: (
            manifest_match["startTimestampSeconds"],
            manifest_match["matchId"],
        )
    )
    return manifest_matches


def _swap_into_place(temporary_directory: Path, output_directory: Path) -> None:
    """Rename the old output aside, move the new one in, then delete the old one.

    If the move fails, the old output is restored. If only the final delete fails, the new
    output is already live and correct, so print a warning naming the leftover folder.
    """
    old_directory = output_directory.parent / f".{output_directory.name}.old-{uuid.uuid4().hex[:8]}"
    has_old_output = output_directory.exists()
    if has_old_output:
        output_directory.rename(old_directory)
    try:
        temporary_directory.rename(output_directory)
    except BaseException:
        if has_old_output:
            old_directory.rename(output_directory)
        raise
    if has_old_output:
        try:
            shutil.rmtree(old_directory)
        except OSError as error:
            print(
                "warning: the new output is in place, but the previous output could not be "
                f"deleted ({error}). The leftover folder {old_directory} can be deleted.",
                file=sys.stderr,
            )


def write_site_data(
    dataset: CleanDataset,
    map_configs_by_id: dict[str, MapConfig],
    event_config: EventConfig,
    minimap_directory: Path,
    output_directory: Path,
) -> None:
    """Build everything in a sibling temporary directory, then swap it in for the output."""
    output_directory.parent.mkdir(parents=True, exist_ok=True)
    temporary_directory = (
        output_directory.parent / f".{output_directory.name}.tmp-{uuid.uuid4().hex[:8]}"
    )
    try:
        temporary_directory.mkdir()
        used_map_ids = sorted({str(map_id) for map_id in dataset.cleaned_rows["map_id"].unique()})
        map_entries = [
            _write_minimap(map_configs_by_id[map_id], minimap_directory, temporary_directory)
            for map_id in used_map_ids
        ]
        manifest_matches = _write_days_and_matches(
            dataset.cleaned_rows, event_config, temporary_directory
        )
        _write_json(
            temporary_directory / "manifest.json",
            {
                "schemaVersion": SCHEMA_VERSION,
                "generatedAtUtc": datetime.now(UTC).isoformat(),
                "maps": map_entries,
                "eventConfig": event_config.raw_json_content,
                "matches": manifest_matches,
            },
        )
        _swap_into_place(temporary_directory, output_directory)
    except BaseException:
        shutil.rmtree(temporary_directory, ignore_errors=True)
        raise
