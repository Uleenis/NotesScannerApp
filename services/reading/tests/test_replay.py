import io
import json
from collections.abc import Sequence

import pytest

from reading.arbitration import a_text, positions_of
from reading.recognition import ReadLine, Word
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


def test_input_that_is_not_json_is_refused() -> None:
    out, err = io.StringIO(), io.StringIO()
    assert main(io.StringIO("{"), out, err, Recorder()) == 2
    assert err.getvalue().strip() == "invalid replay input"


def test_replay_returns_the_positions_of_each_page() -> None:
    [replayed] = replay({"pages": [page()]}, Recorder())
    assert replayed.page == "Jour 15"
    assert len(replayed.positions) == len(line_tokens(B1))
