from collections.abc import Sequence

import pytest

from reading.arbitration import Position
from reading.rules import CONFIDENCE, Rules
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
    def __init__(self, b1: str, a: Sequence[tuple[str, float] | None]) -> None:
        self.b1 = b1
        b1_tokens = line_tokens(b1)
        assert len(b1_tokens) == len(a)
        read = [reading for reading in a if reading is not None]
        self.a = " ".join(text for text, _ in read)
        self.positions: list[Position] = []
        a_index = 0
        for index, ((token, line), reading) in enumerate(zip(b1_tokens, a, strict=True)):
            if reading is None:
                self.positions.append(
                    Position(index, line, token.text, None, None, None, token.text, None, None, None, None)
                )
                continue
            text, confidence = reading
            self.positions.append(
                Position(index, line, token.text, None, None, text, token.text, "word", BOX, a_index, confidence)
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
    decided = rules.decide(witness.positions, witness.b1, witness.a, language, level)
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
