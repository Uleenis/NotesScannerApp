from collections.abc import Sequence
from dataclasses import dataclass, replace
from decimal import Decimal

from reading.alignment import align_blocks, cells, letter_pairs
from reading.recognition import Box, ReadLine
from reading.refusal import too_complex
from reading.tokens import Token, line_tokens, raw_spans, tokens_of

THRESHOLD = Decimal("0.129")
MAX_CELLS = 1_000_000
MAX_LETTER_PAIRS = 50_000_000


@dataclass(frozen=True)
class Model:
    status: str
    cer: Decimal | None


@dataclass(frozen=True)
class Position:
    token_index: int
    line_index: int
    text: str
    rule: int | None
    channel: str | None
    reading_a: str | None
    reading_b1: str
    anchor_kind: str | None
    anchor: Box | None
    a_index: int | None
    confidence: float | None
    reading_b2: str | None = None
    b2_index: int | None = None
    b1_start: int | None = None
    b1_end: int | None = None


@dataclass(frozen=True)
class Alert:
    kind: str
    details: dict[str, object]


@dataclass(frozen=True)
class AToken:
    token: Token
    line: int
    box: Box
    confidence: float


def gate_open(models: Sequence[Model]) -> bool:
    return any(model.status == "active" and model.cer is not None and model.cer <= THRESHOLD for model in models)


def a_text(lines: Sequence[ReadLine]) -> str:
    return "\n".join(" ".join(word.text for word in line.words) for line in lines)


def a_stream(lines: Sequence[ReadLine]) -> tuple[list[AToken], dict[int, list[int]]]:
    stream: list[AToken] = []
    holes: dict[int, list[int]] = {}
    for index, line in enumerate(lines):
        if not line.words:
            holes.setdefault(len(stream), []).append(index)
            continue
        for word in line.words:
            stream.extend(AToken(token, index, word.box, word.confidence) for token in tokens_of(word.text))
    return stream, holes


def budgets_of(holes: dict[int, list[int]], b1: Sequence[tuple[Token, int]], a_length: int) -> dict[int, int]:
    counts: dict[int, int] = {}
    for _, line in b1:
        counts[line] = counts.get(line, 0) + 1
    lengths = sorted(counts.values(), reverse=True)
    surplus = max(0, len(b1) - a_length)
    return {column: min(sum(lengths[: len(rows)]), surplus) for column, rows in holes.items()}


def spanning(boxes: Sequence[Box]) -> Box:
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def nearest(index: int, candidates: Sequence[int]) -> int:
    return min(candidates, key=lambda k: (abs(index - k), k))


def positions_of(
    b1_text: str,
    lines: Sequence[ReadLine],
    max_cells: int = MAX_CELLS,
    max_letter_pairs: int = MAX_LETTER_PAIRS,
) -> list[Position]:
    b1 = line_tokens(b1_text)
    stream, holes = a_stream(lines)
    budgets = budgets_of(holes, b1, len(stream))
    if cells(len(b1), len(stream), budgets) > max_cells:
        raise too_complex()
    if letter_pairs([token.form for token, _ in b1], [a.token.form for a in stream]) > max_letter_pairs:
        raise too_complex()
    steps = align_blocks([token.form for token, _ in b1], [a.token.form for a in stream], budgets)

    paired: dict[int, int] = {}
    column_of: dict[int, int] = {}
    for step in steps:
        if step.ref is None:
            continue
        if step.hyp is not None:
            paired[step.ref] = step.hyp
        else:
            column_of[step.ref] = step.column

    paired_on_line: dict[int, list[int]] = {}
    for index in sorted(paired):
        paired_on_line.setdefault(b1[index][1], []).append(index)

    unread_lines: dict[int, list[int]] = {}
    for index in sorted(column_of):
        line = b1[index][1]
        column = column_of[index]
        if line not in paired_on_line and column in holes and line not in unread_lines.get(column, []):
            unread_lines.setdefault(column, []).append(line)

    def anchor_of(index: int) -> tuple[str | None, Box | None]:
        if index in paired:
            return "word", stream[paired[index]].box
        line = b1[index][1]
        if line in paired_on_line:
            return "line", lines[stream[paired[nearest(index, paired_on_line[line])]].line].box
        column = column_of[index]
        if column not in holes:
            return None, None
        rows = holes[column]
        if len(rows) == 1:
            return "line", lines[rows[0]].box
        groups = unread_lines[column]
        if len(groups) == len(rows):
            return "line", lines[rows[groups.index(line)]].box
        return "line", spanning([lines[row].box for row in rows])

    positions = []
    for index, (token, line) in enumerate(b1):
        kind, anchor = anchor_of(index)
        a_index = paired.get(index)
        read = None if a_index is None else stream[a_index]
        positions.append(
            Position(
                index,
                line,
                token.text,
                None,
                None,
                None if read is None else read.token.text,
                token.text,
                kind,
                anchor,
                a_index,
                None if read is None else read.confidence,
            )
        )
    return positions


def with_places(positions: Sequence[Position], text: str) -> list[Position]:
    spans = raw_spans(text)
    if spans is None or len(spans) != len(positions):
        return list(positions)
    return [replace(p, b1_start=start, b1_end=end) for p, (start, end) in zip(positions, spans, strict=True)]
