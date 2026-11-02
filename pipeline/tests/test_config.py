import copy
import json
from pathlib import Path

import pytest

from fixtures import MAP_CONFIGS_FOR_FIXTURES
from lila_pipeline.config import load_event_config, load_map_configs

REAL_EVENT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "event_types.json"
REAL_MAPS_PATH = Path(__file__).resolve().parents[2] / "player_data" / "maps.json"


def write_json(path: Path, content: object) -> Path:
    path.write_text(json.dumps(content), encoding="utf-8")
    return path


def test_load_map_configs_reads_fields(tmp_path: Path) -> None:
    map_configs_by_id = load_map_configs(
        write_json(tmp_path / "maps.json", MAP_CONFIGS_FOR_FIXTURES)
    )
    grand_rift = map_configs_by_id["GrandRift"]
    assert grand_rift.map_id == "GrandRift"
    assert grand_rift.image_file == "GrandRift_Minimap.png"
    assert grand_rift.world_scale == 581.0
    assert grand_rift.world_origin_x == -290.0
    assert grand_rift.world_origin_z == -290.0


def test_load_real_maps_json() -> None:
    map_configs_by_id = load_map_configs(REAL_MAPS_PATH)
    assert set(map_configs_by_id) == {"AmbroseValley", "GrandRift", "Lockdown"}
    assert map_configs_by_id["AmbroseValley"].world_origin_z == -473.0
    assert map_configs_by_id["Lockdown"].image_file == "Lockdown_Minimap.jpg"


def test_load_map_configs_rejects_missing_field(tmp_path: Path) -> None:
    content = copy.deepcopy(MAP_CONFIGS_FOR_FIXTURES)
    del content["GrandRift"]["world_scale"]
    with pytest.raises(ValueError, match=r"GrandRift.*world_scale"):
        load_map_configs(write_json(tmp_path / "maps.json", content))


def test_load_map_configs_rejects_non_number(tmp_path: Path) -> None:
    content = copy.deepcopy(MAP_CONFIGS_FOR_FIXTURES)
    content["Lockdown"]["world_scale"] = "big"
    with pytest.raises(ValueError, match=r"Lockdown.*world_scale"):
        load_map_configs(write_json(tmp_path / "maps.json", content))


def test_load_map_configs_rejects_boolean_where_number_expected(tmp_path: Path) -> None:
    content = copy.deepcopy(MAP_CONFIGS_FOR_FIXTURES)
    content["Lockdown"]["world_origin_x"] = True
    maps_path = write_json(tmp_path / "maps.json", content)
    with pytest.raises(ValueError) as error:
        load_map_configs(maps_path)
    assert (
        str(error.value) == f"{maps_path}: map 'Lockdown' field 'world_origin_x' must be a number"
    )


@pytest.mark.parametrize("bad_world_scale", [0, -5])
def test_load_map_configs_rejects_world_scale_not_above_zero(
    tmp_path: Path, bad_world_scale: int
) -> None:
    content = copy.deepcopy(MAP_CONFIGS_FOR_FIXTURES)
    content["GrandRift"]["world_scale"] = bad_world_scale
    maps_path = write_json(tmp_path / "maps.json", content)
    with pytest.raises(ValueError) as error:
        load_map_configs(maps_path)
    assert (
        str(error.value) == f"{maps_path}: map 'GrandRift' field 'world_scale' must be above zero"
    )


def test_load_map_configs_rejects_empty_maps_file(tmp_path: Path) -> None:
    maps_path = write_json(tmp_path / "maps.json", {})
    with pytest.raises(ValueError) as error:
        load_map_configs(maps_path)
    assert str(error.value) == f"{maps_path}: no maps are defined"


def test_load_map_configs_rejects_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="maps.json"):
        load_map_configs(tmp_path / "maps.json")


def test_load_real_event_config() -> None:
    config = load_event_config(REAL_EVENT_CONFIG_PATH)
    assert set(config.player_rules_by_event_name) == {
        "Position",
        "Kill",
        "BotKill",
        "Killed",
        "BotKilled",
        "KilledByStorm",
        "Loot",
    }
    assert set(config.bot_rules_by_event_name) == {"BotPosition", "BotKill", "BotKilled"}
    assert config.player_rules_by_event_name["BotKill"].category == "kill"
    assert config.player_rules_by_event_name["BotKill"].other_party == "bot"
    assert config.player_rules_by_event_name["BotKill"].marker == "kill_bot"
    assert config.bot_rules_by_event_name["BotKilled"].category == "bot_death"
    assert config.bot_rules_by_event_name["BotKilled"].other_party == "unknown"
    assert config.player_rules_by_event_name["Position"].marker is None
    assert len(config.markers_by_key) == 8
    assert config.markers_by_key["bot_kill"]["outline"] == "dashed"
    assert config.markers_by_key["storm_death"]["cross"] == ""
    assert config.raw_json_content["markers"] == config.markers_by_key


def load_real_event_json() -> dict[str, dict[str, dict[str, object]]]:
    parsed: dict[str, dict[str, dict[str, object]]] = json.loads(
        REAL_EVENT_CONFIG_PATH.read_text(encoding="utf-8")
    )
    return parsed


def test_load_event_config_requires_marker_for_non_position(tmp_path: Path) -> None:
    content = load_real_event_json()
    content["player"]["Loot"]["marker"] = None
    with pytest.raises(ValueError, match=r"Loot.*marker"):
        load_event_config(write_json(tmp_path / "event_types.json", content))


def test_load_event_config_rejects_unknown_marker_reference(tmp_path: Path) -> None:
    content = load_real_event_json()
    content["player"]["Loot"]["marker"] = "no_such_marker"
    with pytest.raises(ValueError, match=r"Loot.*no_such_marker"):
        load_event_config(write_json(tmp_path / "event_types.json", content))


def test_load_event_config_rejects_bad_other_party(tmp_path: Path) -> None:
    content = load_real_event_json()
    content["player"]["Kill"]["other_party"] = "ghost"
    with pytest.raises(ValueError, match=r"Kill.*other_party"):
        load_event_config(write_json(tmp_path / "event_types.json", content))


def test_load_event_config_rejects_incomplete_marker(tmp_path: Path) -> None:
    content = load_real_event_json()
    del content["markers"]["loot"]["shape"]
    with pytest.raises(ValueError, match=r"loot.*shape"):
        load_event_config(write_json(tmp_path / "event_types.json", content))


def test_load_event_config_rejects_unknown_marker_shape(tmp_path: Path) -> None:
    content = load_real_event_json()
    content["markers"]["loot"]["shape"] = "hexagon"
    event_config_path = write_json(tmp_path / "event_types.json", content)
    with pytest.raises(ValueError) as error:
        load_event_config(event_config_path)
    assert str(error.value) == (
        f"{event_config_path}: marker 'loot' field 'shape' is not a known shape"
    )


def test_load_event_config_rejects_unknown_marker_outline(tmp_path: Path) -> None:
    content = load_real_event_json()
    content["markers"]["loot"]["outline"] = "dotted"
    event_config_path = write_json(tmp_path / "event_types.json", content)
    with pytest.raises(ValueError) as error:
        load_event_config(event_config_path)
    assert str(error.value) == (
        f"{event_config_path}: marker 'loot' field 'outline' is not a known outline"
    )


def test_load_event_config_rejects_unknown_top_level_section(tmp_path: Path) -> None:
    content = load_real_event_json()
    content["_comment"] = {}
    event_config_path = write_json(tmp_path / "event_types.json", content)
    with pytest.raises(ValueError) as error:
        load_event_config(event_config_path)
    assert str(error.value) == (
        f"{event_config_path}: the file has unknown field(s) ['_comment']; "
        "allowed: ['player', 'bot', 'markers']"
    )


def test_load_event_config_rejects_unknown_rule_field(tmp_path: Path) -> None:
    content = load_real_event_json()
    content["bot"]["BotKill"]["victim"] = "player"
    with pytest.raises(
        ValueError, match=r"bot event 'BotKill' has unknown field\(s\) \['victim'\]"
    ):
        load_event_config(write_json(tmp_path / "event_types.json", content))


def test_load_event_config_rejects_unknown_marker_field(tmp_path: Path) -> None:
    content = load_real_event_json()
    content["markers"]["loot"]["size"] = "large"
    with pytest.raises(ValueError, match=r"marker 'loot' has unknown field\(s\) \['size'\]"):
        load_event_config(write_json(tmp_path / "event_types.json", content))


@pytest.mark.parametrize("fill", ["red", "#fff", "#facc15aa", ""])
def test_load_event_config_rejects_fill_that_is_not_a_hex_color(tmp_path: Path, fill: str) -> None:
    content = load_real_event_json()
    content["markers"]["loot"]["fill"] = fill
    with pytest.raises(ValueError, match=r"marker 'loot' field 'fill' must be a #rrggbb color"):
        load_event_config(write_json(tmp_path / "event_types.json", content))


@pytest.mark.parametrize("cross", ["white", "#fff"])
def test_load_event_config_rejects_cross_that_is_not_a_hex_color_or_empty(
    tmp_path: Path, cross: str
) -> None:
    content = load_real_event_json()
    content["markers"]["kill_bot"]["cross"] = cross
    with pytest.raises(
        ValueError, match=r"marker 'kill_bot' field 'cross' must be a #rrggbb color, or \"\""
    ):
        load_event_config(write_json(tmp_path / "event_types.json", content))
