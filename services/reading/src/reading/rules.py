import re
import unicodedata
from collections.abc import Sequence
from dataclasses import replace
from typing import Protocol

from reading.alignment import char_lev
from reading.arbitration import Position
from reading.tokens import form_of

CONFIDENCE = 0.990
DIGIT = re.compile(r"\d")
ENTITY_LANGUAGES = {"fr"}
PHONEME_LANGUAGES = {"fr", "en"}
VERBATIM = "journal"
QUEUE = "queue"
LAYER = "layer"
NONE = "none"


class Phonemes(Protocol):
    def phonemes(self, words: Sequence[str], language: str) -> list[str]: ...


class Entities(Protocol):
    def flags(self, text: str) -> list[bool]: ...


def strip_accents(word: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", word) if not unicodedata.combining(c))


def accent_only(a: str, b: str) -> bool:
    return a != b and strip_accents(a) == strip_accents(b)


def truncation(a: str, b: str) -> bool:
    if a == b:
        return False
    short, long = (a, b) if len(a) < len(b) else (b, a)
    return long.startswith(short) or long.endswith(short)


def forms(position: Position) -> tuple[str | None, str]:
    a = None if position.reading_a is None else form_of(position.reading_a)
    return a, form_of(position.reading_b1)


def homophone_candidate(position: Position) -> bool:
    a, b1 = forms(position)
    if a is None or position.confidence is None or position.confidence < CONFIDENCE:
        return False
    return char_lev(a, b1) == 1 and not accent_only(a, b1) and not truncation(a, b1)


def decided(position: Position, rule: int, channel: str, text: str) -> Position:
    return replace(position, text=text, rule=rule, channel=channel)


class Rules:
    def __init__(self, phonemes: Phonemes, entities: Entities) -> None:
        self._phonemes = phonemes
        self._entities = entities

    def decide(
        self, positions: Sequence[Position], b1: str, a: str, language: str | None, level: str
    ) -> list[Position]:
        proper = self._proper(positions, b1, a) if language in ENTITY_LANGUAGES else [False] * len(positions)
        digits = [
            any(text is not None and DIGIT.search(text) for text in (p.reading_a, p.reading_b1)) for p in positions
        ]
        common = [not digit and not name for digit, name in zip(digits, proper, strict=True)]
        candidates = (
            [is_common and homophone_candidate(p) for p, is_common in zip(positions, common, strict=True)]
            if language in PHONEME_LANGUAGES
            else [False] * len(positions)
        )
        codes = self._codes([p for p, candidate in zip(positions, candidates, strict=True) if candidate], language)

        out = []
        for position, digit, name, candidate in zip(positions, digits, proper, candidates, strict=True):
            a_form, b1_form = forms(position)
            if digit and a_form is not None and a_form != b1_form:
                out.append(decided(position, 2, QUEUE, position.reading_b1))
            elif name:
                out.append(decided(position, 3, LAYER, position.reading_b1))
            elif candidate and a_form is not None and codes.get(a_form) and codes.get(a_form) == codes.get(b1_form):
                written = position.reading_a if level == VERBATIM and position.reading_a else position.reading_b1
                out.append(decided(position, 4, LAYER, written))
            elif a_form is not None and a_form != b1_form:
                out.append(decided(position, 8, LAYER, position.reading_b1))
            elif a_form is not None:
                out.append(decided(position, 9, NONE, position.reading_b1))
            else:
                out.append(decided(position, 10, NONE, position.reading_b1))
        return out

    def _proper(self, positions: Sequence[Position], b1: str, a: str) -> list[bool]:
        b1_flags = self._entities.flags(b1)
        if len(b1_flags) != len(positions):
            raise ValueError("entities of B1 do not cover its words")
        a_flags = self._entities.flags(a)
        indices = [p.a_index for p in positions if p.a_index is not None]
        if indices and max(indices) >= len(a_flags):
            raise ValueError("entities of A do not cover its words")
        return [b1_flags[p.token_index] or (p.a_index is not None and a_flags[p.a_index]) for p in positions]

    def _codes(self, candidates: Sequence[Position], language: str | None) -> dict[str, str]:
        if not candidates or language is None:
            return {}
        words = sorted({form for p in candidates for form in forms(p) if form is not None})
        codes = self._phonemes.phonemes(words, language)
        if len(codes) != len(words):
            raise ValueError("phonemes do not cover the words asked")
        return dict(zip(words, codes, strict=True))
