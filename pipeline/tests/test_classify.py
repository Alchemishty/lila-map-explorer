from pathlib import Path

import pandas as pd
import pytest

from fixtures import write_raw_file
from lila_pipeline.classify import classify_file
from lila_pipeline.errors import DataContractError
from lila_pipeline.raw_files import RawFile, read_raw_file

HUMAN_ID = "f4e072fa-b7af-4761-b567-1d95b7ad0108"
MATCH_ID = "3731eba6-1111-2222-3333-444444444444.nakama-0"


def load_raw_file(
    tmp_path: Path, user_id: str, rows: list[tuple[float, float, int, str]]
) -> RawFile:
    path = write_raw_file(tmp_path / "February_10", user_id, MATCH_ID, "Lockdown", rows)
    return read_raw_file(path, "February_10")


def test_uuid_with_position_is_human(tmp_path: Path) -> None:
    label = classify_file(load_raw_file(tmp_path, HUMAN_ID, [(1.0, 2.0, 100, "Position")]))
    assert (label.path_type, label.actor_type, label.player_key) == ("player", "human", HUMAN_ID)


def test_numeric_id_with_bot_position_is_bot(tmp_path: Path) -> None:
    label = classify_file(load_raw_file(tmp_path, "1429", [(1.0, 2.0, 100, "BotPosition")]))
    assert (label.path_type, label.actor_type, label.player_key) == ("bot", "bot", "1429")


def test_position_file_with_numeric_id_is_human_misid(tmp_path: Path) -> None:
    label = classify_file(load_raw_file(tmp_path, "1429", [(1.0, 2.0, 100, "Position")]))
    assert label.actor_type == "human_misid"
    assert label.path_type == "player"
    assert label.player_key == "misid-1429-3731eba6"


def test_file_without_position_events_raises(tmp_path: Path) -> None:
    raw_file = load_raw_file(tmp_path, HUMAN_ID, [(1.0, 2.0, 100, "Loot")])
    with pytest.raises(DataContractError) as error:
        classify_file(raw_file)
    assert error.value.problems == [
        f"February_10/{raw_file.file_name}: "
        "file has no Position or BotPosition events, so it cannot be classified"
    ]


def test_mixed_position_events_raise(tmp_path: Path) -> None:
    raw_file = load_raw_file(
        tmp_path, "1429", [(1.0, 2.0, 100, "Position"), (1.0, 2.0, 101, "BotPosition")]
    )
    with pytest.raises(DataContractError) as error:
        classify_file(raw_file)
    assert error.value.problems == [
        f"February_10/{raw_file.file_name}: mixes player and bot position events"
    ]


def test_uuid_with_bot_position_raises(tmp_path: Path) -> None:
    raw_file = load_raw_file(tmp_path, HUMAN_ID, [(1.0, 2.0, 100, "BotPosition")])
    with pytest.raises(DataContractError) as error:
        classify_file(raw_file)
    assert error.value.problems == [
        f"February_10/{raw_file.file_name}: UUID user_id has bot position events"
    ]


def test_empty_file_raises(tmp_path: Path) -> None:
    raw_file = load_raw_file(tmp_path, HUMAN_ID, [])
    with pytest.raises(DataContractError) as error:
        classify_file(raw_file)
    assert error.value.problems == [f"February_10/{raw_file.file_name}: file has no rows"]


def test_file_with_two_users_raises(tmp_path: Path) -> None:
    human_file = load_raw_file(tmp_path, HUMAN_ID, [(1.0, 2.0, 100, "Position")])
    misid_file = load_raw_file(tmp_path / "b", "1429", [(1.0, 2.0, 101, "Position")])
    mixed = RawFile(
        "February_10", "mixed", pd.concat([human_file.telemetry_rows, misid_file.telemetry_rows])
    )
    with pytest.raises(DataContractError) as error:
        classify_file(mixed)
    assert error.value.problems == [
        "February_10/mixed: expected one user and one match, got 2 and 1"
    ]
