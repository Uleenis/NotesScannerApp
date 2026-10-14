from lingua import LanguageDetectorBuilder

from reading.tokens import tokens_of

MIN_WORDS = 5
MIN_DISTANCE = 0.25


class Lingua:
    def __init__(self) -> None:
        self._detector = (
            LanguageDetectorBuilder.from_all_languages().with_minimum_relative_distance(MIN_DISTANCE).build()
        )

    def language_of(self, text: str) -> str | None:
        words = [token for token in tokens_of(text) if any(character.isalpha() for character in token.text)]
        if len(words) < MIN_WORDS:
            return None
        found = self._detector.detect_language_of(text)
        if found is None:
            return None
        return found.iso_code_639_1.name.lower()
