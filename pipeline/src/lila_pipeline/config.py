"""Loaders for maps.json and event_types.json. Both fail loudly, naming the file and problem."""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

OtherParty = Literal["player", "bot", "none", "unknown"]
VALID_OTHER_PARTIES: tuple[OtherParty, ...] = ("player", "bot", "none", "unknown")
MARKER_TEXT_FIELDS = ("label", "shape", "fill", "cross", "outline")
VALID_MARKER_SHAPES = ("circle", "square", "triangle", "diamond")
VALID_MARKER_OUTLINES = ("solid", "dashed")
POSITION_EVENT_CATEGORY = "position"
EVENT_CONFIG_SECTIONS = ("player", "bot", "markers")
EVENT_RULE_FIELDS = ("category", "other_party", "marker")
HEX_COLOR_PATTERN = re.compile(r"#[0-9a-fA-F]{6}")


@dataclass(frozen=True)
class MapConfig:
    map_id: str
    image_file: str
    world_scale: float
    world_origin_x: float
    world_origin_z: float


@dataclass(frozen=True)
class EventRule:
    category: str
    other_party: OtherParty
    marker: str | None


@dataclass(frozen=True)
class EventConfig:
    player_rules_by_event_name: dict[str, EventRule]
    bot_rules_by_event_name: dict[str, EventRule]
    markers_by_key: dict[str, dict[str, str]]
    raw_json_content: dict[str, Any]


def _read_json_object(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"{path}: file not found")
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{path}: not valid JSON ({error})") from error
    if not isinstance(parsed, dict):
        raise ValueError(f"{path}: expected a JSON object at the top level")
    return cast(dict[str, Any], parsed)


def _require_object(value: object, path: Path, description: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{path}: {description} must be a JSON object")
    return cast(dict[str, Any], value)


def _reject_unknown_fields(
    fields: dict[str, Any], allowed_field_names: tuple[str, ...], where: str
) -> None:
    unknown_field_names = sorted(set(fields) - set(allowed_field_names))
    if unknown_field_names:
        raise ValueError(
            f"{where} has unknown field(s) {unknown_field_names}; "
            f"allowed: {list(allowed_field_names)}"
        )


def load_map_configs(path: Path) -> dict[str, MapConfig]:
    content = _read_json_object(path)
    map_configs_by_id: dict[str, MapConfig] = {}
    for map_id, entry in content.items():
        fields = _require_object(entry, path, f"map '{map_id}'")
        for field_name in ("image_file", "world_scale", "world_origin_x", "world_origin_z"):
            if field_name not in fields:
                raise ValueError(f"{path}: map '{map_id}' is missing field '{field_name}'")
        image_file = fields["image_file"]
        if not isinstance(image_file, str) or image_file == "":
            raise ValueError(f"{path}: map '{map_id}' field 'image_file' must be a file name")
        numeric_fields_by_name: dict[str, float] = {}
        for field_name in ("world_scale", "world_origin_x", "world_origin_z"):
            number = fields[field_name]
            if isinstance(number, bool) or not isinstance(number, int | float):
                raise ValueError(f"{path}: map '{map_id}' field '{field_name}' must be a number")
            numeric_fields_by_name[field_name] = float(number)
        if numeric_fields_by_name["world_scale"] <= 0:
            raise ValueError(f"{path}: map '{map_id}' field 'world_scale' must be above zero")
        map_configs_by_id[map_id] = MapConfig(
            map_id=map_id,
            image_file=image_file,
            world_scale=numeric_fields_by_name["world_scale"],
            world_origin_x=numeric_fields_by_name["world_origin_x"],
            world_origin_z=numeric_fields_by_name["world_origin_z"],
        )
    if not map_configs_by_id:
        raise ValueError(f"{path}: no maps are defined")
    return map_configs_by_id


def _load_markers(content: dict[str, Any], path: Path) -> dict[str, dict[str, str]]:
    if "markers" not in content:
        raise ValueError(f"{path}: missing section 'markers'")
    markers_by_key: dict[str, dict[str, str]] = {}
    for marker_key, entry in _require_object(content["markers"], path, "'markers'").items():
        fields = _require_object(entry, path, f"marker '{marker_key}'")
        _reject_unknown_fields(fields, MARKER_TEXT_FIELDS, f"{path}: marker '{marker_key}'")
        for field_name in MARKER_TEXT_FIELDS:
            if not isinstance(fields.get(field_name), str):
                raise ValueError(
                    f"{path}: marker '{marker_key}' is missing text field '{field_name}'"
                )
        if fields["shape"] not in VALID_MARKER_SHAPES:
            raise ValueError(f"{path}: marker '{marker_key}' field 'shape' is not a known shape")
        if fields["outline"] not in VALID_MARKER_OUTLINES:
            raise ValueError(
                f"{path}: marker '{marker_key}' field 'outline' is not a known outline"
            )
        if HEX_COLOR_PATTERN.fullmatch(fields["fill"]) is None:
            raise ValueError(f"{path}: marker '{marker_key}' field 'fill' must be a #rrggbb color")
        if fields["cross"] != "" and HEX_COLOR_PATTERN.fullmatch(fields["cross"]) is None:
            raise ValueError(
                f"{path}: marker '{marker_key}' field 'cross' must be a #rrggbb color, "
                'or "" for no cross'
            )
        markers_by_key[marker_key] = {name: fields[name] for name in MARKER_TEXT_FIELDS}
    return markers_by_key


def _load_rules(
    content: dict[str, Any], section: str, markers_by_key: dict[str, dict[str, str]], path: Path
) -> dict[str, EventRule]:
    if section not in content:
        raise ValueError(f"{path}: missing section '{section}'")
    rules_by_event_name: dict[str, EventRule] = {}
    for event_name, entry in _require_object(content[section], path, f"'{section}'").items():
        where = f"{path}: {section} event '{event_name}'"
        fields = _require_object(entry, path, f"{section} event '{event_name}'")
        _reject_unknown_fields(fields, EVENT_RULE_FIELDS, where)
        category = fields.get("category")
        if not isinstance(category, str) or category == "":
            raise ValueError(f"{where} is missing field 'category'")
        other_party = fields.get("other_party")
        if other_party not in VALID_OTHER_PARTIES:
            raise ValueError(f"{where} field 'other_party' must be one of {VALID_OTHER_PARTIES}")
        marker = fields.get("marker")
        if marker is None:
            if category != POSITION_EVENT_CATEGORY:
                raise ValueError(f"{where} needs a 'marker' because it is not a position event")
        elif not isinstance(marker, str) or marker not in markers_by_key:
            raise ValueError(f"{where} refers to marker '{marker}' which is not in 'markers'")
        rules_by_event_name[event_name] = EventRule(
            category=category, other_party=cast(OtherParty, other_party), marker=marker
        )
    return rules_by_event_name


def load_event_config(path: Path) -> EventConfig:
    content = _read_json_object(path)
    _reject_unknown_fields(content, EVENT_CONFIG_SECTIONS, f"{path}: the file")
    markers_by_key = _load_markers(content, path)
    return EventConfig(
        player_rules_by_event_name=_load_rules(content, "player", markers_by_key, path),
        bot_rules_by_event_name=_load_rules(content, "bot", markers_by_key, path),
        markers_by_key=markers_by_key,
        raw_json_content=content,
    )
