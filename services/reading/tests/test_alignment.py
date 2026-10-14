import pytest

from reading.alignment import Step, align_blocks, cells, sub_cost


def pairs(steps: list[Step]) -> list[tuple[int | None, int | None]]:
    return [(step.ref, step.hyp) for step in steps]


def test_the_cost_of_a_substitution_is_its_share_of_edited_letters() -> None:
    assert sub_cost("chat", "chat") == 0.0
    assert sub_cost("chat", "chut") == 0.25
    assert sub_cost("a", "xyz") == 1.0
    assert sub_cost("Paris", "paris") == 0.2


@pytest.mark.parametrize(
    ("ref", "hyp", "budgets", "expected"),
    [
        pytest.param(["le", "chat", "dort"], ["le", "chut", "dort"], {}, [(0, 0), (1, 1), (2, 2)], id="substitution"),
        pytest.param(["a", "b"], ["a", "x", "b"], {}, [(0, 0), (None, 1), (1, 2)], id="insertion"),
        pytest.param(
            ["il", "fait", "beau", "et", "chaud", "ici", "demain", "matin"],
            ["il", "fait", "ici", "demain", "matin"],
            {},
            [(0, 0), (1, 1), (2, None), (3, None), (4, None), (5, 2), (6, 3), (7, 4)],
            id="deletions",
        ),
        pytest.param(
            ["maison", "jardin", "maison", "porte"],
            ["maisan", "porte"],
            {},
            [(0, None), (1, None), (2, 0), (3, 1)],
            id="substitution cheaper than a deletion",
        ),
        pytest.param(
            ["un", "deux", "trois", "quatre", "cinq"],
            ["un", "cinq"],
            {1: 3},
            [(0, 0), (1, None), (2, None), (3, None), (4, 1)],
            id="hole absorbs",
        ),
        pytest.param(
            ["pont", "mur", "lune", "une"],
            ["mur", "mur"],
            {},
            [(0, None), (1, 0), (2, 1), (3, None)],
            id="without the hole",
        ),
        pytest.param(
            ["pont", "mur", "lune", "une"],
            ["mur", "mur"],
            {0: 2},
            [(0, None), (1, None), (2, 0), (3, 1)],
            id="with the hole",
        ),
        pytest.param(
            ["pont", "port", "mars", "pont", "pont"],
            ["mur", "pot", "lune"],
            {1: 1},
            [(0, None), (1, 0), (2, None), (3, 1), (4, 2)],
            id="hole of one token",
        ),
        pytest.param([], ["a"], {}, [(None, 0)], id="no reference"),
        pytest.param(["a", "b"], [], {0: 1}, [(0, None), (1, None)], id="no hypothesis"),
        pytest.param([], [], {}, [], id="nothing"),
    ],
)
def test_the_block_aligner_pairs_as_the_signal_spike(
    ref: list[str], hyp: list[str], budgets: dict[int, int], expected: list[tuple[int | None, int | None]]
) -> None:
    assert pairs(align_blocks(ref, hyp, budgets)) == expected


def test_an_unpaired_reference_word_knows_the_column_it_falls_in() -> None:
    steps = align_blocks(["un", "deux", "trois", "quatre", "cinq"], ["un", "cinq"], {1: 3})
    assert [(step.ref, step.column) for step in steps] == [(0, 0), (1, 1), (2, 1), (3, 1), (4, 1)]


def test_a_word_left_out_after_the_last_column_falls_in_the_last_column() -> None:
    steps = align_blocks(["a", "b", "c"], ["a"], {})
    assert [(step.ref, step.hyp, step.column) for step in steps] == [(0, 0, 0), (1, None, 1), (2, None, 1)]


def test_the_work_grows_with_the_budgets_of_the_holes() -> None:
    assert cells(10, 20, {}) == 11 * 21
    assert cells(10, 20, {3: 4, 7: 2}) == 11 * (21 + 6)
