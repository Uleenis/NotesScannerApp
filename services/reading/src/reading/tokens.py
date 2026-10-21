import re
import unicodedata
from dataclasses import dataclass

APOSTROPHES = dict.fromkeys(map(ord, "\u2019\u2018\u00b4\u02bc"), "'")
DASHES = dict.fromkeys(map(ord, "\u2010\u2011\u2012\u2013\u2014\u2015"), "-")
WORD = re.compile(r"\[\?\]|[0-9A-Za-z\u00c0-\u024f'\-]+")
JOINERS = re.compile(r"['\-]")


@dataclass(frozen=True)
class Token:
    text: str
    form: str


def form_of(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(APOSTROPHES).translate(DASHES)


def tokens_of(text: str) -> list[Token]:
    composed = unicodedata.normalize("NFC", text)
    unified = form_of(composed)
    tokens = []
    for found in WORD.finditer(unified):
        form = found.group(0)
        if form != "[?]" and not JOINERS.sub("", form):
            continue
        tokens.append(Token(composed[found.start() : found.end()], form))
    return tokens


def line_tokens(text: str) -> list[tuple[Token, int]]:
    return [(token, index) for index, line in enumerate(text.splitlines()) for token in tokens_of(line)]


def token_spans(text: str) -> list[tuple[int, int]]:
    return [
        (found.start(), found.end())
        for found in WORD.finditer(form_of(text))
        if found.group(0) == "[?]" or JOINERS.sub("", found.group(0))
    ]


def composed_cuts(text: str) -> dict[int, int] | None:
    cuts = {0: 0}
    pieces = []
    length = 0
    start = 0
    for index in range(1, len(text) + 1):
        if index == len(text) or unicodedata.combining(text[index]) == 0:
            piece = unicodedata.normalize("NFC", text[start:index])
            pieces.append(piece)
            length += len(piece)
            cuts[length] = index
            start = index
    if "".join(pieces) != unicodedata.normalize("NFC", text):
        return None
    return cuts


def raw_spans(text: str) -> list[tuple[int, int]] | None:
    spans = token_spans(text)
    if unicodedata.normalize("NFC", text) == text:
        return spans
    cuts = composed_cuts(text)
    if cuts is None:
        return None
    places = []
    for start, end in spans:
        if start not in cuts or end not in cuts:
            return None
        places.append((cuts[start], cuts[end]))
    return places
