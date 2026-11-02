"""The real marker configuration uses the user-approved designer-facing names."""

from pathlib import Path

from lila_pipeline.config import load_event_config


def test_real_marker_labels_name_the_actor_and_combat_direction() -> None:
    config_path = Path(__file__).resolve().parents[2] / "config" / "event_types.json"
    event_config = load_event_config(config_path)
    assert {
        marker_key: marker_style["label"]
        for marker_key, marker_style in event_config.markers_by_key.items()
    } == {
        "kill_player": "Player killed a player",
        "kill_bot": "Player killed a bot",
        "death_by_player": "Player killed by a player",
        "death_by_bot": "Player killed by a bot",
        "storm_death": "Player died to storm",
        "loot": "Player looted",
        "bot_kill": "Bot made a kill (victim not recorded)",
        "bot_death": "Bot died (killer not recorded)",
    }
