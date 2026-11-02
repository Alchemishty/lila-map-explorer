"""Helpers that write real parquet files and drop folders with the production schema."""

import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from PIL import Image

MAP_CONFIGS_FOR_FIXTURES: dict[str, dict[str, object]] = {
    "AmbroseValley": {
        "image_file": "AmbroseValley_Minimap.png",
        "world_scale": 900,
        "world_origin_x": -370,
        "world_origin_z": -473,
    },
    "GrandRift": {
        "image_file": "GrandRift_Minimap.png",
        "world_scale": 581,
        "world_origin_x": -290,
        "world_origin_z": -290,
    },
    "Lockdown": {
        "image_file": "Lockdown_Minimap.jpg",
        "world_scale": 1000,
        "world_origin_x": -500,
        "world_origin_z": -500,
    },
}


def write_raw_file(
    directory: Path,
    user_id: str,
    match_id: str,
    map_id: str,
    rows: list[tuple[float, float, int, str]],
) -> Path:
    """Write one actor-in-one-match parquet file. Each row is (world_x, world_z, seconds, event).

    `ts` is stored as timestamp[ms] but holds epoch SECONDS, like the real data.
    """
    directory.mkdir(parents=True, exist_ok=True)
    row_count = len(rows)
    table = pa.table(
        {
            "user_id": pa.array([user_id] * row_count, type=pa.string()),
            "match_id": pa.array([match_id] * row_count, type=pa.string()),
            "map_id": pa.array([map_id] * row_count, type=pa.string()),
            "x": pa.array([row[0] for row in rows], type=pa.float32()),
            "y": pa.array([0.0] * row_count, type=pa.float32()),
            "z": pa.array([row[1] for row in rows], type=pa.float32()),
            "ts": pa.array([row[2] for row in rows], type=pa.int64()).cast(pa.timestamp("ms")),
            "event": pa.array([row[3].encode("utf-8") for row in rows], type=pa.binary()),
        }
    )
    file_path = directory / f"{user_id}_{match_id}"
    pq.write_table(table, file_path)
    return file_path


def write_drop_folder(root: Path) -> Path:
    """Create maps.json and a 64x64 minimap per map inside `root`."""
    minimaps_directory = root / "minimaps"
    minimaps_directory.mkdir(parents=True, exist_ok=True)
    (root / "maps.json").write_text(json.dumps(MAP_CONFIGS_FOR_FIXTURES), encoding="utf-8")
    for map_config in MAP_CONFIGS_FOR_FIXTURES.values():
        image_file = str(map_config["image_file"])
        Image.new("RGB", (64, 64), (10, 20, 30)).save(minimaps_directory / image_file)
    return root
