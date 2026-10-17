import logging
import os
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

import pytest

from reading.arbitration import Position
from reading.entities import Camembert
from reading.rules import Rules
from reading.tokens import line_tokens

NER = Camembert(Path(os.environ["READING_NER"]))
CURLY = chr(0x2019)


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
    script = "from pathlib import Path\nfrom reading.entities import Camembert\nCamembert(Path('/models/ner'))\n"
    environ = {key: value for key, value in os.environ.items() if key != "ORT_DISABLE_TELEMETRY"}
    result = subprocess.run([sys.executable, "-c", script], env=environ, capture_output=True, text=True, timeout=60)
    assert result.returncode != 0
    assert "ORT_DISABLE_TELEMETRY" in result.stderr


WATCH = """
import time
from pathlib import Path
from reading.entities import Camembert
ner = Camembert(Path('/models/ner'))
seen = set()
for _ in range(30):
    ner.flags('Marie part à Lyon')
    for name in ('/proc/net/tcp', '/proc/net/tcp6'):
        for row in open(name).read().splitlines()[1:]:
            remote = row.split()[2]
            if remote.endswith((':01BB', ':0050')):
                seen.add(remote)
    time.sleep(0.5)
print(len(seen))
"""


def test_reading_entities_opens_no_connection() -> None:
    environ = {key: value for key, value in os.environ.items() if key not in ("XDG_CACHE_HOME", "HOME")}
    result = subprocess.run([sys.executable, "-c", WATCH], env=environ, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0
    assert result.stdout.strip() == "0"
