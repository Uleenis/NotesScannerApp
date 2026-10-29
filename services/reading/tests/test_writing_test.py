import pytest

from reading.recognition import Reading, ReadLine, Word
from reading.refusal import RefusalError
from reading.writing_test import (
    MAX_CER,
    SHEET_LINES,
    TRAINING_LINES,
    VALIDATION_LINES,
    SheetCount,
    cer,
    count_sheet,
    cut,
    read_lines,
    sheet_lines,
    template_lines,
)


def reading_of(lines: list[str]) -> Reading:
    return Reading(
        width=1000,
        height=1000,
        lines=tuple(
            ReadLine(
                row=index,
                box=(0, index * 10, 900, index * 10 + 9),
                ink=(0, index * 10, 900, index * 10 + 9),
                words=tuple(Word(text, (0, 0, 1, 1), 0.9) for text in line.split()),
            )
            for index, line in enumerate(lines)
        ),
        segment_seconds=0.0,
        recognize_seconds=0.0,
    )


def damaged(line: str, count: int) -> str:
    return "".join("#" if position < count and char != " " else char for position, char in enumerate(line))


def test_the_two_templates_have_forty_lines_of_35_to_45_characters() -> None:
    for template in ("fr", "en"):
        lines = template_lines(template)
        assert len(lines) == TRAINING_LINES + VALIDATION_LINES == 40
        assert all(35 <= len(line) <= 45 for line in lines), template


def test_a_sheet_is_twenty_consecutive_lines() -> None:
    lines = template_lines("fr")
    assert SHEET_LINES == 20
    assert sheet_lines("fr", 1) == lines[:20]
    assert sheet_lines("fr", 2) == lines[20:]


def test_an_unknown_template_or_sheet_is_refused() -> None:
    for template, sheet in (("de", 1), ("fr", 0), ("fr", 3)):
        with pytest.raises(RefusalError) as refused:
            sheet_lines(template, sheet)
        assert refused.value.code == "invalid_request"


def test_the_cer_is_the_edit_distance_over_the_length_of_the_piece() -> None:
    assert cer("abcdefghij", "abcdefghij") == 0.0
    assert cer("abcdefghij", "abcdefghix") == pytest.approx(0.1)
    assert cer("", "abcd") == 1.0
    assert cer("abcd", "") == float("inf")


def test_the_threshold_is_at_most_zero_point_six() -> None:
    assert MAX_CER == 0.6
    piece = "abcdefghij"
    assert cer("######ghij", piece) <= MAX_CER
    assert cer("#######hij", piece) > MAX_CER


def test_the_words_of_a_line_are_joined_by_one_space() -> None:
    assert read_lines(reading_of(["one two", "three"])) == ["one two", "three"]


def test_a_line_without_words_is_not_a_line() -> None:
    assert read_lines(reading_of(["one", "", "two"])) == ["one", "two"]


def test_the_reference_is_cut_where_the_read_text_breaks() -> None:
    reference = "alpha beta\ngamma delta\nepsilon"
    pieces = cut(reference, ["alpha beta", "gamma delta", "epsilon"])
    assert [piece.text for piece in pieces] == ["alpha beta", "gamma delta", "epsilon"]
    assert [(piece.first, piece.last) for piece in pieces] == [(0, 9), (11, 21), (23, 29)]


def test_a_line_broken_in_two_is_cut_in_two_pieces() -> None:
    reference = "alpha beta gamma\ndelta"
    pieces = cut(reference, ["alpha be", "ta gamma", "delta"])
    assert [piece.text for piece in pieces] == ["alpha be", "ta gamma", "delta"]


def test_two_lines_read_as_one_make_one_piece() -> None:
    reference = "alpha beta\ngamma delta"
    pieces = cut(reference, ["alpha beta gamma delta"])
    assert len(pieces) == 1
    assert (pieces[0].first, pieces[0].last) == (0, 21)


def test_a_badly_read_line_still_gets_the_piece_between_its_neighbours() -> None:
    reference = "alpha beta\ngamma delta\nepsilon zeta"
    pieces = cut(reference, ["alpha beta", "gxmma dxlta", "epsilon zeta"])
    assert [piece.text for piece in pieces] == ["alpha beta", "gamma delta", "epsilon zeta"]


def test_every_line_of_a_perfect_sheet_is_kept_by_its_part() -> None:
    lines = list(template_lines("fr"))
    assert count_sheet("fr", 1, lines[:20]) == SheetCount(lines=20, training=20, validation=0)
    assert count_sheet("en", 2, list(template_lines("en"))[20:]) == SheetCount(lines=20, training=10, validation=10)


def test_a_line_read_with_a_cer_above_the_threshold_is_dropped_and_the_others_kept() -> None:
    lines = list(template_lines("fr"))[:20]
    lines[4] = damaged(lines[4], len(lines[4]))
    assert count_sheet("fr", 1, lines) == SheetCount(lines=20, training=19, validation=0)


def test_a_line_read_with_a_cer_under_the_threshold_is_kept() -> None:
    lines = list(template_lines("fr"))[:20]
    lines[4] = damaged(lines[4], len(lines[4]) // 3)
    assert count_sheet("fr", 1, lines).training == 20


def test_validation_lines_are_counted_apart_from_training_lines() -> None:
    lines = list(template_lines("fr"))[20:]
    lines[2] = damaged(lines[2], len(lines[2]))
    lines[15] = damaged(lines[15], len(lines[15]))
    assert count_sheet("fr", 2, lines) == SheetCount(lines=20, training=9, validation=9)


def test_a_line_that_covers_the_end_of_training_and_the_start_of_validation_is_dropped() -> None:
    lines = list(template_lines("fr"))[20:]
    merged = [*lines[:9], lines[9] + " " + lines[10], *lines[11:]]
    assert count_sheet("fr", 2, merged) == SheetCount(lines=19, training=9, validation=9)


def test_a_line_of_the_model_cut_in_two_counts_once() -> None:
    lines = list(template_lines("fr"))[:20]
    halves = [half for line in lines for half in (line[:20], line[20:])]
    counted = count_sheet("fr", 1, halves)
    assert counted.lines == 40
    assert counted.training == 20


def test_lines_of_the_model_missing_from_the_page_are_not_made_up_by_cut_lines() -> None:
    lines = list(template_lines("fr"))[:20]
    kept = lines[:16]
    halves = [half for line in kept for half in (line[:20], line[20:])]
    assert count_sheet("fr", 1, halves).training == 16


def test_two_lines_of_the_model_read_as_one_count_as_two() -> None:
    lines = list(template_lines("fr"))[:20]
    merged = [lines[0] + " " + lines[1], *lines[2:]]
    assert count_sheet("fr", 1, merged) == SheetCount(lines=19, training=20, validation=0)


def test_the_threshold_holds_through_the_count_of_a_sheet() -> None:
    lines = list(template_lines("fr"))[:20]
    size = len(lines[4])
    edits = int(MAX_CER * size)
    at_threshold = [*lines[:4], "#" * edits + lines[4][edits:], *lines[5:]]
    over_threshold = [*lines[:4], "#" * (edits + 1) + lines[4][edits + 1 :], *lines[5:]]
    assert count_sheet("fr", 1, at_threshold).training == 20
    assert count_sheet("fr", 1, over_threshold).training == 19


def test_text_that_is_not_the_template_keeps_nothing() -> None:
    noise = ["zzzz qqqq xxxx wwww vvvv kkkk jjjj"] * 20
    assert count_sheet("fr", 1, noise) == SheetCount(lines=20, training=0, validation=0)


def test_nothing_read_keeps_nothing() -> None:
    assert count_sheet("fr", 2, []) == SheetCount(lines=0, training=0, validation=0)


def test_a_read_text_above_the_bound_is_too_complex() -> None:
    with pytest.raises(RefusalError) as refused:
        count_sheet("fr", 1, ["x" * 1_000] * 5)
    assert refused.value.code == "too_complex"


def test_more_than_sixty_lines_are_too_complex() -> None:
    with pytest.raises(RefusalError) as refused:
        count_sheet("fr", 1, ["ab"] * 61)
    assert refused.value.code == "too_complex"
