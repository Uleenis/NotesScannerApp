import logging
import threading
from collections.abc import Sequence

VOICES = {"fr": "fr-fr", "en": "en-us"}


class Espeak:
    def __init__(self) -> None:
        import espeakng_loader
        from phonemizer.backend.espeak.wrapper import EspeakWrapper

        EspeakWrapper.set_library(espeakng_loader.get_library_path())
        EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
        from phonemizer.backend import EspeakBackend

        quiet = logging.getLogger("reading.phonemizer")
        quiet.propagate = False
        quiet.disabled = True
        self._backends = {
            language: EspeakBackend(
                voice,
                with_stress=False,
                language_switch="remove-utterance",
                words_mismatch="ignore",
                logger=quiet,
            )
            for language, voice in VOICES.items()
        }
        self._lock = threading.Lock()

    def phonemes(self, words: Sequence[str], language: str) -> list[str]:
        if language not in self._backends:
            raise ValueError("no phonemes for this language")
        with self._lock:
            codes: list[str] = self._backends[language].phonemize(list(words), strip=True, njobs=1)
        if len(codes) != len(words):
            raise ValueError("phonemes do not cover the words asked")
        return [code.strip() for code in codes]
