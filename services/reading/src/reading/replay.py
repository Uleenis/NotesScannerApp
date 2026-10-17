import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Literal, TextIO

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from reading.arbitration import Position, a_text, positions_of
from reading.recognition import Box, ReadLine, Word
from reading.rules import Phonemes, Rules

NO_BOX: Box = (0, 0, 1, 1)
REFUSED = "invalid replay input"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class WordIn(Strict):
    text: Annotated[str, Field(min_length=1, pattern=r"^\S+$")]
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]


class EntitiesIn(Strict):
    b1: list[bool]
    a: list[bool]


class PageIn(Strict):
    page: str
    b1: str
    lines: list[list[WordIn]]
    language: str | None
    level: Literal["course", "journal", "grammar"]
    entities: EntitiesIn


class ReplayIn(Strict):
    pages: list[PageIn]


@dataclass(frozen=True)
class Replayed:
    page: str
    positions: list[Position]


class PinnedEntities:
    def __init__(self, b1: str, b1_flags: Sequence[bool], a: str, a_flags: Sequence[bool]) -> None:
        self._b1, self._b1_flags = b1, list(b1_flags)
        self._a, self._a_flags = a, list(a_flags)

    def flags(self, text: str) -> list[bool]:
        if text == self._b1:
            return self._b1_flags
        if text == self._a:
            return self._a_flags
        raise ValueError("no entities for this text")


def lines_of(page: PageIn) -> tuple[ReadLine, ...]:
    return tuple(
        ReadLine(
            row=index,
            box=NO_BOX,
            ink=NO_BOX,
            words=tuple(Word(word.text, NO_BOX, word.confidence) for word in words),
        )
        for index, words in enumerate(page.lines)
    )


def replay(document: object, phonemes: Phonemes) -> list[Replayed]:
    pages = ReplayIn.model_validate(document).pages
    out = []
    for page in pages:
        lines = lines_of(page)
        a = a_text(lines)
        rules = Rules(phonemes, PinnedEntities(page.b1, page.entities.b1, a, page.entities.a))
        positions = rules.decide(positions_of(page.b1, lines), page.b1, a, page.language, page.level)
        out.append(Replayed(page.page, positions))
    return out


def position_row(position: Position) -> dict[str, object]:
    return {
        "token_index": position.token_index,
        "line_index": position.line_index,
        "text": position.text,
        "rule": position.rule,
        "channel": position.channel,
        "reading_a": position.reading_a,
        "reading_b1": position.reading_b1,
    }


def main(source: TextIO, target: TextIO, errors: TextIO, phonemes: Phonemes | None = None) -> int:
    try:
        document = json.loads(source.read())
        if phonemes is None:
            from reading.phonemes import Espeak

            phonemes = Espeak()
        replayed = replay(document, phonemes)
    except (ValueError, ValidationError):
        print(REFUSED, file=errors)
        return 2
    pages = [{"page": r.page, "positions": [position_row(p) for p in r.positions]} for r in replayed]
    json.dump({"pages": pages}, target, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.stdin, sys.stdout, sys.stderr))
