import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from reading.recognition import Reading
from reading.refusal import invalid_request, too_complex

MAX_CER = 0.6
SHEET_LINES = 20
TRAINING_LINES = 30
VALIDATION_LINES = 10
SHEETS = (1, 2)
MAX_READ_CHARS = 4_000
MAX_READ_LINES = 60
BREAK = "\n"

TEXTS = Path(__file__).with_name("writing_test_texts.json")


@dataclass(frozen=True)
class Piece:
    text: str
    first: int
    last: int


@dataclass(frozen=True)
class SheetCount:
    lines: int
    training: int
    validation: int


def template_lines(template: str) -> tuple[str, ...]:
    texts = json.loads(TEXTS.read_text(encoding="utf-8"))
    if template not in texts:
        raise invalid_request()
    return tuple(texts[template]["lines"])


def sheet_lines(template: str, sheet: int) -> tuple[str, ...]:
    if sheet not in SHEETS:
        raise invalid_request()
    lines = template_lines(template)
    return lines[(sheet - 1) * SHEET_LINES : sheet * SHEET_LINES]


def read_lines(reading: Reading) -> list[str]:
    lines = (" ".join(word.text for word in line.words) for line in reading.lines)
    return [line for line in lines if line]


def distance(a: str, b: str) -> int:
    if not a or not b:
        return max(len(a), len(b))
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def cer(read: str, piece: str) -> float:
    if not piece:
        return 0.0 if not read else float("inf")
    return distance(read, piece) / len(piece)


DIAGONAL = 0
UP = 1
LEFT = 2


def align(reference: str, read: str) -> list[tuple[int | None, int | None]]:
    n, m = len(reference), len(read)
    moves = [bytearray(m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        moves[i][0] = UP
    for j in range(1, m + 1):
        moves[0][j] = LEFT
    previous = list(range(m + 1))
    for i in range(1, n + 1):
        current = [i]
        row = moves[i]
        ref_char = reference[i - 1]
        for j in range(1, m + 1):
            diagonal = previous[j - 1] + (ref_char != read[j - 1])
            up = previous[j] + 1
            left = current[j - 1] + 1
            best = min(diagonal, up, left)
            current.append(best)
            row[j] = DIAGONAL if best == diagonal else (UP if best == up else LEFT)
        previous = current
    pairs: list[tuple[int | None, int | None]] = []
    i, j = n, m
    while i > 0 or j > 0:
        move = moves[i][j]
        if move == DIAGONAL:
            pairs.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif move == UP:
            pairs.append((i - 1, None))
            i -= 1
        else:
            pairs.append((None, j - 1))
            j -= 1
    pairs.reverse()
    return pairs


def cut(reference: str, read: Sequence[str]) -> list[Piece]:
    text = BREAK.join(read)
    owned: list[list[int]] = [[] for _ in read]
    line = 0
    for ref_index, read_index in align(reference, text):
        breaks = read_index is not None and text[read_index] == BREAK
        if ref_index is not None and not (breaks and reference[ref_index] == BREAK):
            owned[line].append(ref_index)
        if breaks:
            line += 1
    pieces = []
    for indices in owned:
        letters = [index for index in indices if not reference[index].isspace()]
        if not letters:
            pieces.append(Piece("", -1, -1))
            continue
        chars = "".join(" " if reference[index] == BREAK else reference[index] for index in indices)
        pieces.append(Piece(" ".join(chars.split()), letters[0], letters[-1]))
    return pieces


def line_of(starts: Sequence[int], index: int) -> int:
    line = 0
    for number, start in enumerate(starts):
        if start <= index:
            line = number
    return line


def count_sheet(template: str, sheet: int, read: Sequence[str]) -> SheetCount:
    lines = sheet_lines(template, sheet)
    if len(read) > MAX_READ_LINES or sum(map(len, read)) + len(read) > MAX_READ_CHARS:
        raise too_complex()
    if not read:
        return SheetCount(lines=0, training=0, validation=0)
    reference = BREAK.join(lines)
    starts = []
    offset = 0
    for line in lines:
        starts.append(offset)
        offset += len(line) + 1
    first_line = (sheet - 1) * SHEET_LINES
    training: set[int] = set()
    validation: set[int] = set()
    for text, piece in zip(read, cut(reference, read), strict=True):
        if piece.first < 0 or cer(text, piece.text) > MAX_CER:
            continue
        begins = first_line + line_of(starts, piece.first)
        ends = first_line + line_of(starts, piece.last)
        covered = range(begins, ends + 1)
        if ends < TRAINING_LINES:
            training.update(covered)
        elif begins >= TRAINING_LINES:
            validation.update(covered)
    return SheetCount(lines=len(read), training=len(training), validation=len(validation))
