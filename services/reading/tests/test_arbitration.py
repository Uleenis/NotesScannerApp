from decimal import Decimal

import pytest

from reading.arbitration import THRESHOLD, Model, Position, a_text, budgets_of, gate_open, positions_of
from reading.recognition import ReadLine, Word
from reading.refusal import RefusalError
from reading.tokens import line_tokens

L1 = (10, 10, 600, 60)
L2 = (10, 70, 600, 120)
L3 = (10, 130, 600, 180)
L4 = (10, 190, 600, 240)


def line(row: int, box: tuple[int, int, int, int], *words: tuple[str, int, int]) -> ReadLine:
    x0, y0, x1, y1 = box
    return ReadLine(
        row=row,
        box=box,
        ink=(x0 + 2, y0 + 5, x1 - 2, y1 - 5),
        words=tuple(Word(text, (left, y0, right, y1), 0.9) for text, left, right in words),
    )


def anchors(positions: list[Position]) -> list[tuple[str, str | None, tuple[int, int, int, int] | None]]:
    return [(p.text, p.anchor_kind, p.anchor) for p in positions]


def test_each_word_of_b1_is_one_position_with_its_rank_line_and_readings() -> None:
    lines = [line(1, L1, ("Le", 12, 60), ("chut", 70, 150))]
    positions = positions_of("Le chat\ndort", lines)
    assert positions == [
        Position(0, 0, "Le", None, None, "Le", "Le", "word", (12, 10, 60, 60)),
        Position(1, 0, "chat", None, None, "chut", "chat", "word", (70, 10, 150, 60)),
        Position(2, 1, "dort", None, None, None, "dort", None, None),
    ]


def test_three_kinds_of_anchor_word_line_of_a_hole_and_none() -> None:
    lines = [
        line(1, L1, ("Le", 12, 60), ("chat", 70, 150), ("dort", 160, 250)),
        line(2, L2),
        line(3, L3, ("le", 12, 60), ("soir", 70, 150)),
    ]
    positions = positions_of("Le chat dort\nsur le tapis\nle soir.\nFin", lines)
    assert anchors(positions) == [
        ("Le", "word", (12, 10, 60, 60)),
        ("chat", "word", (70, 10, 150, 60)),
        ("dort", "word", (160, 10, 250, 60)),
        ("sur", "line", L2),
        ("le", "line", L2),
        ("tapis", "line", L2),
        ("le", "word", (12, 130, 60, 130 + 50)),
        ("soir", "word", (70, 130, 150, 180)),
        ("Fin", None, None),
    ]
    assert [p.reading_a for p in positions] == ["Le", "chat", "dort", None, None, None, "le", "soir", None]


def test_a_word_a_did_not_read_on_a_line_it_read_takes_that_line() -> None:
    lines = [line(1, L1, ("Le", 12, 60), ("chat", 70, 150)), line(2, L2, ("Puis", 12, 80))]
    positions = positions_of("Le chat dort\nPuis", lines)
    assert anchors(positions) == [
        ("Le", "word", (12, 10, 60, 60)),
        ("chat", "word", (70, 10, 150, 60)),
        ("dort", "line", L1),
        ("Puis", "word", (12, 70, 80, 120)),
    ]


def test_lines_of_b1_in_a_hole_of_as_many_lines_take_one_line_each() -> None:
    lines = [line(1, L1, ("Un", 12, 60)), line(2, L2), line(3, L3), line(4, L4, ("Fin", 12, 60))]
    positions = positions_of("Un\ndeux mots\ntrois\nFin", lines)
    assert anchors(positions) == [
        ("Un", "word", (12, 10, 60, 60)),
        ("deux", "line", L2),
        ("mots", "line", L2),
        ("trois", "line", L3),
        ("Fin", "word", (12, 190, 60, 240)),
    ]


def test_lines_of_b1_in_a_hole_of_fewer_lines_take_the_box_of_the_hole() -> None:
    lines = [line(1, L1, ("Un", 12, 60)), line(2, L2), line(3, L3), line(4, L4, ("Fin", 12, 60))]
    positions = positions_of("Un\ndeux\ntrois\nquatre\nFin", lines)
    hole = (10, 70, 600, 180)
    assert anchors(positions) == [
        ("Un", "word", (12, 10, 60, 60)),
        ("deux", "line", hole),
        ("trois", "line", hole),
        ("quatre", "line", hole),
        ("Fin", "word", (12, 190, 60, 240)),
    ]


def test_a_word_of_a_split_into_several_words_of_b1_anchors_each_to_its_box() -> None:
    lines = [line(1, L1, ("12/05", 12, 120), ("l'été,", 130, 250))]
    positions = positions_of("12/05 l'été", lines)
    assert [(p.text, p.reading_a, p.anchor) for p in positions] == [
        ("12", "12", (12, 10, 120, 60)),
        ("05", "05", (12, 10, 120, 60)),
        ("l'été", "l'été", (130, 10, 250, 60)),
    ]


def test_no_line_read_leaves_every_word_without_anchor() -> None:
    positions = positions_of("Le chat\ndort", [])
    assert [(p.text, p.reading_a, p.anchor_kind, p.anchor) for p in positions] == [
        ("Le", None, None, None),
        ("chat", None, None, None),
        ("dort", None, None, None),
    ]


def test_an_empty_b1_has_no_position() -> None:
    assert positions_of("", [line(1, L1, ("Le", 12, 60))]) == []
    assert positions_of(" \n ", []) == []


def test_with_the_gate_closed_no_position_carries_a_rule_or_a_channel() -> None:
    lines = [line(1, L1, ("Le", 12, 60), ("chut", 70, 150))]
    for position in positions_of("Le chat dort", lines):
        assert position.rule is None
        assert position.channel is None
        assert position.text == position.reading_b1


def test_b1_is_kept_word_for_word_with_its_case_and_apostrophes() -> None:
    curly = chr(0x2019)
    b1 = f"L{curly}Homme de Paris"
    lines = [line(1, L1, ("lhomme", 12, 60), ("de", 70, 100), ("paris", 110, 200))]
    positions = positions_of(b1, lines)
    assert [(p.text, p.reading_a) for p in positions] == [
        (f"L{curly}Homme", "lhomme"),
        ("de", "de"),
        ("Paris", "paris"),
    ]


def test_a_hole_takes_no_word_when_b1_has_no_more_words_than_a() -> None:
    lines = [
        line(1, L1, ("trois", 10, 100), ("quatre", 110, 200), ("un", 210, 300)),
        line(2, L2),
        line(3, L3, ("cinq", 10, 100)),
    ]
    positions = positions_of("un trois six cinq", lines)
    assert [(p.text, p.reading_a) for p in positions] == [
        ("un", "trois"),
        ("trois", "quatre"),
        ("six", "un"),
        ("cinq", "cinq"),
    ]


def test_the_budget_of_a_hole_is_the_smaller_of_its_longest_lines_and_the_surplus() -> None:
    b1 = line_tokens("un deux trois\nquatre\ncinq\nsix")
    assert budgets_of({1: [2]}, b1, 1) == {1: 3}
    assert budgets_of({1: [2, 3]}, b1, 1) == {1: 4}
    assert budgets_of({1: [2, 3]}, b1, 4) == {1: 2}
    assert budgets_of({0: [0], 2: [3]}, b1, 6) == {0: 0, 2: 0}


def test_words_are_compared_with_apostrophes_unified() -> None:
    curly = chr(0x2019)
    lines = [line(1, L1, ("l'homme", 12, 100), (f"l{curly}hommes", 110, 200))]
    [position] = positions_of(f"l{curly}homme", lines)
    assert (position.text, position.reading_a, position.anchor) == (f"l{curly}homme", "l'homme", (12, 10, 100, 60))


def test_words_are_compared_with_their_case() -> None:
    lines = [line(1, L1, ("paris", 12, 100), ("Parisx", 110, 200))]
    [position] = positions_of("Paris", lines)
    assert position.reading_a == "Parisx"


def test_a_word_as_near_to_two_read_words_takes_the_line_of_the_one_before() -> None:
    lines = [line(1, L1, ("avant", 12, 100)), line(2, L2, ("apres", 12, 100))]
    positions = positions_of("avant zzzz apres", lines)
    assert anchors(positions) == [
        ("avant", "word", (12, 10, 100, 60)),
        ("zzzz", "line", L1),
        ("apres", "word", (12, 70, 100, 120)),
    ]


def test_a_page_too_long_to_align_is_refused_as_too_complex() -> None:
    lines = [line(1, L1, ("Le", 12, 60), ("chat", 70, 150))]
    with pytest.raises(RefusalError) as refused:
        positions_of("Le chat dort ici", lines, max_cells=10)
    assert (refused.value.status, refused.value.code) == (422, "too_complex")


def test_a_page_of_words_too_long_to_compare_is_refused_as_too_complex() -> None:
    lines = [line(1, L1, ("x" * 300, 12, 60))]
    with pytest.raises(RefusalError) as refused:
        positions_of(" ".join(["y" * 300] * 3), lines, max_letter_pairs=900 * 300 - 1)
    assert (refused.value.status, refused.value.code) == (422, "too_complex")
    assert len(positions_of(" ".join(["y" * 300] * 3), lines, max_letter_pairs=900 * 300)) == 3


def test_the_comparison_work_of_a_page_is_bounded() -> None:
    lines = [line(1, L1, *[("x" * 1_000, 12, 60)] * 1_000)]
    with pytest.raises(RefusalError):
        positions_of(" ".join(["y" * 1_000] * 100), lines)


def test_the_text_of_a_keeps_one_line_per_line_read() -> None:
    lines = [line(1, L1, ("Le", 12, 60), ("chat", 70, 150)), line(2, L2), line(3, L3, ("soir", 12, 60))]
    assert a_text(lines) == "Le chat\n\nsoir"
    assert a_text([]) == ""


def test_the_threshold_is_twelve_point_nine_percent() -> None:
    assert Decimal("0.129") == THRESHOLD


@pytest.mark.parametrize(
    ("models", "expected"),
    [
        pytest.param([], False, id="no personal model"),
        pytest.param([Model("active", Decimal("0.129"))], True, id="active at the threshold"),
        pytest.param([Model("active", Decimal("0.05"))], True, id="active below"),
        pytest.param([Model("active", Decimal("0.1291"))], False, id="active above"),
        pytest.param([Model("active", None)], False, id="active without a measure"),
        pytest.param([Model("candidate", Decimal("0.05"))], False, id="candidate"),
        pytest.param([Model("training", Decimal("0.05"))], False, id="training"),
        pytest.param([Model("retired", Decimal("0.05"))], False, id="retired"),
        pytest.param(
            [Model("retired", Decimal("0.05")), Model("active", Decimal("0.12"))], True, id="retired and active"
        ),
    ],
)
def test_the_gate_opens_only_on_an_active_personal_model_at_most_at_the_threshold(
    models: list[Model], expected: bool
) -> None:
    assert gate_open(models) is expected
