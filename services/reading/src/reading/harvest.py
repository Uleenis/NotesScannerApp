import math
import re
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from PIL import Image

from reading.alignment import align_blocks, cells, letter_pairs
from reading.arbitration import MAX_CELLS, MAX_LETTER_PAIRS
from reading.recognition import TileWord
from reading.tokens import JOINERS, Token, form_of, tokens_of
from reading.writing_test import distance

MIN_WIDTH = 8
CORRECTION_LANGUAGES = frozenset({"fr", "en"})
SPACES = re.compile(r"\s+")

Homophones = Callable[[str, str, str], bool]


@dataclass(frozen=True)
class TileLine:
    image: Image.Image
    words: tuple[TileWord, ...]


@dataclass(frozen=True)
class Correction:
    token_index: int
    text: str
    reading_a: str | None


@dataclass(frozen=True)
class Sample:
    image: Image.Image
    text: str


@dataclass(frozen=True)
class _AToken:
    line: int
    word: int
    token: Token


def strict(token: Token) -> str:
    return JOINERS.sub("", token.form)


def loose(token: Token) -> str:
    return strict(token).lower()


def squeeze(text: str) -> str:
    return unicodedata.normalize("NFC", SPACES.sub(" ", text)).strip()


def b1_lines(text: str) -> list[list[Token]]:
    return [tokens for tokens in (tokens_of(line) for line in text.splitlines()) if tokens]


def a_stream(lines: Sequence[TileLine]) -> tuple[list[_AToken], dict[int, int]]:
    stream: list[_AToken] = []
    holes: dict[int, int] = {}
    for line_index, line in enumerate(lines):
        start = len(stream)
        for word_index, word in enumerate(line.words):
            stream.extend(_AToken(line_index, word_index, token) for token in tokens_of(word.text))
        if len(stream) == start:
            holes[start] = holes.get(start, 0) + 1
    return stream, holes


def paired(
    b1: Sequence[Token], stream: Sequence[_AToken], holes: Mapping[int, int], lengths: Sequence[int]
) -> dict[int, int]:
    budgets = {column: sum(lengths[:count]) for column, count in holes.items()}
    ref = [loose(token) for token in b1]
    hyp = [loose(a.token) for a in stream]
    if cells(len(ref), len(hyp), budgets) > MAX_CELLS or letter_pairs(ref, hyp) > MAX_LETTER_PAIRS:
        return {}
    return {
        step.hyp: step.ref for step in align_blocks(ref, hyp, budgets) if step.ref is not None and step.hyp is not None
    }


def fed_correction(correction: Correction, language: str | None, homophones: Homophones) -> bool:
    if language not in CORRECTION_LANGUAGES:
        return False
    if correction.reading_a is None:
        return True
    a, corrected = form_of(correction.reading_a), form_of(correction.text)
    return not (distance(a, corrected) == 1 and homophones(a, corrected, language))


def longest_run(flags: Sequence[bool], joined: Sequence[bool]) -> tuple[int, int] | None:
    best = (0, 0)
    start: int | None = None
    for index in range(len(flags) + 1):
        ok = index < len(flags) and flags[index]
        if ok and start is not None and not joined[index]:
            if index - start > best[1] - best[0]:
                best = (start, index)
            start = index
        elif ok and start is None:
            start = index
        elif not ok and start is not None:
            if index - start > best[1] - best[0]:
                best = (start, index)
            start = None
    return best if best[1] > best[0] else None


def crop(image: Image.Image, left: int, right: int) -> Image.Image | None:
    a = max(0, left)
    b = min(image.width, right)
    if b - a < MIN_WIDTH:
        return None
    if a == 0 and b == image.width:
        return image.copy()
    return image.crop((a, 0, b, image.height))


def harvest(
    b1_text: str,
    lines: Sequence[TileLine],
    corrections: Mapping[int, Correction],
    language: str | None,
    homophones: Homophones,
) -> list[Sample]:
    b1 = [token for tokens in b1_lines(b1_text) for token in tokens]
    lengths = sorted((len(tokens) for tokens in b1_lines(b1_text)), reverse=True)
    stream, holes = a_stream(lines)
    b1_of = paired(b1, stream, holes, lengths)

    agrees: list[bool] = []
    labels: list[str | None] = []
    for a_index, a in enumerate(stream):
        j = b1_of.get(a_index)
        correction = corrections.get(j) if j is not None else None
        if j is None:
            agrees.append(False)
            labels.append(None)
        elif correction is not None:
            fed = fed_correction(correction, language, homophones)
            agrees.append(fed)
            labels.append(correction.text if fed else None)
        else:
            agrees.append(strict(b1[j]) == strict(a.token))
            labels.append(None)

    samples: list[Sample] = []
    start = 0
    for line_index, line in enumerate(lines):
        flags: list[bool] = []
        joined: list[bool] = []
        texts: list[str] = []
        previous_last: int | None = None
        for word_index, word in enumerate(line.words):
            indices = []
            while start < len(stream) and stream[start].line == line_index and stream[start].word == word_index:
                indices.append(start)
                start += 1
            refs = [ref for index in indices if (ref := b1_of.get(index)) is not None]
            ok = bool(indices) and len(refs) == len(indices) and all(agrees[index] for index in indices)
            corrected = [label for index in indices if (label := labels[index]) is not None]
            if corrected and len(indices) != 1:
                ok = False
            if ok and any(refs[k + 1] != refs[k] + 1 for k in range(len(refs) - 1)):
                ok = False
            joined.append(ok and previous_last is not None and refs[0] == previous_last + 1)
            previous_last = refs[-1] if ok else None
            flags.append(ok)
            if corrected and ok:
                composed = unicodedata.normalize("NFC", word.text)
                token_text = stream[indices[0]].token.text
                texts.append(composed.replace(token_text, corrected[0], 1))
            else:
                texts.append(word.text)
        run = longest_run(flags, joined)
        if run is None:
            continue
        i, j = run
        text = squeeze(" ".join(texts[i:j]))
        if not text:
            continue
        words = line.words
        left = 0 if i == 0 else max(math.floor((words[i - 1].x1 + words[i].x0) / 2), 0)
        right = (
            line.image.width
            if j == len(words)
            else min(math.floor((words[j - 1].x1 + words[j].x0) / 2), line.image.width)
        )
        image = crop(line.image, left, right)
        if image is not None:
            samples.append(Sample(image, text))
    return samples
