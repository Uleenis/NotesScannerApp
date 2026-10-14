from collections.abc import Mapping, Sequence
from dataclasses import dataclass

INFINITY = float("inf")
PAIR = 0
LEFT_OUT = 1
EXTRA = 2
IN_HOLE = 3


@dataclass(frozen=True)
class Step:
    ref: int | None
    hyp: int | None
    column: int


def char_lev(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a or not b:
        return max(len(a), len(b))
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def sub_cost(a: str, b: str) -> float:
    if a == b:
        return 0.0
    return min(1.0, char_lev(a, b) / max(len(a), len(b)))


def cells(n: int, m: int, budgets: Mapping[int, int]) -> int:
    return (n + 1) * (m + 1 + sum(budgets.values()))


def align_blocks(ref: Sequence[str], hyp: Sequence[str], budgets: Mapping[int, int]) -> list[Step]:
    n, m = len(ref), len(hyp)
    best = [[INFINITY] * (m + 1) for _ in range(n + 1)]
    arg = [[0] * (m + 1) for _ in range(n + 1)]
    layers: list[list[list[tuple[int, int]]]] = []
    for j in range(m + 1):
        cap = budgets.get(j, 0)
        cur = [[INFINITY] * (cap + 1) for _ in range(n + 1)]
        trace = [[(EXTRA, 0)] * (cap + 1) for _ in range(n + 1)]
        for i in range(n + 1):
            if i == 0 and j == 0:
                cur[0][0] = 0.0
            else:
                if i > 0 and j > 0:
                    cur[i][0] = best[i - 1][j - 1] + sub_cost(ref[i - 1], hyp[j - 1])
                    trace[i][0] = (PAIR, 0)
                if i > 0:
                    value = cur[i - 1][0] + 1.0
                    if value < cur[i][0]:
                        cur[i][0] = value
                        trace[i][0] = (LEFT_OUT, 0)
                if j > 0:
                    value = best[i][j - 1] + 1.0
                    if value < cur[i][0]:
                        cur[i][0] = value
                        trace[i][0] = (EXTRA, 0)
            if i > 0:
                for c in range(1, cap + 1):
                    cur[i][c] = cur[i - 1][c] + 1.0
                    trace[i][c] = (LEFT_OUT, c)
                    value = cur[i - 1][c - 1]
                    if value < cur[i][c]:
                        cur[i][c] = value
                        trace[i][c] = (IN_HOLE, c - 1)
            k = min(range(cap + 1), key=lambda c: cur[i][c])
            best[i][j], arg[i][j] = cur[i][k], k
        layers.append(trace)
    steps = []
    i, j, c = n, m, arg[n][m]
    while i > 0 or j > 0:
        move, previous = layers[j][i][c]
        if move == PAIR:
            steps.append(Step(i - 1, j - 1, j - 1))
            i -= 1
            j -= 1
            c = arg[i][j]
        elif move == EXTRA:
            steps.append(Step(None, j - 1, j - 1))
            j -= 1
            c = arg[i][j]
        else:
            steps.append(Step(i - 1, None, j))
            i -= 1
            c = previous
    steps.reverse()
    return steps
