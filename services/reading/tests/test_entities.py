import logging
import os
import subprocess
import sys
from collections.abc import Sequence
from decimal import Decimal
from pathlib import Path

import pytest

from reading.__main__ import arbiter_of
from reading.arbiter import Arbitration
from reading.arbitration import Model, Position
from reading.entities import MAX_PIECES, Camembert
from reading.recognition import Reading, ReadLine, Word
from reading.refusal import RefusalError
from reading.rules import Rules
from reading.store import ReadingA
from reading.tokens import line_tokens

FOLDER = os.environ["READING_NER"]
NER = Camembert(Path(FOLDER))
CURLY = chr(0x2019)
ACUTE = chr(0x301)


def labelled(text: str) -> dict[str, str]:
    return {token.text: label for (token, _), label in zip(line_tokens(text), NER.labels(text), strict=True)}


def test_a_game_is_typed_misc() -> None:
    assert labelled("Ce soir j'ai joué à Roblox avec mon frère.")["Roblox"] == "MISC"


def test_a_misread_name_is_still_typed() -> None:
    labels = labelled("Albert Einsein a reçu le prix Nobel de physique en 1921.")
    assert labels["Albert"] == "PER"
    assert labels["Einsein"] == "PER"


def test_common_words_are_not_typed() -> None:
    assert NER.flags("je mange une pomme dans la cuisine") == [False] * 7


def test_each_word_gets_its_own_flag_after_decomposed_accents_and_line_breaks() -> None:
    decomposed = f"le cafe{ACUTE} de Marie\r\npuis la gare de Lyon\ne{ACUTE}te{ACUTE} a{ACUTE} Paris"
    composed = "le café de Marie\npuis la gare de Lyon\nété á Paris"
    labels = NER.labels(decomposed)
    assert labels == NER.labels(composed)
    words = [token.text for token, _ in line_tokens(decomposed)]
    named = dict(zip(words, labels, strict=True))
    assert {word for word, label in named.items() if label != "O"} >= {"Marie", "Lyon", "Paris"}
    assert [named[word] for word in ("le", "puis", "la", "été")] == ["O"] * 4


def test_special_tokens_written_on_the_page_are_read_as_text() -> None:
    plain = NER.labels("Marie part à Lyon")
    assert NER.labels("<mask> " * 600 + "Marie part à Lyon")[-4:] == plain
    assert NER.labels("Marie" + " <pad>" * 600 + " part à Lyon")[0] == plain[0]


@pytest.mark.parametrize(
    ("opening", "closing"),
    [pytest.param(chr(0xFF1C), chr(0xFF1E), id="fullwidth"), pytest.param(chr(0xFE64), chr(0xFE65), id="small form")],
)
def test_look_alike_brackets_cannot_write_special_tokens(opening: str, closing: str) -> None:
    plain = NER.labels("Marie part à Lyon")
    assert NER.labels(f"{opening}mask{closing} " * 600 + "Marie part à Lyon")[-4:] == plain
    assert NER.labels("Marie" + f" {opening}pad{closing}" * 600 + " part à Lyon")[0] == plain[0]


def test_a_text_too_long_for_the_entities_is_refused_as_too_complex() -> None:
    with pytest.raises(RefusalError) as refused:
        NER.flags("a " * (MAX_PIECES + 1))
    assert refused.value.code == "too_complex"


def test_each_word_of_every_line_gets_one_flag() -> None:
    text = f"Marie est partie à Lyon.\n\nl{CURLY}école [?] est-elle fermée ?\nVinted"
    flags = NER.flags(text)
    assert len(flags) == len(line_tokens(text))
    assert dict(zip([token.text for token, _ in line_tokens(text)], flags, strict=True))["Lyon"] is True


def test_a_text_without_words_has_no_flags() -> None:
    assert NER.flags("") == []
    assert NER.flags("... !! --") == []


def test_a_long_page_is_read_in_windows_and_keeps_one_flag_per_word() -> None:
    text = "\n".join(f"Le jour {n} Paul est allé à Marseille avec Julie." for n in range(200))
    flags = NER.flags(text)
    assert len(flags) == len(line_tokens(text))
    words = [token.text for token, _ in line_tokens(text)]
    assert all(flag for word, flag in zip(words, flags, strict=True) if word == "Marseille")


def test_the_entities_log_nothing(caplog: pytest.LogCaptureFixture, capfd: pytest.CaptureFixture[str]) -> None:
    with caplog.at_level(logging.DEBUG):
        NER.flags("Zanzibarque est allé à Roblox")
    out, err = capfd.readouterr()
    for text in ("\n".join(r.getMessage() for r in caplog.records), out, err):
        assert "Zanzibarque" not in text


class Silent:
    def phonemes(self, words: Sequence[str], language: str) -> list[str]:
        return [""] * len(words)


class Counted:
    def __init__(self) -> None:
        self.texts: list[str] = []

    def flags(self, text: str) -> list[bool]:
        self.texts.append(text)
        return NER.flags(text)


def positions(text: str) -> list[Position]:
    return [
        Position(i, line, token.text, None, None, token.text, token.text, "word", (0, 0, 1, 1), i, 0.99)
        for i, (token, line) in enumerate(line_tokens(text))
    ]


def test_an_english_page_never_goes_through_the_entities() -> None:
    text = "Yesterday Marie played Roblox with her brother in London"
    counted = Counted()
    decided = Rules(Silent(), counted).decide(positions(text), text, text, "en", "course")
    assert counted.texts == []
    assert all(p.rule == 9 for p in decided)


def test_a_french_page_types_its_proper_nouns_through_the_entities() -> None:
    text = "Hier Marie a joué à Roblox avec son frère à Lyon"
    counted = Counted()
    decided = Rules(Silent(), counted).decide(positions(text), text, text, "fr", "course")
    assert counted.texts == [text, text]
    assert {p.text for p in decided if p.rule == 3} >= {"Marie", "Roblox", "Lyon"}


def test_the_entities_refuse_to_load_with_the_telemetry_of_onnxruntime_on() -> None:
    script = "\n".join(
        [
            "import os",
            "from pathlib import Path",
            "from reading.entities import Camembert",
            "Camembert(Path(os.environ['READING_NER']))",
        ]
    )
    environ = {key: value for key, value in os.environ.items() if key != "ORT_DISABLE_TELEMETRY"}
    result = subprocess.run([sys.executable, "-c", script], env=environ, capture_output=True, text=True, timeout=60)
    assert result.returncode != 0
    assert "ORT_DISABLE_TELEMETRY" in result.stderr


WATCH = """
import os
import time
from pathlib import Path
from reading.entities import Camembert
LOOPBACK = {'0100007F', '00000000000000000000000001000000', '0000000000000000FFFF00000100007F'}
ner = Camembert(Path(os.environ['READING_NER']))
seen = set()
for _ in range(50):
    ner.flags('Marie part à Lyon')
    for name in ('tcp', 'tcp6', 'udp', 'udp6'):
        for row in open('/proc/net/' + name).read().splitlines()[1:]:
            remote = row.split()[2].split(':')[0]
            if remote.strip('0') and remote not in LOOPBACK:
                seen.add(name + ' ' + remote)
    time.sleep(0.5)
print(len(seen))
"""


def test_reading_entities_keeps_no_connection_open_but_to_the_machine_itself() -> None:
    environ = {key: value for key, value in os.environ.items() if key not in ("XDG_CACHE_HOME", "HOME")}
    result = subprocess.run([sys.executable, "-c", WATCH], env=environ, capture_output=True, text=True, timeout=180)
    assert result.returncode == 0
    assert result.stdout.strip() == "0"


class GateOpen:
    def __init__(self) -> None:
        self.writes: list[ReadingA] = []

    def models(self, user_id: str) -> list[Model]:
        return [Model("1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", "active", Decimal("0.05"), 1)]

    def correction_level(self, page_id: str, user_id: str) -> str:
        return "journal"

    def upload_alto(self, path: str, alto: bytes) -> None:
        return None

    def record(self, write: ReadingA) -> str:
        self.writes.append(write)
        return "recorded"

    def remove_alto(self, path: str) -> None:
        return None


def test_the_service_decides_with_its_rules_when_the_gate_opens() -> None:
    store = GateOpen()
    box = (0, 0, 1, 1)
    b1 = "Aujourd'hui Marie est allée au marché avec sa soeur"
    words = tuple(Word(text, box, 0.99) for text in b1.split())
    reading = Reading(640, 480, (ReadLine(0, box, box, words),), 0.0, 0.0)
    page = "0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f"
    user = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
    arbiter_of(store, Path(FOLDER), None).arbitrate(
        Arbitration(page, user, b1, reading, 1, model_id="1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f")
    )
    assert store.writes[0].language == "fr"
    assert [(p.text, p.rule) for p in store.writes[0].tokens] == [
        ("Aujourd'hui", 9),
        ("Marie", 3),
        ("est", 9),
        ("allée", 9),
        ("au", 9),
        ("marché", 9),
        ("avec", 9),
        ("sa", 9),
        ("soeur", 9),
    ]
