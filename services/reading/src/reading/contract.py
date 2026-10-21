from itertools import pairwise
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from reading.alto import alto_of
from reading.arbiter import Arbitration
from reading.photo import MAX_SIDE
from reading.recognition import Box, Reading, ReadLine, Word
from reading.refusal import invalid_request

IDENTIFIER = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
MAX_B1 = 200_000
MAX_LINES = 2_000
MAX_WORDS = 2_000
MAX_DURATION_MS = 3_600_000

Identifier = Annotated[str, Field(pattern=IDENTIFIER)]
Coordinate = Annotated[int, Field(ge=0, le=MAX_SIDE)]
Corners = Annotated[list[Coordinate], Field(min_length=4, max_length=4)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class WordIn(Strict):
    text: Annotated[str, Field(min_length=1, max_length=1_000, pattern=r"^\S+$")]
    box: Corners
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]


class LineIn(Strict):
    row: Annotated[int, Field(ge=0)]
    box: Corners
    ink: Corners
    words: Annotated[list[WordIn], Field(max_length=MAX_WORDS)]


class ReadingIn(Strict):
    page_id: Identifier
    width: Annotated[int, Field(ge=1, le=MAX_SIDE)]
    height: Annotated[int, Field(ge=1, le=MAX_SIDE)]
    lines: Annotated[list[LineIn], Field(max_length=MAX_LINES)]
    alto: str


class ArbitrationIn(Strict):
    page_id: Identifier
    user_id: Identifier
    b1: Annotated[str, Field(max_length=MAX_B1)]
    b2: Annotated[str, Field(max_length=MAX_B1)] | None = None
    a: ReadingIn
    duration_ms: Annotated[int, Field(ge=0, le=MAX_DURATION_MS)]


def box_of(corners: list[int], width: int, height: int) -> Box:
    x0, y0, x1, y1 = corners
    if not (x0 < x1 <= width and y0 < y1 <= height):
        raise invalid_request()
    return (x0, y0, x1, y1)


def reading_of(sent: ReadingIn) -> Reading:
    rows = [line.row for line in sent.lines]
    if any(later <= earlier for earlier, later in pairwise(rows)):
        raise invalid_request()
    lines = tuple(
        ReadLine(
            row=line.row,
            box=box_of(line.box, sent.width, sent.height),
            ink=box_of(line.ink, sent.width, sent.height),
            words=tuple(
                Word(word.text, box_of(word.box, sent.width, sent.height), word.confidence) for word in line.words
            ),
        )
        for line in sent.lines
    )
    return Reading(width=sent.width, height=sent.height, lines=lines, segment_seconds=0.0, recognize_seconds=0.0)


def arbitration_of(body: bytes) -> Arbitration:
    try:
        sent = ArbitrationIn.model_validate_json(body)
    except ValidationError as error:
        raise invalid_request() from error
    if sent.a.page_id != sent.page_id:
        raise invalid_request()
    reading = reading_of(sent.a)
    if alto_of(reading) != sent.a.alto:
        raise invalid_request()
    return Arbitration(
        page_id=sent.page_id,
        user_id=sent.user_id,
        b1=sent.b1,
        reading=reading,
        duration_ms=sent.duration_ms,
        b2=sent.b2,
    )
