import io
import json
from collections.abc import Sequence

import pytest

from reading import replay as replay_module
from reading.arbitration import a_text, positions_of
from reading.recognition import ReadLine, Word
from reading.refusal import too_complex
from reading.replay import main, replay
from reading.rules import Rules
from reading.tokens import line_tokens

PROBE = "Zanzibarque"
B1 = f"Jour 15\nje fait du vélo avec Marie\n{PROBE} le soir"
READ: list[list[tuple[str, float]]] = [
    [("Jour", 0.99), ("16", 0.8)],
    [("je", 0.999), ("fais", 0.995), ("du", 0.99), ("velo", 0.7), ("avec", 0.99), ("Marie", 0.99)],
    [],
]
LINES = [[{"text": text, "confidence": confidence} for text, confidence in line] for line in READ]


def page(level: str = "journal", language: str | None = "fr", **changes: object) -> dict[str, object]:
    b1_flags = [token.text == "Marie" for token, _ in line_tokens(B1)]
    a_words = [text for line in READ for text, _ in line]
    entry: dict[str, object] = {
        "page": "Jour 15",
        "b1": B1,
        "lines": LINES,
        "language": language,
        "level": level,
        "entities": {"b1": b1_flags, "a": [word == "Marie" for word in a_words]},
    }
    entry.update(changes)
    return entry


class Table:
    def __init__(self, entries: dict[str, list[bool]]) -> None:
        self.entries = entries

    def flags(self, text: str) -> list[bool]:
        return self.entries[text]


class Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[list[str], str]] = []

    def phonemes(self, words: Sequence[str], language: str) -> list[str]:
        self.calls.append((list(words), language))
        return ["fɛ" if word in ("fais", "fait") else word for word in words]


def run(document: object) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = main(io.StringIO(json.dumps(document, ensure_ascii=False)), out, err, Recorder())
    return code, out.getvalue(), err.getvalue()


def test_the_command_replays_a_page_as_the_rules_decide_it_directly() -> None:
    entry = page()
    code, out, _ = run({"pages": [entry]})
    assert code == 0
    [replayed] = json.loads(out)["pages"]

    lines = tuple(
        ReadLine(
            row=i,
            box=(0, 0, 1, 1),
            ink=(0, 0, 1, 1),
            words=tuple(Word(text, (0, 0, 1, 1), confidence) for text, confidence in line),
        )
        for i, line in enumerate(READ)
    )
    entities = entry["entities"]
    assert isinstance(entities, dict)
    a = a_text(lines)
    direct = Rules(Recorder(), Table({B1: entities["b1"], a: entities["a"]})).decide(
        positions_of(B1, lines), B1, a, "fr", "journal"
    )
    assert replayed["page"] == "Jour 15"
    assert replayed["positions"] == [
        {
            "token_index": p.token_index,
            "line_index": p.line_index,
            "text": p.text,
            "rule": p.rule,
            "channel": p.channel,
            "reading_a": p.reading_a,
            "reading_b1": p.reading_b1,
            "reading_b2": p.reading_b2,
        }
        for p in direct
    ]
    assert [(p["text"], p["rule"], p["channel"]) for p in replayed["positions"]] == [
        ("Jour", 9, "none"),
        ("15", 2, "queue"),
        ("je", 9, "none"),
        ("fais", 4, "layer"),
        ("du", 9, "none"),
        ("vélo", 8, "layer"),
        ("avec", 9, "none"),
        ("Marie", 3, "layer"),
        (PROBE, 10, "none"),
        ("le", 10, "none"),
        ("soir", 10, "none"),
    ]


def test_the_correction_level_and_the_language_come_from_the_input() -> None:
    code, out, _ = run({"pages": [page(level="course"), page(language="es")]})
    assert code == 0
    course, spanish = json.loads(out)["pages"]
    assert [(p["text"], p["rule"]) for p in course["positions"]][3] == ("fait", 4)
    assert [(p["text"], p["rule"]) for p in spanish["positions"]][3] == ("fait", 8)
    assert [(p["text"], p["rule"]) for p in spanish["positions"]][7] == ("Marie", 9)


def test_pages_come_out_in_the_order_they_came_in() -> None:
    code, out, _ = run({"pages": [page(page="b"), page(page="a")]})
    assert code == 0
    assert [p["page"] for p in json.loads(out)["pages"]] == ["b", "a"]


def test_the_gate_is_forced_open() -> None:
    _, out, _ = run({"pages": [page()]})
    assert all(p["rule"] is not None for p in json.loads(out)["pages"][0]["positions"])


@pytest.mark.parametrize(
    "document",
    [
        pytest.param({"pages": [page(level="loud")]}, id="unknown level"),
        pytest.param({"pages": [page(entities={"b1": [False]})]}, id="entities missing for a"),
        pytest.param({"pages": [page(entities={"b1": [False], "a": [False] * 8})]}, id="entities do not cover b1"),
        pytest.param({"pages": [page(extra=1)]}, id="unknown field"),
        pytest.param({"pages": [page(lines=[[{"text": "a b", "confidence": 0.5}]])]}, id="word with a space"),
        pytest.param({"pages": [page(lines=[[{"text": "a", "confidence": 1.5}]])]}, id="confidence above one"),
        pytest.param({"page": []}, id="no pages"),
        pytest.param([], id="not an object"),
    ],
)
def test_a_bad_input_is_refused_without_its_text(document: object) -> None:
    code, out, err = run(document)
    assert code == 2
    assert out == ""
    assert err.strip() == "invalid replay input"
    assert PROBE not in err


def test_one_text_read_alike_with_two_sets_of_entities_is_refused() -> None:
    lines = [[{"text": "un", "confidence": 0.99}, {"text": "Marie", "confidence": 0.99}]]
    entry = page(b1="un Marie", lines=lines, entities={"b1": [False, False], "a": [False, True]})
    code, _, err = run({"pages": [entry]})
    assert code == 2
    assert err.strip() == "invalid replay input"


@pytest.mark.parametrize(
    ("b1_flag", "a_flag"),
    [pytest.param(True, False, id="flag of b1 alone"), pytest.param(False, True, id="flag of a alone")],
)
def test_each_reading_brings_its_own_entities(b1_flag: bool, a_flag: bool) -> None:
    lines = [[{"text": "le", "confidence": 0.99}, {"text": "Rhone", "confidence": 0.99}]]
    entry = page(b1="le Rhône", lines=lines, entities={"b1": [False, b1_flag], "a": [False, a_flag]})
    code, out, _ = run({"pages": [entry]})
    assert code == 0
    assert [(p["text"], p["rule"]) for p in json.loads(out)["pages"][0]["positions"]] == [("le", 9), ("Rhône", 3)]


def test_entities_of_a_that_do_not_cover_its_words_are_refused() -> None:
    entry = page()
    entities = entry["entities"]
    assert isinstance(entities, dict)
    code, _, err = run({"pages": [page(entities={"b1": entities["b1"], "a": [*entities["a"], False]})]})
    assert code == 2
    assert err.strip() == "invalid replay input"


def test_a_page_too_complex_is_refused_as_such(monkeypatch: pytest.MonkeyPatch) -> None:
    def too_big(*_: object) -> list[object]:
        raise too_complex()

    monkeypatch.setattr(replay_module, "positions_of", too_big)
    code, out, err = run({"pages": [page()]})
    assert (code, out) == (2, "")
    assert err.strip() == "page too complex to replay"


def test_a_fault_of_the_rules_is_not_taken_for_a_bad_input() -> None:
    class Broken(Recorder):
        def phonemes(self, words: Sequence[str], language: str) -> list[str]:
            return []

    with pytest.raises(ValueError, match="phonemes"):
        main(io.StringIO(json.dumps({"pages": [page()]})), io.StringIO(), io.StringIO(), Broken())


def test_input_that_is_not_json_is_refused() -> None:
    out, err = io.StringIO(), io.StringIO()
    assert main(io.StringIO("{"), out, err, Recorder()) == 2
    assert err.getvalue().strip() == "invalid replay input"


def test_replay_returns_the_positions_of_each_page() -> None:
    [replayed] = replay({"pages": [page()]}, Recorder())
    assert replayed.page == "Jour 15"
    assert len(replayed.positions) == len(line_tokens(B1))


B2_TEXT = "Jour 15\nje fais du velo avec Marle"


def second_page(**changes: object) -> dict[str, object]:
    b2_flags = [token.text == "Marle" for token, _ in line_tokens(B2_TEXT)]
    entry = page(b2=B2_TEXT)
    entities = entry["entities"]
    assert isinstance(entities, dict)
    entry["entities"] = {**entities, "b2": b2_flags}
    entry.update(changes)
    return entry


def test_a_page_with_a_second_reading_is_replayed_with_rules_five_six_and_seven() -> None:
    code, out, _ = run({"pages": [second_page()]})
    assert code == 0
    [replayed] = json.loads(out)["pages"]
    rows = [(p["text"], p["reading_b2"], p["rule"], p["channel"]) for p in replayed["positions"]]
    assert rows == [
        ("Jour", "Jour", 9, "none"),
        ("15", "15", 2, "queue"),
        ("je", "je", 9, "none"),
        ("fais", "fais", 5, "layer"),
        ("du", "du", 9, "none"),
        ("velo", "velo", 5, "layer"),
        ("avec", "avec", 9, "none"),
        ("Marie", "Marle", 5, "layer"),
        (PROBE, None, 7, "none"),
        ("le", None, 7, "none"),
        ("soir", None, 7, "none"),
    ]


def test_a_page_without_a_second_reading_has_no_word_of_b2() -> None:
    _, out, _ = run({"pages": [page()]})
    assert {p["reading_b2"] for p in json.loads(out)["pages"][0]["positions"]} == {None}


@pytest.mark.parametrize(
    "document",
    [
        pytest.param({"pages": [second_page(entities={"b1": [False], "a": [False], "b2": [False]})]}, id="b1 and a"),
        pytest.param({"pages": [page(b2=B2_TEXT)]}, id="entities of b2 missing"),
        pytest.param({"pages": [second_page(b2=None)]}, id="entities of b2 without b2"),
    ],
)
def test_a_second_reading_and_its_entities_come_together(document: object) -> None:
    code, out, err = run(document)
    assert code == 2
    assert out == ""
    assert err.strip() == "invalid replay input"


def test_entities_of_b2_that_do_not_cover_its_words_are_refused() -> None:
    entry = second_page()
    entities = entry["entities"]
    assert isinstance(entities, dict)
    code, _, err = run({"pages": [second_page(entities={**entities, "b2": [*entities["b2"], False]})]})
    assert code == 2
    assert err.strip() == "invalid replay input"
