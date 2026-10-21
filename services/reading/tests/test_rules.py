from collections.abc import Collection, Sequence

import pytest

from reading.arbitration import Position
from reading.refusal import RefusalError, too_complex
from reading.rules import CONFIDENCE, Rules, SecondRefusedError
from reading.tokens import line_tokens

CURLY = chr(0x2019)
BOX = (10, 10, 600, 60)


class FakePhonemes:
    def __init__(self, table: dict[str, str] | None = None) -> None:
        self.table = table or {}
        self.calls: list[tuple[list[str], str]] = []

    def phonemes(self, words: Sequence[str], language: str) -> list[str]:
        self.calls.append((list(words), language))
        return [self.table.get(word, "") for word in words]


class FakeEntities:
    def __init__(self, names: set[str] | None = None) -> None:
        self.names = names or set()
        self.texts: list[str] = []

    def flags(self, text: str) -> list[bool]:
        self.texts.append(text)
        return [token.text in self.names for token, _ in line_tokens(text)]


class Witness:
    def __init__(
        self,
        b1: str,
        a: Sequence[tuple[str, float] | None],
        b2: Sequence[str | None] | None = None,
        missing: Collection[int] = (),
    ) -> None:
        self.b1 = b1
        b1_tokens = line_tokens(b1)
        assert len(b1_tokens) == len(a)
        assert b2 is None or len(b2) == len(a)
        read = [reading for reading in a if reading is not None]
        self.a = " ".join(text for text, _ in read)
        second = [] if b2 is None else [word for word in b2 if word is not None]
        self.b2 = None if b2 is None else " ".join(second)
        self.missing = frozenset(missing)
        self.positions: list[Position] = []
        a_index = 0
        b2_index = 0
        for index, ((token, line), reading) in enumerate(zip(b1_tokens, a, strict=True)):
            word = None if b2 is None else b2[index]
            seen = None
            if word is not None:
                seen = b2_index
                b2_index += 1
            if reading is None:
                self.positions.append(
                    Position(index, line, token.text, None, None, None, token.text, None, None, None, None, word, seen)
                )
                continue
            text, confidence = reading
            self.positions.append(
                Position(
                    index, line, token.text, None, None, text, token.text, "word", BOX, a_index, confidence, word, seen
                )
            )
            a_index += 1


def decide(
    witness: Witness,
    language: str | None = "fr",
    level: str = "course",
    phonemes: FakePhonemes | None = None,
    entities: FakeEntities | None = None,
) -> list[tuple[str, int | None, str | None]]:
    rules = Rules(phonemes or FakePhonemes(), entities or FakeEntities())
    decided = rules.decide(
        witness.positions, witness.b1, witness.a, language, level, b2=witness.b2, missing=witness.missing
    )
    return [(p.text, p.rule, p.channel) for p in decided]


SURE = CONFIDENCE
HOMOPHONES = {"fais": "fɛ", "fait": "fɛ", "vers": "vɛʁ", "vert": "vɛʁ"}


def test_a_number_read_differently_goes_to_the_layer_and_the_queue_with_b1() -> None:
    witness = Witness("le 15 mai", [("le", SURE), ("16", SURE), ("mai", SURE)])
    assert decide(witness)[1] == ("15", 2, "queue")


def test_a_digit_in_a_alone_makes_the_word_a_number() -> None:
    witness = Witness("le lo", [("le", SURE), ("l0", SURE)])
    assert decide(witness)[1] == ("lo", 2, "queue")


def test_a_number_both_read_alike_is_harvested() -> None:
    witness = Witness("le 15", [("le", SURE), ("15", SURE)])
    assert decide(witness)[1] == ("15", 9, "none")


def test_a_number_a_did_not_read_falls_to_rule_ten() -> None:
    witness = Witness("le 15", [("le", SURE), None])
    assert decide(witness)[1] == ("15", 10, "none")


def test_a_proper_noun_of_b1_goes_to_the_layer_even_when_both_agree() -> None:
    witness = Witness("Marie dort", [("Marie", SURE), ("dort", SURE)])
    assert decide(witness, entities=FakeEntities({"Marie"}))[0] == ("Marie", 3, "layer")


def test_a_proper_noun_seen_in_a_alone_is_a_proper_noun() -> None:
    witness = Witness("Einstein dort", [("Einsein", 0.5), ("dort", SURE)])
    entities = FakeEntities({"Einsein"})
    assert decide(witness, entities=entities)[0] == ("Einstein", 3, "layer")
    assert entities.texts == ["Einstein dort", "Einsein dort"]


def test_a_number_outranks_a_proper_noun() -> None:
    witness = Witness("Jour 15", [("Jour", SURE), ("16", SURE)])
    assert decide(witness, entities=FakeEntities({"15"}))[1] == ("15", 2, "queue")


def test_a_number_flagged_as_a_proper_noun_both_read_alike_is_harvested() -> None:
    witness = Witness("Jour 15", [("Jour", SURE), ("15", SURE)])
    assert decide(witness, entities=FakeEntities({"15"}))[1] == ("15", 9, "none")


def test_a_number_flagged_as_a_proper_noun_a_did_not_read_falls_to_rule_ten() -> None:
    witness = Witness("Jour 15", [("Jour", SURE), None])
    assert decide(witness, entities=FakeEntities({"15"}))[1] == ("15", 10, "none")


def test_homophones_one_edit_apart_write_a_on_a_journal_notebook() -> None:
    witness = Witness("je fait", [("je", SURE), ("fais", SURE)])
    phonemes = FakePhonemes(HOMOPHONES)
    assert decide(witness, level="journal", phonemes=phonemes)[1] == ("fais", 4, "layer")
    assert phonemes.calls == [(["fais", "fait"], "fr")]


def test_homophones_one_edit_apart_write_b1_on_a_course_notebook() -> None:
    witness = Witness("je fait", [("je", SURE), ("fais", SURE)])
    assert decide(witness, level="course", phonemes=FakePhonemes(HOMOPHONES))[1] == ("fait", 4, "layer")


def test_rule_four_needs_a_confidence_of_at_least_the_threshold() -> None:
    witness = Witness("je fait", [("je", SURE), ("fais", 0.9899)])
    phonemes = FakePhonemes(HOMOPHONES)
    assert decide(witness, level="journal", phonemes=phonemes)[1] == ("fait", 8, "layer")
    assert phonemes.calls == []


def test_rule_four_holds_at_exactly_the_threshold() -> None:
    witness = Witness("un vers", [("un", SURE), ("vert", 0.99)])
    assert decide(witness, level="journal", phonemes=FakePhonemes(HOMOPHONES))[1] == ("vert", 4, "layer")


def test_rule_four_needs_exactly_one_edit() -> None:
    witness = Witness("je fais", [("je", SURE), ("faites", SURE)])
    phonemes = FakePhonemes({"fais": "fɛ", "faites": "fɛ"})
    assert decide(witness, level="journal", phonemes=phonemes)[1] == ("fais", 8, "layer")
    assert phonemes.calls == []


def test_rule_four_needs_homophones() -> None:
    witness = Witness("il a pu", [("il", SURE), ("a", SURE), ("du", SURE)])
    phonemes = FakePhonemes({"pu": "py", "du": "dy"})
    assert decide(witness, level="journal", phonemes=phonemes)[2] == ("pu", 8, "layer")


def test_a_word_espeak_did_not_read_is_no_homophone() -> None:
    witness = Witness("la lire", [("la", SURE), ("line", SURE)])
    assert decide(witness, level="journal", phonemes=FakePhonemes())[1] == ("lire", 8, "layer")


def test_rule_four_leaves_out_pairs_that_differ_by_an_accent_alone() -> None:
    witness = Witness("il est à Paris", [("il", SURE), ("est", SURE), ("a", SURE), ("Paris", SURE)])
    phonemes = FakePhonemes({"a": "a", "à": "a"})
    assert decide(witness, level="journal", phonemes=phonemes)[2] == ("à", 8, "layer")
    assert phonemes.calls == []


@pytest.mark.parametrize(
    ("b1", "a"),
    [
        pytest.param("notre", "notr", id="a is a prefix"),
        pytest.param("jours", "jour", id="a drops the last letter"),
        pytest.param("jours", "ours", id="a is a suffix"),
        pytest.param("jour", "jours", id="b1 is shorter"),
    ],
)
def test_rule_four_leaves_out_truncations(b1: str, a: str) -> None:
    witness = Witness(f"le {b1}", [("le", SURE), (a, SURE)])
    phonemes = FakePhonemes({b1: "ʒuʁ", a: "ʒuʁ"})
    assert decide(witness, level="journal", phonemes=phonemes)[1] == (b1, 8, "layer")
    assert phonemes.calls == []


def test_a_proper_noun_never_reaches_rule_four() -> None:
    witness = Witness("Paul fait", [("Paul", SURE), ("fais", SURE)])
    phonemes = FakePhonemes(HOMOPHONES)
    assert decide(witness, level="journal", phonemes=phonemes, entities=FakeEntities({"fait"}))[1] == (
        "fait",
        3,
        "layer",
    )
    assert phonemes.calls == []


def test_the_phonemes_of_a_page_are_asked_once_for_its_distinct_forms() -> None:
    witness = Witness(
        "je fait et il fait un vers",
        [("je", SURE), ("fais", SURE), ("et", SURE), ("il", SURE), ("fais", SURE), ("un", SURE), ("vert", SURE)],
    )
    phonemes = FakePhonemes(HOMOPHONES)
    decided = decide(witness, level="journal", phonemes=phonemes)
    assert [rule for _, rule, _ in decided] == [9, 4, 9, 9, 4, 9, 4]
    assert phonemes.calls == [(["fais", "fait", "vers", "vert"], "fr")]


def test_a_disagreement_left_by_the_other_rules_goes_to_the_layer_with_b1() -> None:
    witness = Witness("le chat dort", [("le", SURE), ("chut", 0.6), ("dort", SURE)])
    assert decide(witness)[1] == ("chat", 8, "layer")


def test_agreement_of_a_and_b1_is_harvested() -> None:
    witness = Witness("le chat", [("le", SURE), ("chat", 0.4)])
    assert decide(witness) == [("le", 9, "none"), ("chat", 9, "none")]


def test_a_word_a_did_not_read_falls_to_rule_ten() -> None:
    witness = Witness("le chat", [("le", SURE), None])
    assert decide(witness)[1] == ("chat", 10, "none")


def test_readings_are_compared_with_their_case() -> None:
    witness = Witness("le Chat", [("le", SURE), ("chat", SURE)])
    assert decide(witness)[1] == ("Chat", 8, "layer")


def test_readings_are_compared_with_their_apostrophes_unified() -> None:
    witness = Witness(f"l{CURLY}école", [("l'école", SURE)])
    assert decide(witness) == [(f"l{CURLY}école", 9, "none")]


def test_a_word_without_its_apostrophe_is_another_word() -> None:
    witness = Witness("l'école", [("lécole", SURE)])
    assert decide(witness) == [("l'école", 8, "layer")]


def test_every_other_field_of_a_position_is_kept() -> None:
    witness = Witness("je fait", [("je", SURE), None])
    rules = Rules(FakePhonemes(), FakeEntities())
    decided = rules.decide(witness.positions, witness.b1, witness.a, "fr", "course")
    assert [(p.token_index, p.line_index, p.reading_a, p.reading_b1, p.anchor_kind, p.anchor) for p in decided] == [
        (0, 0, "je", "je", "word", BOX),
        (1, 0, None, "fait", None, None),
    ]


def test_an_english_page_never_reaches_the_entities_and_reads_its_homophones_in_english() -> None:
    witness = Witness("Paris by the sea", [("Paris", SURE), ("by", SURE), ("the", SURE), ("see", SURE)])
    entities = FakeEntities({"Paris"})
    phonemes = FakePhonemes({"sea": "si", "see": "si"})
    assert decide(witness, language="en", level="journal", phonemes=phonemes, entities=entities) == [
        ("Paris", 9, "none"),
        ("by", 9, "none"),
        ("the", 9, "none"),
        ("see", 4, "layer"),
    ]
    assert entities.texts == []
    assert phonemes.calls == [(["sea", "see"], "en")]


@pytest.mark.parametrize("language", [pytest.param("es", id="other latin"), pytest.param(None, id="unknown")])
def test_another_language_runs_neither_entities_nor_rule_four(language: str | None) -> None:
    witness = Witness("Marta fait", [("Marta", SURE), ("fais", SURE)])
    entities = FakeEntities({"Marta"})
    phonemes = FakePhonemes(HOMOPHONES)
    assert decide(witness, language=language, level="journal", phonemes=phonemes, entities=entities) == [
        ("Marta", 9, "none"),
        ("fait", 8, "layer"),
    ]
    assert entities.texts == []
    assert phonemes.calls == []


def test_a_french_page_goes_through_the_entities_of_b1_and_of_a() -> None:
    witness = Witness("le chat\ndort", [("le", SURE), ("chat", SURE), None])
    entities = FakeEntities()
    decide(witness, entities=entities)
    assert entities.texts == ["le chat\ndort", "le chat"]


def test_entities_that_do_not_cover_every_word_are_refused() -> None:
    class Short(FakeEntities):
        def flags(self, text: str) -> list[bool]:
            return super().flags(text)[:-1]

    witness = Witness("le chat", [("le", SURE), ("chat", SURE)])
    with pytest.raises(ValueError, match="entities"):
        decide(witness, entities=Short())


def test_phonemes_that_do_not_cover_every_word_are_refused() -> None:
    class Short(FakePhonemes):
        def phonemes(self, words: Sequence[str], language: str) -> list[str]:
            return super().phonemes(words, language)[:-1]

    witness = Witness("je fait", [("je", SURE), ("fais", SURE)])
    with pytest.raises(ValueError, match="phonemes"):
        decide(witness, level="journal", phonemes=Short(HOMOPHONES))


def test_where_a_confirms_b1_against_b2_the_layer_keeps_b1() -> None:
    witness = Witness("le chat dort", [("le", SURE), ("chat", 0.4), ("dort", SURE)], b2=["le", "chut", "dort"])
    assert decide(witness) == [("le", 9, "none"), ("chat", 5, "layer"), ("dort", 9, "none")]


def test_where_a_confirms_b2_against_b1_the_layer_writes_the_word_of_b2() -> None:
    witness = Witness("le chut dort", [("le", SURE), ("chat", 0.4), ("dort", SURE)], b2=["le", "chat", "dort"])
    assert decide(witness)[1] == ("chat", 5, "layer")


def test_the_word_rule_five_writes_is_the_word_of_b2_as_it_was_read() -> None:
    witness = Witness("le chut", [("le", SURE), ("Chat", 0.4)], b2=["le", "Chat"])
    assert decide(witness)[1] == ("Chat", 5, "layer")


def test_a_number_a_reads_differently_from_b1_goes_to_the_queue_even_when_a_agrees_with_b2() -> None:
    witness = Witness("Jour 15", [("Jour", SURE), ("16", SURE)], b2=["Jour", "16"])
    assert decide(witness)[1] == ("15", 2, "queue")


def test_a_digit_in_b2_alone_makes_the_word_a_number() -> None:
    witness = Witness("le lo", [("le", SURE), ("lc", SURE)], b2=["le", "l0"])
    assert decide(witness)[1] == ("lo", 2, "queue")


def test_a_number_b1_and_a_agree_on_against_b2_goes_to_the_layer_by_rule_five() -> None:
    witness = Witness("le 15", [("le", SURE), ("15", SURE)], b2=["le", "16"])
    assert decide(witness)[1] == ("15", 5, "layer")


def test_rule_five_comes_before_the_proper_nouns() -> None:
    witness = Witness("Marie dort", [("Marie", SURE), ("dort", SURE)], b2=["Marle", "dort"])
    assert decide(witness, entities=FakeEntities({"Marie", "Marle"}))[0] == ("Marie", 5, "layer")


def test_a_proper_noun_b2_alone_names_is_a_proper_noun() -> None:
    witness = Witness("Marc dort", [("Mare", 0.5), ("dort", SURE)], b2=["Marie", "dort"])
    entities = FakeEntities({"Marie"})
    assert decide(witness, entities=entities)[0] == ("Marc", 3, "layer")
    assert entities.texts == ["Marc dort", "Mare dort", "Marie dort"]


def test_a_proper_noun_both_passes_agree_on_still_goes_to_the_layer() -> None:
    witness = Witness("Marie dort", [("Marie", SURE), ("dort", SURE)], b2=["Marie", "dort"])
    assert decide(witness, entities=FakeEntities({"Marie"}))[0] == ("Marie", 3, "layer")


def test_rule_four_comes_before_rule_six() -> None:
    witness = Witness("je fait", [("je", SURE), ("fais", SURE)], b2=["je", "fée"])
    assert decide(witness, level="journal", phonemes=FakePhonemes(HOMOPHONES))[1] == ("fais", 4, "layer")


def test_a_word_a_confirms_in_neither_pass_goes_to_the_queue_with_b1() -> None:
    witness = Witness("le chat dort", [("le", SURE), ("chut", 0.4), ("dort", SURE)], b2=["le", "chit", "dort"])
    assert decide(witness)[1] == ("chat", 6, "queue")


def test_a_word_a_did_not_read_and_the_passes_disagree_on_goes_to_the_queue_with_b1() -> None:
    witness = Witness("le chat", [("le", SURE), None], b2=["le", "chut"])
    assert decide(witness)[1] == ("chat", 6, "queue")


def test_a_number_a_did_not_read_and_the_passes_disagree_on_goes_to_the_queue_by_rule_six() -> None:
    witness = Witness("le 15", [("le", SURE), None], b2=["le", "16"])
    assert decide(witness)[1] == ("15", 6, "queue")


def test_a_proper_noun_the_passes_disagree_on_without_a_goes_to_the_layer_by_rule_three() -> None:
    witness = Witness("Marc dort", [None, ("dort", SURE)], b2=["Marie", "dort"])
    assert decide(witness, entities=FakeEntities({"Marc"}))[0] == ("Marc", 3, "layer")


def test_the_words_of_a_missing_line_are_written_b1_by_rule_seven_with_no_channel() -> None:
    witness = Witness(
        "Jour 27\nle chat",
        [("Jour", SURE), ("27", SURE), ("le", SURE), ("chat", SURE)],
        b2=[None, None, "le", "chat"],
        missing={0},
    )
    assert decide(witness) == [("Jour", 7, "none"), ("27", 7, "none"), ("le", 9, "none"), ("chat", 9, "none")]


def test_rule_seven_comes_before_the_disagreement_of_a() -> None:
    witness = Witness(
        "Jour 27\nle chat",
        [("Jouf", 0.5), None, ("le", SURE), ("chat", SURE)],
        b2=[None, None, "le", "chat"],
        missing={0},
    )
    assert decide(witness)[:2] == [("Jour", 7, "none"), ("27", 7, "none")]


def test_rule_six_comes_before_rule_seven() -> None:
    witness = Witness("le chat", [("le", SURE), ("chut", 0.4)], b2=["le", "chit"], missing={0})
    assert decide(witness) == [("le", 7, "none"), ("chat", 6, "queue")]


def test_rule_nine_asks_for_a_and_b1_only() -> None:
    witness = Witness("le chat", [("le", SURE), ("chat", 0.4)])
    assert decide(witness) == [("le", 9, "none"), ("chat", 9, "none")]


def test_the_three_readings_agreeing_are_harvested_by_rule_nine() -> None:
    witness = Witness("le chat", [("le", SURE), ("chat", 0.4)], b2=["le", "chat"])
    assert decide(witness) == [("le", 9, "none"), ("chat", 9, "none")]


def test_rule_ten_keeps_the_word_a_did_not_read_when_the_passes_agree() -> None:
    witness = Witness("le chat", [("le", SURE), None], b2=["le", "chat"])
    assert decide(witness)[1] == ("chat", 10, "none")


def test_the_passes_are_compared_in_their_form() -> None:
    witness = Witness(f"l{CURLY}école Chat", [("l'école", SURE), ("chat", SURE)], b2=["l'école", "chat"])
    assert decide(witness) == [(f"l{CURLY}école", 9, "none"), ("chat", 5, "layer")]


def test_the_nine_rules_apply_each_in_its_place() -> None:
    witness = Witness(
        "15\nchat\nMarie\nfait\nvrai\nJour\nsol\noui\nnon",
        [
            ("16", SURE),
            ("chat", SURE),
            ("Marle", SURE),
            ("fais", SURE),
            None,
            ("Jour", 0.5),
            ("sal", 0.5),
            ("oui", SURE),
            None,
        ],
        b2=["16", "chut", "Marie", "fée", "vroi", None, "sol", "oui", "non"],
        missing={5},
    )
    decided = decide(witness, level="journal", phonemes=FakePhonemes(HOMOPHONES), entities=FakeEntities({"Marie"}))
    assert [rule for _, rule, _ in decided] == [2, 5, 3, 4, 6, 7, 8, 9, 10]


@pytest.mark.parametrize(
    ("b1", "b2", "a", "names", "missing", "expected"),
    [
        pytest.param("15", "16", "16", set(), set(), 2, id="2 before 5"),
        pytest.param("Marie", "Marle", "Marie", {"Marie", "Marle"}, set(), 5, id="5 before 3"),
        pytest.param("fait", "fait", "fais", {"fait"}, set(), 3, id="3 before 4"),
        pytest.param("fait", "fée", "fais", set(), set(), 4, id="4 before 6"),
        pytest.param("chat", "chit", "chut", set(), {0}, 6, id="6 before 7"),
        pytest.param("chat", None, "chut", set(), {0}, 7, id="7 before 8"),
    ],
)
def test_a_word_that_meets_two_conditions_gets_the_rule_that_comes_first(
    b1: str, b2: str | None, a: str, names: set[str], missing: set[int], expected: int
) -> None:
    witness = Witness(f"le {b1}", [("le", SURE), (a, SURE)], b2=["le", b2], missing=missing)
    decided = decide(witness, level="journal", phonemes=FakePhonemes(HOMOPHONES), entities=FakeEntities(names))
    assert decided[1][1] == expected


def test_a_second_reading_the_entities_refuse_is_told_apart_from_the_others() -> None:
    class Refusing(FakeEntities):
        def flags(self, text: str) -> list[bool]:
            if text == "Marle dort":
                raise too_complex()
            return super().flags(text)

    witness = Witness("Marie dort", [("Marie", SURE), ("dort", SURE)], b2=["Marle", "dort"])
    with pytest.raises(SecondRefusedError):
        decide(witness, entities=Refusing())


def test_a_first_reading_the_entities_refuse_is_refused_as_before() -> None:
    class Refusing(FakeEntities):
        def flags(self, text: str) -> list[bool]:
            raise too_complex()

    witness = Witness("le chat", [("le", SURE), ("chat", SURE)], b2=["le", "chat"])
    with pytest.raises(RefusalError):
        decide(witness, entities=Refusing())


def test_entities_of_b2_that_do_not_cover_its_words_are_refused() -> None:
    class Short(FakeEntities):
        def flags(self, text: str) -> list[bool]:
            flags = super().flags(text)
            return flags[:-1] if text == "le chut" else flags

    witness = Witness("le chat", [("le", SURE), ("chat", SURE)], b2=["le", "chut"])
    with pytest.raises(ValueError, match="entities"):
        decide(witness, entities=Short())


def test_an_english_page_never_asks_the_entities_of_b2() -> None:
    witness = Witness("Paris by sea", [("Paris", SURE), ("by", SURE), ("sea", SURE)], b2=["Paris", "by", "see"])
    entities = FakeEntities({"Paris"})
    assert decide(witness, language="en", entities=entities)[2] == ("sea", 5, "layer")
    assert entities.texts == []


def test_a_page_without_a_second_reading_never_asks_for_one() -> None:
    witness = Witness("Marie dort", [("Marie", SURE), ("dort", SURE)])
    entities = FakeEntities({"Marie"})
    decide(witness, entities=entities)
    assert entities.texts == ["Marie dort", "Marie dort"]
