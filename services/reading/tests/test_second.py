from reading.arbitration import Position
from reading.second import Second, second_of, with_second
from reading.tokens import line_tokens

CURLY = chr(0x2019)
BOX = (10, 10, 600, 60)

SUN = "Le soleil se leve"
SEA = "sur la mer calme"
BIRDS = "et les oiseaux chantent"


def mapping_of(b1: str, b2: str) -> dict[int, int]:
    second = second_of(b1, b2)
    assert second is not None
    return dict(second.mapping)


def test_two_readings_in_the_same_order_pair_word_for_word() -> None:
    b1 = f"{SUN}\n{SEA}\n{BIRDS}"
    second = second_of(b1, b1)
    assert second is not None
    assert dict(second.mapping) == {index: index for index in range(12)}
    assert (second.absent_from_b2, second.absent_from_b1) == ((), ())


def test_a_changed_word_is_still_paired_with_its_place() -> None:
    second = second_of(f"{SUN}\n{SEA}", f"{SUN}\nsur la mer calmes")
    assert second is not None
    assert dict(second.mapping) == {index: index for index in range(8)}


def test_lines_that_b2_writes_in_another_order_are_found_by_their_content() -> None:
    b1 = f"{SUN}\n{SEA}\n{BIRDS}"
    b2 = f"{BIRDS}\n{SUN}\n{SEA}"
    expected = {**{i: i + 4 for i in range(8)}, **{i: i - 8 for i in range(8, 12)}}
    assert mapping_of(b1, b2) == expected


def test_lines_in_another_order_with_a_changed_word_are_still_found() -> None:
    b1 = f"{SUN}\n{SEA}\n{BIRDS}"
    b2 = "et les oiseaux chantant\nLe soleil se lève\nsur la mer calme"
    expected = {**{i: i + 4 for i in range(8)}, **{i: i - 8 for i in range(8, 12)}}
    assert mapping_of(b1, b2) == expected


def test_a_line_b2_alone_has_is_named_and_leaves_the_others_paired() -> None:
    b1 = "un deux trois quatre\ncinq six sept huit"
    b2 = "un deux trois quatre\nzzzz yyyy\ncinq six sept huit"
    second = second_of(b1, b2)
    assert second is not None
    assert dict(second.mapping) == {0: 0, 1: 1, 2: 2, 3: 3, 4: 6, 5: 7, 6: 8, 7: 9}
    assert second.absent_from_b1 == (1,)
    assert second.absent_from_b2 == ()


def test_a_line_b1_alone_has_is_named() -> None:
    second = second_of("Jour 27\nLe chat dort ici", "Le chat dort ici")
    assert second is not None
    assert dict(second.mapping) == {2: 0, 3: 1, 4: 2, 5: 3}
    assert second.absent_from_b2 == (0,)
    assert second.absent_from_b1 == ()


def test_a_line_whose_words_b2_has_elsewhere_is_not_missing() -> None:
    second = second_of("a b\nc d\na b", "a b\nc d")
    assert second is not None
    assert second.absent_from_b2 == ()
    assert second.absent_from_b1 == ()


def test_a_line_is_counted_by_its_index_among_all_the_lines_of_the_text() -> None:
    second = second_of("Le chat dort\n\n\nJour 27\nfin du jour", "Le chat dort\nfin du jour")
    assert second is not None
    assert second.absent_from_b2 == (3,)


def test_the_words_are_compared_with_their_case_and_their_apostrophes_unified() -> None:
    second = second_of(f"l{CURLY}école ferme\nMarie dort", "l'école ferme\nmarie dort")
    assert second is not None
    assert dict(second.mapping) == {0: 0, 1: 1, 2: 2, 3: 3}
    assert second.tokens[2][0].text == "marie"


def test_a_second_reading_with_no_word_is_no_second_reading() -> None:
    assert second_of("Le chat dort", " - \n") is None
    assert second_of("Le chat dort", "") is None


def test_a_first_reading_with_no_word_is_no_second_reading() -> None:
    assert second_of("", "Le chat dort") is None


def test_pages_beyond_the_bound_of_the_cells_are_left_out() -> None:
    b1 = " ".join(f"mot{i}" for i in range(40))
    assert second_of(b1, b1, max_cells=40 * 40) is None
    assert second_of(b1, b1, max_cells=41 * 41) is not None


def test_pages_beyond_the_bound_of_the_letters_are_left_out() -> None:
    b1 = "chat chien"
    assert second_of(b1, b1, max_letter_pairs=80) is None
    assert second_of(b1, b1, max_letter_pairs=81) is not None


def test_a_search_that_runs_beyond_its_work_is_left_out() -> None:
    b1 = f"{SUN}\n{SEA}\n{BIRDS}"
    assert second_of(b1, f"{BIRDS}\n{SUN}\n{SEA}", max_work=50) is None


def second_positions(b1: str, b2: str) -> tuple[list[Position], Second]:
    positions = [
        Position(index, line, token.text, None, None, token.text, token.text, "word", BOX, index, 0.99)
        for index, (token, line) in enumerate(line_tokens(b1))
    ]
    second = second_of(b1, b2)
    assert second is not None
    return with_second(positions, second), second


def test_each_position_holds_the_word_b2_reads_there_and_its_place_in_b2() -> None:
    positions, _ = second_positions(f"{SUN}\n{SEA}", f"{SEA}\nLe soleil se lève")
    assert [(p.reading_b2, p.b2_index) for p in positions] == [
        ("Le", 4),
        ("soleil", 5),
        ("se", 6),
        ("lève", 7),
        ("sur", 0),
        ("la", 1),
        ("mer", 2),
        ("calme", 3),
    ]


def test_a_position_b2_did_not_read_holds_no_word() -> None:
    positions, _ = second_positions("Jour 27\nLe chat dort ici", "Le chat dort ici")
    assert [(p.reading_b2, p.b2_index) for p in positions[:2]] == [(None, None), (None, None)]
    assert [p.reading_b2 for p in positions[2:]] == ["Le", "chat", "dort", "ici"]


def test_every_other_field_of_a_position_is_kept_when_b2_is_attached() -> None:
    positions, _ = second_positions("Le chat", "Le chat")
    assert [(p.token_index, p.line_index, p.text, p.reading_a, p.reading_b1, p.anchor_kind) for p in positions] == [
        (0, 0, "Le", "Le", "Le", "word"),
        (1, 0, "chat", "chat", "chat", "word"),
    ]


def test_without_a_second_reading_the_positions_stay_as_they_are() -> None:
    positions = [Position(0, 0, "Le", None, None, "Le", "Le", "word", BOX, 0, 0.99)]
    assert with_second(positions, None) == positions
