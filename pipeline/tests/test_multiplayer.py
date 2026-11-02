import json
from pathlib import Path

from fixtures import write_drop_folder, write_raw_file
from lila_pipeline.cli import main

EVENT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "event_types.json"
MATCH_ID = "3731eba6-1111-2222-3333-444444444444.nakama-0"
PLAYER_IDS = [f"{prefix}1e072fa-b7af-4761-b567-1d95b7ad0108" for prefix in "abc"]
BOT_IDS = ["1001", "1002"]
START_TIMESTAMP_SECONDS = 1770700000


def test_multiplayer_match_through_cli(tmp_path: Path, capsys: object) -> None:
    drop = write_drop_folder(tmp_path / "drop")
    day_folder = drop / "February_10"
    world_position = (10.0, 20.0)

    def player_rows(
        *offset_seconds_and_events: tuple[int, str],
    ) -> list[tuple[float, float, int, str]]:
        return [
            (*world_position, START_TIMESTAMP_SECONDS, "Position"),
            *[
                (*world_position, START_TIMESTAMP_SECONDS + offset_seconds, event_name)
                for offset_seconds, event_name in offset_seconds_and_events
            ],
        ]

    write_raw_file(
        day_folder, PLAYER_IDS[0], MATCH_ID, "Lockdown", player_rows((5, "Kill"), (6, "BotKill"))
    )
    write_raw_file(day_folder, PLAYER_IDS[1], MATCH_ID, "Lockdown", player_rows((5, "Killed")))
    write_raw_file(day_folder, PLAYER_IDS[2], MATCH_ID, "Lockdown", player_rows())
    write_raw_file(
        day_folder,
        BOT_IDS[0],
        MATCH_ID,
        "Lockdown",
        [
            (*world_position, START_TIMESTAMP_SECONDS, "BotPosition"),
            (*world_position, START_TIMESTAMP_SECONDS + 7, "BotKill"),
        ],
    )
    write_raw_file(
        day_folder,
        BOT_IDS[1],
        MATCH_ID,
        "Lockdown",
        [
            (*world_position, START_TIMESTAMP_SECONDS, "BotPosition"),
            (*world_position, START_TIMESTAMP_SECONDS + 8, "BotKilled"),
        ],
    )
    output = tmp_path / "out"
    exit_code = main(
        [
            "build",
            "--input",
            str(drop),
            "--event-config",
            str(EVENT_CONFIG_PATH),
            "--output",
            str(output),
        ]
    )
    assert exit_code == 0
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    match = manifest["matches"][0]
    assert (match["playerCount"], match["botCount"]) == (3, 2)
    assert match["eventCountsByMarker"] == {
        "kill_player": 1,
        "death_by_player": 1,
        "kill_bot": 1,
        "bot_kill": 1,
        "bot_death": 1,
    }
    day_file = json.loads((output / match["dayFile"]).read_text(encoding="utf-8"))
    assert len(day_file["matches"][0]["actors"]) == 5
