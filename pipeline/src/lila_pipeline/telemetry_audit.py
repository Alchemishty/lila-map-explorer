"""Read-only investigation tables; thresholds select leads, never declare rows invalid."""

import numpy as np
import pandas as pd

SESSION_COLUMNS = ["match_id", "actor_key"]
POSITION_EVENTS = ["Position", "BotPosition"]
DEATH_EVENTS = ["Killed", "BotKilled", "KilledByStorm"]
KILL_EVENTS = ["Kill", "BotKill"]
# Investigation cutoffs, not game rules or cleaning rules.
LONG_GAP_SECONDS = 30
FAST_SPEED_WORLD_UNITS_PER_SECOND = 8
REMOTE_EVENT_DISTANCE_WORLD_UNITS = 20


def build_session_inventory(rows: pd.DataFrame) -> pd.DataFrame:
    """Every recorded actor, including logging tails and time omitted by Traffic."""
    sessions = rows.groupby(SESSION_COLUMNS, sort=True).agg(
        source_file=("source_file", "first"),
        map_id=("map_id", "first"),
        user_id=("user_id", "first"),
        actor_type=("actor_type", "first"),
        start_timestamp_seconds=("timestamp_seconds", "min"),
        end_timestamp_seconds=("timestamp_seconds", "max"),
        row_count=("event", "size"),
        death_count=("event", lambda events: int(events.isin(DEATH_EVENTS).sum())),
    )
    positions = rows[rows.event.isin(POSITION_EVENTS)]
    sessions = sessions.join(
        positions.groupby(SESSION_COLUMNS).agg(
            position_count=("event", "size"),
            last_position_timestamp_seconds=("timestamp_seconds", "max"),
        )
    )
    deaths = rows[rows.event.isin(DEATH_EVENTS)]
    sessions = sessions.join(
        deaths.groupby(SESSION_COLUMNS).timestamp_seconds.min().rename("death_timestamp_seconds")
    )
    # No death is a valid unknown outcome; the observation ends at the last recorded row.
    observation_end_timestamp_seconds = sessions.death_timestamp_seconds.where(
        sessions.death_count > 0, sessions.end_timestamp_seconds
    )
    positions = positions.join(
        observation_end_timestamp_seconds.rename("observation_end_timestamp_seconds"),
        on=SESSION_COLUMNS,
    )
    before_death = positions[
        positions.timestamp_seconds <= positions.observation_end_timestamp_seconds
    ]
    sessions = sessions.join(
        before_death.groupby(SESSION_COLUMNS).timestamp_seconds.agg(
            first_traffic_timestamp_seconds="min", last_traffic_timestamp_seconds="max"
        )
    )
    sessions["traffic_seconds"] = (
        sessions.last_traffic_timestamp_seconds - sessions.first_traffic_timestamp_seconds
    )
    sessions["uncredited_tail_seconds"] = (
        observation_end_timestamp_seconds - sessions.last_traffic_timestamp_seconds
    )
    sessions = sessions.join(
        rows.groupby("match_id").timestamp_seconds.max().rename("match_end_timestamp_seconds"),
        on="match_id",
    )
    sessions["held_head_tail_seconds"] = (
        sessions.match_end_timestamp_seconds - sessions.end_timestamp_seconds
    )
    return sessions.reset_index()


def build_position_segments(rows: pd.DataFrame) -> pd.DataFrame:
    """Every consecutive position interval, without thinning or rounding."""
    segments = rows[rows.event.isin(POSITION_EVENTS)].copy()
    for column in ["timestamp_seconds", "world_x", "world_z"]:
        segments[f"previous_{column}"] = segments.groupby(SESSION_COLUMNS)[column].shift()
    # First sample has no preceding segment, by definition.
    segments = segments[segments.previous_timestamp_seconds.notna()].copy()
    segments["duration_seconds"] = segments.timestamp_seconds - segments.previous_timestamp_seconds
    segments["distance_world_units"] = np.hypot(
        segments.world_x - segments.previous_world_x,
        segments.world_z - segments.previous_world_z,
    )
    segments["speed_world_units_per_second"] = (
        segments.distance_world_units / segments.duration_seconds
    )
    return segments


def build_event_position_distances(rows: pd.DataFrame) -> pd.DataFrame:
    """Compare each event with temporally nearest samples, taking minimum distance on ties."""
    event_frames: list[pd.DataFrame] = []
    for _, session_rows in rows.groupby(SESSION_COLUMNS, sort=True):
        positions = session_rows[session_rows.event.isin(POSITION_EVENTS)]
        events = session_rows[~session_rows.event.isin(POSITION_EVENTS)].copy()
        if events.empty:
            continue  # A position-only session has no events to compare.
        if positions.empty:
            raise ValueError(f"{session_rows.source_file.iloc[0]}: no position samples")
        gaps_seconds = abs(
            events.timestamp_seconds.to_numpy()[:, None]
            - positions.timestamp_seconds.to_numpy()[None, :]
        )
        nearest_gap_seconds = gaps_seconds.min(axis=1)
        distances_world_units = np.hypot(
            events.world_x.to_numpy()[:, None] - positions.world_x.to_numpy()[None, :],
            events.world_z.to_numpy()[:, None] - positions.world_z.to_numpy()[None, :],
        )
        events["nearest_position_gap_seconds"] = nearest_gap_seconds
        events["nearest_position_distance_world_units"] = np.where(
            gaps_seconds == nearest_gap_seconds[:, None], distances_world_units, np.inf
        ).min(axis=1)
        event_frames.append(events)
    if not event_frames:
        return pd.DataFrame(
            columns=[
                *rows.columns,
                "nearest_position_gap_seconds",
                "nearest_position_distance_world_units",
            ]
        )  # Valid dataset with positions only.
    return pd.concat(event_frames, ignore_index=True)


def build_audit_tables(rows: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Retain all instances of each lead, with the original file, coordinates and epoch seconds."""
    if rows.empty:
        raise ValueError("telemetry audit: no cleaned rows")
    sessions = build_session_inventory(rows)
    segments = build_position_segments(rows)
    events = build_event_position_distances(rows)
    deaths = rows[rows.event.isin(DEATH_EVENTS)].groupby(SESSION_COLUMNS).first()
    post_death = rows.join(
        deaths[["timestamp_seconds", "world_x", "world_z"]].add_prefix("death_"),
        on=SESSION_COLUMNS,
    )
    post_death = post_death[
        post_death.timestamp_seconds > post_death.death_timestamp_seconds
    ].copy()
    post_death["seconds_after_death"] = (
        post_death.timestamp_seconds - post_death.death_timestamp_seconds
    )
    post_death["distance_from_death_world_units"] = np.hypot(
        post_death.world_x - post_death.death_world_x,
        post_death.world_z - post_death.death_world_z,
    )
    same_second = rows.groupby([*SESSION_COLUMNS, "timestamp_seconds"]).agg(
        source_file=("source_file", "first"),
        actor_type=("actor_type", "first"),
        event_codes=("event", lambda events: "|".join(events)),
        distinct_world_x=("world_x", "nunique"),
        distinct_world_z=("world_z", "nunique"),
        min_world_x=("world_x", "min"),
        max_world_x=("world_x", "max"),
        min_world_z=("world_z", "min"),
        max_world_z=("world_z", "max"),
    )
    same_second = same_second[
        (same_second.distinct_world_x > 1) | (same_second.distinct_world_z > 1)
    ].copy()
    same_second["bounding_diagonal_world_units"] = np.hypot(
        same_second.max_world_x - same_second.min_world_x,
        same_second.max_world_z - same_second.min_world_z,
    )
    combat_pairs = rows[rows.event.isin(KILL_EVENTS)].merge(
        rows[rows.event.isin(DEATH_EVENTS)],
        on=[*SESSION_COLUMNS, "timestamp_seconds"],
        suffixes=("_kill", "_death"),
    )
    combat_pairs["has_same_world_position"] = (
        combat_pairs.world_x_kill == combat_pairs.world_x_death
    ) & (combat_pairs.world_z_kill == combat_pairs.world_z_death)
    repeated = rows.duplicated(
        [*SESSION_COLUMNS, "event", "timestamp_seconds", "world_x", "world_z"], keep=False
    )
    is_event_lead = (events.nearest_position_gap_seconds > LONG_GAP_SECONDS) | (
        events.nearest_position_distance_world_units > REMOTE_EVENT_DISTANCE_WORLD_UNITS
    )
    return {
        "sessions": sessions,
        "same_second_combat": combat_pairs,
        "post_death_rows": post_death,
        "same_second_different_positions": same_second.reset_index(),
        "repeated_event_groups": rows[repeated],
        "long_position_gaps": segments[segments.duration_seconds > LONG_GAP_SECONDS],
        "fast_position_segments": segments[
            segments.speed_world_units_per_second > FAST_SPEED_WORLD_UNITS_PER_SECOND
        ],
        "event_position_leads": events[is_event_lead],
    }
