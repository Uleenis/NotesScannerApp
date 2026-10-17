import logging
from concurrent.futures import ThreadPoolExecutor

import pytest

from reading.phonemes import Espeak

ESPEAK = Espeak()
PROBE = "Zanzibarque"


def test_french_homophones_share_their_phonemes() -> None:
    fais, fait, peu, peut, pu, du = ESPEAK.phonemes(["fais", "fait", "peu", "peut", "pu", "du"], "fr")
    assert fais
    assert fais == fait
    assert peu
    assert peu == peut
    assert pu != du


def test_a_word_espeak_reads_as_english_on_a_french_page_has_no_phonemes() -> None:
    line, lire = ESPEAK.phonemes(["line", "lire"], "fr")
    assert line == ""
    assert lire


def test_english_homophones_are_read_in_english() -> None:
    sea, see, seat = ESPEAK.phonemes(["sea", "see", "seat"], "en")
    assert sea
    assert sea == see
    assert sea != seat


def test_every_word_keeps_its_place() -> None:
    words = ["chat", "line", "chien", "curls", "chat"]
    codes = ESPEAK.phonemes(words, "fr")
    assert len(codes) == len(words)
    assert codes[0] == codes[4]
    assert codes[0] != codes[2]
    assert codes[1] == ""


def test_another_language_is_refused() -> None:
    with pytest.raises(ValueError, match="language"):
        ESPEAK.phonemes(["hola"], "es")


def test_concurrent_pages_get_the_phonemes_of_their_own_words() -> None:
    expected = {word: ESPEAK.phonemes([word], "fr")[0] for word in ("fais", "chat", "maison", "jardin")}
    asked = list(expected) * 5
    with ThreadPoolExecutor(max_workers=4) as pool:
        found = list(pool.map(lambda word: ESPEAK.phonemes([word] * 20, "fr"), asked))
    assert found == [[expected[word]] * 20 for word in asked]


def test_phonemes_log_and_print_nothing(caplog: pytest.LogCaptureFixture, capfd: pytest.CaptureFixture[str]) -> None:
    with caplog.at_level(logging.DEBUG):
        ESPEAK.phonemes([PROBE, "line", "curls"], "fr")
        ESPEAK.phonemes([PROBE], "en")
    out, err = capfd.readouterr()
    logged = "\n".join(record.getMessage() for record in caplog.records)
    for text in (logged, out, err):
        assert PROBE not in text
        assert "line" not in text
        assert "curls" not in text
