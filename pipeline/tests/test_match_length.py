"""A match whose rows all share one timestamp (length 0) breaks the contract: the timestamps were
recorded wrongly, so the build fails and names the match and its files."""

from pathlib import Path

from fixtures import write_raw_file
from lila_pipeline.raw_files import RawFile, read_raw_file
from lila_pipeline.validate import find_zero_length_match_problems

HUMAN_ID = "f4e072fa-b7af-4761-b567-1d95b7ad0108"
SECOND_HUMAN_ID = "0a1b2c3d-4e5f-6789-abcd-ef0123456789"
BOT_ID = "1429"
MATCH_ID = "3731eba6-1111-2222-3333-444444444444.nakama-0"
OTHER_MATCH_ID = "9999eba6-1111-2222-3333-444444444444.nakama-0"


def load_raw_file(
    tmp_path: Path,
    user_id: str,
    match_id: str,
    rows: list[tuple[float, float, int, str]],
) -> RawFile:
    path = write_raw_file(tmp_path / "February_10", user_id, match_id, "Lockdown", rows)
    return read_raw_file(path, "February_10")


def test_match_with_every_row_in_one_second_is_a_problem_naming_match_and_files(
    tmp_path: Path,
) -> None:
    human_file = load_raw_file(
        tmp_path, HUMAN_ID, MATCH_ID, [(0.0, 0.0, 100, "Position"), (1.0, 1.0, 100, "Kill")]
    )
    bot_file = load_raw_file(tmp_path, BOT_ID, MATCH_ID, [(2.0, 2.0, 100, "BotPosition")])

    problems = find_zero_length_match_problems([human_file, bot_file])

    assert problems == [
        f"February_10/{BOT_ID}_{MATCH_ID}, February_10/{HUMAN_ID}_{MATCH_ID}: "
        f"match '{MATCH_ID}' has every row (3 rows) recorded at the same second (timestamp 100), "
        "so its length is 0 s. Events were recorded but their timestamps are wrong."
    ]


def test_single_row_match_is_a_problem(tmp_path: Path) -> None:
    only_file = load_raw_file(tmp_path, HUMAN_ID, MATCH_ID, [(0.0, 0.0, 100, "Position")])

    problems = find_zero_length_match_problems([only_file])

    assert len(problems) == 1
    assert f"match '{MATCH_ID}' has every row (1 row) recorded" in problems[0]


def test_match_spread_across_actors_is_not_a_problem(tmp_path: Path) -> None:
    # Each file alone sits in one second, but the match spans 100 s to 101 s.
    first_file = load_raw_file(tmp_path, HUMAN_ID, MATCH_ID, [(0.0, 0.0, 100, "Position")])
    second_file = load_raw_file(tmp_path, SECOND_HUMAN_ID, MATCH_ID, [(1.0, 1.0, 101, "Position")])

    assert find_zero_length_match_problems([first_file, second_file]) == []


def test_only_the_zero_length_match_is_reported(tmp_path: Path) -> None:
    good_file = load_raw_file(
        tmp_path, HUMAN_ID, MATCH_ID, [(0.0, 0.0, 100, "Position"), (1.0, 1.0, 160, "Position")]
    )
    broken_file = load_raw_file(
        tmp_path, SECOND_HUMAN_ID, OTHER_MATCH_ID, [(0.0, 0.0, 500, "Position")]
    )

    problems = find_zero_length_match_problems([good_file, broken_file])

    assert len(problems) == 1
    assert problems[0].startswith(f"February_10/{SECOND_HUMAN_ID}_{OTHER_MATCH_ID}: ")
    assert f"match '{OTHER_MATCH_ID}'" in problems[0]
