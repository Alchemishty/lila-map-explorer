"""Label a raw file as human, human_misid or bot from its position events, not its ID format."""

import re
from dataclasses import dataclass
from typing import Literal

from lila_pipeline.errors import DataContractError
from lila_pipeline.raw_files import RawFile

UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
MATCH_ID_PREFIX_LENGTH = 8


@dataclass(frozen=True)
class FileLabel:
    path_type: Literal["player", "bot"]
    actor_type: Literal["human", "human_misid", "bot"]
    player_key: str


def classify_file(raw_file: RawFile) -> FileLabel:
    where = f"{raw_file.day_folder}/{raw_file.file_name}"
    telemetry_rows = raw_file.telemetry_rows
    if telemetry_rows.empty:
        raise DataContractError([f"{where}: file has no rows"])
    user_ids = telemetry_rows["user_id"].unique()
    match_ids = telemetry_rows["match_id"].unique()
    if len(user_ids) != 1 or len(match_ids) != 1:
        raise DataContractError(
            [f"{where}: expected one user and one match, got {len(user_ids)} and {len(match_ids)}"]
        )
    user_id, match_id = str(user_ids[0]), str(match_ids[0])
    is_uuid = bool(UUID_PATTERN.match(user_id))
    event_names = set(telemetry_rows["event"])
    has_player_position = "Position" in event_names
    has_bot_position = "BotPosition" in event_names

    if has_player_position and has_bot_position:
        raise DataContractError([f"{where}: mixes player and bot position events"])
    if is_uuid and has_bot_position:
        raise DataContractError([f"{where}: UUID user_id has bot position events"])
    if not has_player_position and not has_bot_position:
        raise DataContractError(
            [f"{where}: file has no Position or BotPosition events, so it cannot be classified"]
        )

    if has_bot_position:
        return FileLabel("bot", "bot", user_id)
    if is_uuid:
        return FileLabel("player", "human", user_id)
    return FileLabel(
        "player", "human_misid", f"misid-{user_id}-{match_id[:MATCH_ID_PREFIX_LENGTH]}"
    )
