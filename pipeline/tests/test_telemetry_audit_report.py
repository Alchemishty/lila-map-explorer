"""Check the committed audit evidence against every input file, and DATA_QUALITY.md against both."""

import hashlib
import json
from pathlib import Path

import pandas as pd
import pyarrow.parquet as parquet

from lila_pipeline.raw_files import discover_raw_files

PROJECT_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIRECTORY = PROJECT_ROOT / "docs/data-findings/telemetry-audit-evidence"
DATA_QUALITY_REPORT_PATH = PROJECT_ROOT / "DATA_QUALITY.md"


def read_finding_section(finding_number: int) -> str:
    report = DATA_QUALITY_REPORT_PATH.read_text()
    heading = f"### {finding_number}. "
    assert heading in report, f"{DATA_QUALITY_REPORT_PATH}: missing finding {finding_number}"
    section = report.split(heading, 1)[1]
    return section.split("\n### ", 1)[0].split("\n## ", 1)[0]


def test_evidence_covers_exact_input_drop_and_all_reported_tables() -> None:
    summary = json.loads((EVIDENCE_DIRECTORY / "summary.json").read_text())
    inventory = pd.read_csv(EVIDENCE_DIRECTORY / "raw_files.csv")
    discovered_paths = discover_raw_files(PROJECT_ROOT / "player_data")
    assert inventory.source_file.tolist() == [
        f"{day}/{path.name}" for day, path in discovered_paths
    ]
    assert len(inventory) == summary["cleaning"]["files_read"] == 1243
    for source_record in inventory.to_dict("records"):
        source_path = PROJECT_ROOT / "player_data" / source_record["source_file"]
        assert hashlib.sha256(source_path.read_bytes()).hexdigest() == source_record["sha256"]
        assert parquet.read_metadata(source_path).num_rows == source_record["raw_row_count"]
    assert int(inventory.raw_row_count.sum()) == summary["raw_rows"] == 89104
    for table_name, row_count in summary["evidence_table_row_counts"].items():
        assert len(pd.read_csv(EVIDENCE_DIRECTORY / f"{table_name}.csv")) == row_count


def test_all_pvp_pairs_and_post_death_kills_exist_in_the_original_rows() -> None:
    pairs = pd.read_csv(EVIDENCE_DIRECTORY / "same_second_combat.csv")
    player_pairs = pairs[pairs.event_kill == "Kill"]
    assert player_pairs.timestamp_seconds.tolist() == [1770716419, 1770727293, 1770793941]
    assert player_pairs.has_same_world_position.tolist() == [True, True, True]
    for source_file in player_pairs.source_file_kill:
        raw_table = parquet.read_table(PROJECT_ROOT / "player_data" / source_file)
        raw_rows = raw_table.to_pandas()
        combat_rows = raw_rows[raw_rows.event.isin([b"Kill", b"Killed"])]
        assert combat_rows.event.tolist() == [b"Kill", b"Killed"]
        assert len(combat_rows[["x", "y", "z", "ts"]].drop_duplicates()) == 1
    later_rows = pd.read_csv(EVIDENCE_DIRECTORY / "post_death_rows.csv")
    later_kills = later_rows[later_rows.event == "BotKill"]
    assert sorted(later_kills.seconds_after_death.tolist()) == [3, 5]
    for row in later_kills.to_dict("records"):
        raw_table = parquet.read_table(PROJECT_ROOT / "player_data" / row["source_file"])
        raw_rows = raw_table.to_pandas()
        raw_rows["timestamp_seconds"] = raw_table.column("ts").cast("int64").to_pandas()
        assert raw_rows[raw_rows.event == b"BotKilled"].timestamp_seconds.tolist() == [
            row["death_timestamp_seconds"]
        ]
        assert (
            row["timestamp_seconds"]
            in raw_rows[raw_rows.event == b"BotKill"].timestamp_seconds.tolist()
        )


def test_report_totals_match_evidence_and_do_not_treat_missing_outcomes_as_survival() -> None:
    sessions = pd.read_csv(EVIDENCE_DIRECTORY / "sessions.csv")
    players = sessions[sessions.actor_type != "bot"]
    assert len(sessions) == 1242
    assert len(players) == 798
    assert int(players.traffic_seconds.sum()) == 314392
    assert int(players.uncredited_tail_seconds.sum()) == 3728
    assert int((players.uncredited_tail_seconds > 0).sum()) == 395
    assert int((players.death_count == 0).sum()) == 355
    assert players.loc[players.death_count == 0, "death_timestamp_seconds"].isna().all()
    assert int((players.traffic_seconds == 0).sum()) == 3
    assert players.uncredited_tail_seconds.max() == 454
    assert int((sessions.held_head_tail_seconds > 0).sum()) == 398
    report = DATA_QUALITY_REPORT_PATH.read_text()
    for required_text in [
        "**88,826 rows**",
        "**798 player sessions**",
        "**444 bot sessions**",
        "A strange record is not proof of a logging bug",
        "not that the player survived",
    ]:
        assert required_text in report


def test_report_evidence_links_resolve_to_committed_files() -> None:
    report = DATA_QUALITY_REPORT_PATH.read_text()
    evidence_link_prefix = "](docs/data-findings/telemetry-audit-evidence/"
    linked_names = [link.split(")", 1)[0] for link in report.split(evidence_link_prefix)[1:]]
    assert linked_names, f"{DATA_QUALITY_REPORT_PATH}: expected links to the audit evidence"
    for linked_name in linked_names:
        assert (EVIDENCE_DIRECTORY / linked_name).exists(), (
            f"{DATA_QUALITY_REPORT_PATH}: missing evidence {linked_name}"
        )


def test_misidentified_sessions_are_players_with_per_session_keys() -> None:
    finding_two = read_finding_section(2)
    assert "**17 files with numeric IDs emit `Position`**" in finding_two
    assert "never by ID format" in finding_two
    assert "Raw `user_id` values are kept" in finding_two
    assert "`misid-1429-3731eba6`" in finding_two
    assert "**Not established:** why the IDs are numeric" in finding_two
    sessions = pd.read_csv(EVIDENCE_DIRECTORY / "sessions.csv")
    assert int((sessions.actor_type == "human_misid").sum()) == 17


def test_pvp_pairs_record_the_unresolved_decision_without_confirming_a_mechanism() -> None:
    finding_six = read_finding_section(6)
    assert (
        "Simultaneous kill/death records; possible explosive self-kill or trade, "
        "with logging error still unresolved."
    ) in finding_six
    assert "One recorded player doesn't prove only one person was in the match" in finding_six
    assert "Both rows stay at their exact positions" in finding_six
    assert "not treated as confirmed PvP" in finding_six
    assert "97–157 seconds before" in finding_six


def test_pvp_pairs_have_no_other_tracks_or_nearby_combat_corroboration() -> None:
    inventory = pd.read_csv(EVIDENCE_DIRECTORY / "raw_files.csv")
    combat_pairs = pd.read_csv(EVIDENCE_DIRECTORY / "same_second_combat.csv")
    expected_previous_combat_gap_seconds = {
        1770716419: 157,
        1770727293: 97,
        1770793941: 102,
    }
    for pair in combat_pairs[combat_pairs.event_kill == "Kill"].to_dict("records"):
        sources = inventory[inventory.match_id == pair["match_id"]]
        assert sources.source_file.tolist() == [pair["source_file_kill"]]
        raw_table = parquet.read_table(PROJECT_ROOT / "player_data" / pair["source_file_kill"])
        raw_rows = raw_table.to_pandas()
        raw_rows["timestamp_seconds"] = raw_table.column("ts").cast("int64").to_pandas()
        other_combat = raw_rows[
            raw_rows.event.isin([b"Kill", b"Killed", b"BotKill", b"BotKilled", b"KilledByStorm"])
            & (raw_rows.timestamp_seconds != pair["timestamp_seconds"])
        ]
        assert set(other_combat.event) == {b"BotKill"}
        assert other_combat.timestamp_seconds.max() < pair["timestamp_seconds"]
        assert (
            pair["timestamp_seconds"] - other_combat.timestamp_seconds.max()
            == (expected_previous_combat_gap_seconds[pair["timestamp_seconds"]])
        )


def test_kills_after_death_are_kept_at_their_recorded_times() -> None:
    finding_seven = read_finding_section(7)
    assert "keep and count both kills at their recorded times" in finding_seven
    assert "Moving or deleting them would invent evidence" in finding_seven
    assert "We don't assume the player survived or respawned" in finding_seven


def test_post_death_drift_is_kept_without_setting_a_future_limit() -> None:
    finding_eight = read_finding_section(8)
    assert "the cause is unconfirmed" in finding_eight
    assert "Traffic ignores everything after a death" in finding_eight
    assert "Replay trails and area crossings use every row" in finding_eight
    assert "isn't a guaranteed limit for future data" in finding_eight
    later_rows = pd.read_csv(EVIDENCE_DIRECTORY / "post_death_rows.csv")
    positions_after_death = later_rows[later_rows.event == "Position"]
    assert len(positions_after_death) == 173
    assert positions_after_death.source_file.nunique() == 172
    assert positions_after_death.distance_from_death_world_units.max() < 2


def test_long_gaps_keep_interpolation_and_count_standing_still_before_death() -> None:
    finding_nine = read_finding_section(9)
    assert "a working assumption, not something the logger guarantees" in finding_nine
    assert "evenly along the straight line" in finding_nine
    assert "all the time goes there" in finding_nine
    assert "Gaps are not capped" in finding_nine
    assert "exactly that sample's world X and Z" in finding_nine
    assert "**1,275 seconds across 43 player sessions**" in finding_nine
    assert "454 seconds" in finding_nine
    report = DATA_QUALITY_REPORT_PATH.read_text()
    assert "Traffic figures are the baseline from before those changes" in report


def test_same_second_positions_keep_recorded_order() -> None:
    finding_ten = read_finding_section(10)
    assert "original row order within each second" in finding_ten
    assert "Replay can't recover movement or cause and effect inside a second" in finding_ten
    assert "We don't know the game's speed limits" in finding_ten


def test_event_waypoints_follow_the_replay_trail_without_snapping() -> None:
    finding_twelve = read_finding_section(12)
    assert "moving or traversing" in finding_twelve
    assert "never snapped onto a nearby sample" in finding_twelve
    assert "the same path the Replay trail draws" in finding_twelve
    assert "never treated as the victim's position" in finding_twelve


def test_repeated_actions_are_all_kept_and_player_side_count_is_stated() -> None:
    finding_thirteen = read_finding_section(13)
    assert "keep and count every row" in finding_thirteen
    assert '"recorded events"' in finding_thirteen
    assert "**2,236 player-side `BotKill` rows**" in finding_thirteen
    assert "2,406 includes 170 bot-side rows" in finding_thirteen
    repeated_groups = pd.read_csv(EVIDENCE_DIRECTORY / "repeated_event_groups.csv")
    assert len(repeated_groups) == 2319


def test_replay_states_never_make_an_ended_track_look_alive() -> None:
    finding_fourteen = read_finding_section(14)
    for state_row in ["| Moving |", "| Waiting |", "| Dead here |", "| Last seen here |"]:
        assert state_row in finding_fourteen
    assert "exactly the same world X and Z" in finding_fourteen
    assert "with no recorded death" in finding_fourteen
    assert "never looks like a live actor" in finding_fourteen
    assert "never called an extraction or survival" in finding_fourteen
    sessions = pd.read_csv(EVIDENCE_DIRECTORY / "sessions.csv")
    assert int((sessions.held_head_tail_seconds > 0).sum()) == 398


def test_open_questions_and_bot_coverage_keep_the_game_team_asks() -> None:
    report = DATA_QUALITY_REPORT_PATH.read_text()
    open_questions = report.split("## Open questions for the game team", 1)[1].split("\n## ", 1)[0]
    assert "Can the logger write a death event twice?" in open_questions
    assert "player-vs-player analysis and full match timelines aren't possible" in open_questions
    assert "Is there an extraction event that wasn't exported?" in open_questions
    finding_fourteen = read_finding_section(14)
    assert "95% of player `BotKill` rows have no bot-side counterpart" in finding_fourteen
    assert "never enter the kill and death heatmaps" in finding_fourteen
