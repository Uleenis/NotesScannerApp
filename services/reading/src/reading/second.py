from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace

from reading.alignment import align_global, cells, char_lev, letter_pairs, sub_cost
from reading.arbitration import MAX_CELLS, MAX_LETTER_PAIRS, Position
from reading.tokens import Token, line_tokens

CLOSE = 1 / 3
SAME_LINE = 0.70
MAX_WORK = 20_000_000
MAX_MEMO = 200_000


class WorkSpentError(Exception):
    pass


class Work:
    def __init__(self, limit: int) -> None:
        self._left = limit

    def spend(self, amount: int) -> None:
        self._left -= amount
        if self._left < 0:
            raise WorkSpentError


class Scorer:
    def __init__(self) -> None:
        self._memo: dict[tuple[str, str], int] = {}

    def __call__(self, a: str, b: str) -> int:
        if a == b:
            return 2
        known = self._memo.get((a, b))
        if known is None:
            known = 1 if sub_cost(a, b) <= CLOSE else -1
            if len(self._memo) < MAX_MEMO:
                self._memo[(a, b)] = known
        return known


@dataclass(frozen=True)
class Hit:
    start: int
    end: int
    matched: int


@dataclass(frozen=True)
class Second:
    text: str
    tokens: tuple[tuple[Token, int], ...]
    mapping: Mapping[int, int]
    absent_from_b2: tuple[int, ...]
    absent_from_b1: tuple[int, ...]


def local(seg: Sequence[str], ref: Sequence[str], score: Scorer, work: Work) -> list[Hit]:
    n, m = len(seg), len(ref)
    if not n or not m:
        return []
    work.spend(n * m)
    table = [[0] * (m + 1) for _ in range(n + 1)]
    best = 0
    for i in range(1, n + 1):
        row, above, word = table[i], table[i - 1], seg[i - 1]
        for j in range(1, m + 1):
            value = above[j - 1] + score(word, ref[j - 1])
            value = max(value, above[j] - 1, row[j - 1] - 1, 0)
            row[j] = value
            best = max(best, value)
    if best <= 0:
        return []
    hits: dict[int, Hit] = {}
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if table[i][j] != best:
                continue
            pairs: list[tuple[int, int]] = []
            a, b = i, j
            while a > 0 and b > 0 and table[a][b] > 0:
                work.spend(1)
                if table[a][b] == table[a - 1][b - 1] + score(seg[a - 1], ref[b - 1]):
                    pairs.append((a - 1, b - 1))
                    a, b = a - 1, b - 1
                elif table[a][b] == table[a - 1][b] - 1:
                    a -= 1
                else:
                    b -= 1
            if not pairs:
                continue
            pairs.reverse()
            start, end = pairs[0][1], pairs[-1][1]
            work.spend(len(pairs))
            matched = sum(1 for p, q in pairs if score(seg[p], ref[q]) > 0)
            if start not in hits or matched > hits[start].matched:
                hits[start] = Hit(start, end, matched)
    return list(hits.values())


def similarity(a: Sequence[str], b: Sequence[str], work: Work) -> float:
    x, y = " ".join(a), " ".join(b)
    if not x or not y:
        return 0.0
    work.spend(len(x) * len(y))
    return 1.0 - char_lev(x, y) / max(len(x), len(y))


def rows_of(rows: Sequence[int]) -> dict[int, list[int]]:
    grouped: dict[int, list[int]] = {}
    for index, row in enumerate(rows):
        grouped.setdefault(row, []).append(index)
    return grouped


def anchor(
    words: Sequence[str],
    ref: Sequence[str],
    ref_rows: Sequence[int],
    lines: Mapping[int, list[int]],
    expected: int,
    score: Scorer,
    work: Work,
) -> Hit | None:
    hits = local(words, ref, score, work)
    if not hits:
        return None

    def whole(hit: Hit) -> float:
        found = similarity(words, [ref[k] for k in lines[ref_rows[hit.start]]], work)
        return found if found >= SAME_LINE else 0.0

    pick = max(hits, key=lambda hit: (whole(hit), -abs(hit.start - expected), -hit.start))
    if 2 * pick.matched < len(words):
        return None
    return pick


def order_units(units: Sequence[Sequence[str]], ref: Sequence[str], ref_rows: Sequence[int], work: Work) -> list[int]:
    lines = rows_of(ref_rows)
    score = Scorer()
    keys: list[tuple[float, int, int]] = []
    expected, last_end, tail = 0, -1, 0
    for index, words in enumerate(units):
        found = anchor(words, ref, ref_rows, lines, expected, score, work) if words else None
        if found is not None:
            keys.append((float(found.start), 0, index))
            expected, last_end, tail = found.end + 1, found.end, 0
        else:
            tail += 1
            keys.append((last_end + 0.5, tail, index))
    return [key[2] for key in sorted(keys)]


def content_map(
    b1: Sequence[str], b1_rows: Sequence[int], b2: Sequence[tuple[Token, int]], work: Work
) -> dict[int, int]:
    units: list[list[int]] = []
    last: int | None = None
    for index, (_, row) in enumerate(b2):
        if row != last:
            units.append([])
            last = row
        units[-1].append(index)
    forms = [token.form for token, _ in b2]
    order = order_units([[forms[k] for k in unit] for unit in units], b1, b1_rows, work)
    permuted = [k for unit in order for k in units[unit]]
    pairs = align_global(b1, [forms[k] for k in permuted])
    return {j: permuted[q] for j, q in pairs if j is not None and q is not None}


def occurs(run: Sequence[str], stream: Sequence[str], work: Work) -> bool:
    n = len(run)
    work.spend(max(1, len(stream) - n + 1) * n)
    return any(list(stream[i : i + n]) == list(run) for i in range(len(stream) - n + 1))


def absent_lines(
    forms: Sequence[str], rows: Sequence[int], paired: set[int], other: Sequence[str], work: Work
) -> tuple[int, ...]:
    return tuple(
        row
        for row, indexes in rows_of(rows).items()
        if not any(index in paired for index in indexes) and not occurs([forms[i] for i in indexes], other, work)
    )


def second_of(
    b1_text: str,
    b2_text: str,
    max_cells: int = MAX_CELLS,
    max_letter_pairs: int = MAX_LETTER_PAIRS,
    max_work: int = MAX_WORK,
) -> Second | None:
    b1 = line_tokens(b1_text)
    b2 = line_tokens(b2_text)
    if not b1 or not b2:
        return None
    b1_forms = [token.form for token, _ in b1]
    b2_forms = [token.form for token, _ in b2]
    if cells(len(b1), len(b2), {}) > max_cells or letter_pairs(b1_forms, b2_forms) > max_letter_pairs:
        return None
    b1_rows = [row for _, row in b1]
    b2_rows = [row for _, row in b2]
    work = Work(max_work)
    try:
        mapping = content_map(b1_forms, b1_rows, b2, work)
        absent_from_b2 = absent_lines(b1_forms, b1_rows, set(mapping), b2_forms, work)
        absent_from_b1 = absent_lines(b2_forms, b2_rows, set(mapping.values()), b1_forms, work)
    except WorkSpentError:
        return None
    return Second(b2_text, tuple(b2), mapping, absent_from_b2, absent_from_b1)


def with_second(positions: Sequence[Position], second: Second | None) -> list[Position]:
    if second is None:
        return list(positions)
    out = []
    for position in positions:
        found = second.mapping.get(position.token_index)
        out.append(
            position if found is None else replace(position, reading_b2=second.tokens[found][0].text, b2_index=found)
        )
    return out
