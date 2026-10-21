import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Literal, TextIO

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from reading.arbitration import Position, a_text, positions_of
from reading.recognition import Box, ReadLine, Word
from reading.refusal import RefusalError
from reading.rules import Phonemes, Rules
from reading.second import second_of, with_second
from reading.tokens import line_tokens

NO_BOX: Box = (0, 0, 1, 1)
REFUSED = "invalid replay input"
TOO_COMPLEX = "page too complex to replay"


class ReplayError(ValueError):
    pass


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class WordIn(Strict):
    text: Annotated[str, Field(min_length=1, pattern=r"^\S+$")]
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]


class EntitiesIn(Strict):
    b1: list[bool]
    a: list[bool]
    b2: list[bool] | None = None


class PageIn(Strict):
    page: str
    b1: str
    lines: list[list[WordIn]]
    language: str | None
    level: Literal["course", "journal", "grammar"]
    entities: EntitiesIn
    b2: str | None = None


class ReplayIn(Strict):
    pages: list[PageIn]


@dataclass(frozen=True)
class Replayed:
    page: str
    positions: list[Position]


class PinnedEntities:
    def __init__(self, pinned: Sequence[tuple[str, Sequence[bool]]]) -> None:
        self._pinned = [(text, list(flags)) for text, flags in pinned]

    def flags(self, text: str) -> list[bool]:
        for pinned, flags in self._pinned:
            if text == pinned:
                return flags
        raise ReplayError("no entities for this text")


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
        texts = [(page.b1, page.entities.b1), (a, page.entities.a)]
        if page.b2 is not None and page.entities.b2 is not None:
            texts.append((page.b2, page.entities.b2))
        elif page.b2 is not None or page.entities.b2 is not None:
            raise ReplayError("a second reading and its entities come together")
        if any(len(flags) != len(line_tokens(text)) for text, flags in texts):
            raise ReplayError("entities do not cover the words")
        if any(
            first[0] == second[0] and first[1] != second[1]
            for index, first in enumerate(texts)
            for second in texts[index + 1 :]
        ):
            raise ReplayError("one text with two sets of entities")
        rules = Rules(phonemes, PinnedEntities(texts))
        second = None if page.b2 is None else second_of(page.b1, page.b2)
        positions = rules.decide(
            with_second(positions_of(page.b1, lines), second),
            page.b1,
            a,
            page.language,
            page.level,
            b2=None if second is None else second.text,
            missing=frozenset() if second is None else frozenset(second.absent_from_b2),
        )
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
        "reading_b2": position.reading_b2,
    }


def main(source: TextIO, target: TextIO, errors: TextIO, phonemes: Phonemes | None = None) -> int:
    try:
        document = json.loads(source.read())
        if phonemes is None:
            from reading.phonemes import Espeak

            phonemes = Espeak()
        replayed = replay(document, phonemes)
    except (json.JSONDecodeError, ValidationError, ReplayError):
        print(REFUSED, file=errors)
        return 2
    except RefusalError:
        print(TOO_COMPLEX, file=errors)
        return 2
    pages = [{"page": r.page, "positions": [position_row(p) for p in r.positions]} for r in replayed]
    json.dump({"pages": pages}, target, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.stdin, sys.stdout, sys.stderr))
