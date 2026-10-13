from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median

import numpy as np
from PIL import Image
from scipy import ndimage
from threadpoolctl import threadpool_limits

from reading.ink import Band, Component, Floats, Gray, Labels, components, ink
from reading.refusal import too_complex

Point = tuple[float, float]

MAX_WIDTH = 1700
ROW_TOLERANCE = 0.6
ABOVE_SCALE = 2.6
BELOW_SCALE = 1.3
DX_WEIGHT = 0.6
MAX_COST = 3.0
CORE_UP = 1.2
CORE_DOWN = 0.25
CORE_SHARE = 0.15
BRIDGE = 1.0
UP_RATIO = 2.0
DOWN_RATIO = 1.1
UP_MAX = 3.4
DOWN_MAX = 2.0
SIDE_RATIO = 0.35
INK_MARGIN = 0.18
HALO = 3
PAPER = 255
MAX_COMPONENTS = 40_000


@dataclass(frozen=True)
class Fragment:
    baseline: tuple[Point, ...]
    x0: float
    x1: float
    base: float
    height: float

    @classmethod
    def of(cls, baseline: Sequence[Sequence[float]], boundary: Sequence[Sequence[float]]) -> "Fragment":
        points = tuple((float(p[0]), float(p[1])) for p in baseline)
        ys = [p[1] for p in boundary]
        return cls(
            baseline=points,
            x0=points[0][0],
            x1=points[-1][0],
            base=sum(p[1] for p in points) / len(points),
            height=max(ys) - min(ys),
        )


@dataclass(frozen=True)
class Row:
    base: float
    baseline: tuple[Point, ...]
    x0: float
    x1: float


@dataclass(frozen=True)
class Placement:
    origin: Point
    cos: float
    sin: float
    scale_x: float
    scale_y: float

    def to_photo(self, x: float, y: float) -> Point:
        u = x * self.scale_x
        v = y * self.scale_y
        return (self.origin[0] + self.cos * u - self.sin * v, self.origin[1] + self.sin * u + self.cos * v)


@dataclass(frozen=True)
class Line:
    row: int
    image: Image.Image
    box: tuple[int, int, int, int]
    baseline: tuple[Point, ...]
    placement: Placement

    def to_photo(self, x: float, y: float) -> Point:
        return self.placement.to_photo(x, y)


@dataclass
class _Group:
    base: float
    fragments: list[Fragment]


def y_at(baseline: Sequence[Point], x: float, limit: float | None = None) -> float:
    n = len(baseline)
    if n == 1:
        return float(baseline[0][1])
    if limit is not None:
        x = min(max(x, baseline[0][0] - limit), baseline[-1][0] + limit)
    if x <= baseline[0][0]:
        a, b = baseline[0], baseline[1]
    elif x >= baseline[-1][0]:
        a, b = baseline[-2], baseline[-1]
    else:
        i = 0
        while i + 2 < n and baseline[i + 1][0] <= x:
            i += 1
        a, b = baseline[i], baseline[i + 1]
    if b[0] == a[0]:
        return float(b[1])
    return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])


def group_rows(fragments: Sequence[Fragment]) -> list[Row]:
    if not fragments:
        return []
    tolerance = median(f.height for f in fragments) * ROW_TOLERANCE
    groups: list[_Group] = []
    for fragment in sorted(fragments, key=lambda f: f.base):
        for group in groups:
            if abs(fragment.base - group.base) <= tolerance:
                group.fragments.append(fragment)
                group.base = sum(g.base for g in group.fragments) / len(group.fragments)
                break
        else:
            groups.append(_Group(fragment.base, [fragment]))

    rows = []
    for group in sorted(groups, key=lambda g: g.base):
        points = sorted((p for f in group.fragments for p in f.baseline), key=lambda p: p[0])
        baseline = [points[0]]
        for point in points[1:]:
            if point[0] > baseline[-1][0]:
                baseline.append(point)
        rows.append(
            Row(
                base=group.base,
                baseline=tuple(baseline),
                x0=min(f.x0 for f in group.fragments),
                x1=max(f.x1 for f in group.fragments),
            )
        )
    return rows


def weighted_median(values: Floats, weights: Floats, total: float) -> float:
    order = np.argsort(values)
    cumulative = np.cumsum(weights[order])
    i = min(int(np.searchsorted(cumulative, 0.5 * total)), len(order) - 1)
    return float(values[order][i])


def bands(component: Component, rows: Sequence[Row], x_height: float) -> list[Band]:
    out = []
    xc = 0.5 * (component.x0 + component.x1)
    for r, row in enumerate(rows):
        base = y_at(row.baseline, xc, 2.0 * x_height)
        if not (component.y0 - 3.6 * x_height < base < component.y1 + 3.6 * x_height):
            continue
        dx = max(0.0, row.x0 - component.x1, component.x0 - row.x1)
        d = component.rows - base
        cost = np.where(d > 0, d / (BELOW_SCALE * x_height), -d / (ABOVE_SCALE * x_height))
        value = weighted_median(cost, component.counts, component.mass) + DX_WEIGHT * dx / x_height
        mass = 0.0
        if dx < 1.5 * x_height:
            mass = float(component.counts[(d >= -CORE_UP * x_height) & (d <= CORE_DOWN * x_height)].sum())
        out.append(Band(row=r, base=base, cost=value, mass=mass))
    return out


def assign(comps: Sequence[Component], rows: Sequence[Row], x_height: float) -> None:
    for component in comps:
        candidates = bands(component, rows, x_height)
        component.candidates = candidates
        component.row = None
        component.cost = MAX_COST
        for band in candidates:
            if band.cost < component.cost:
                component.cost = band.cost
                component.row = band.row
        strong = [band for band in candidates if band.mass >= CORE_SHARE * component.mass]
        if strong:
            component.row = max(strong, key=lambda band: band.mass).row


def cut_straddling(comps: list[Component], labels: Labels, x_height: float) -> tuple[list[Component], int]:
    following = int(labels.max()) + 1
    cuts = 0
    for component in comps:
        strong = sorted(
            (band for band in component.candidates if band.mass >= CORE_SHARE * component.mass),
            key=lambda band: band.base,
        )
        if len(strong) < 2:
            continue
        low = strong[0].base + CORE_DOWN * x_height
        high = strong[-1].base - CORE_UP * x_height
        if high <= low:
            low = high = 0.5 * (strong[0].base + strong[-1].base)
        window = (component.rows >= min(low, high)) & (component.rows <= max(low, high))
        if not window.any():
            continue
        core = np.zeros(len(component.rows), bool)
        for band in strong:
            d = component.rows - band.base
            core |= (d >= -CORE_UP * x_height) & (d <= CORE_DOWN * x_height)
        reference = median(component.counts[core]) if core.any() else median(component.counts)
        if component.counts[window].min() > BRIDGE * reference:
            continue
        y = int(component.rows[int(np.argmin(np.where(window, component.counts, np.inf)))])
        box = (slice(component.y0, component.y1), slice(component.x0, component.x1))
        sub = labels[box]
        lower = (sub == component.k) & (np.arange(component.y0, component.y1)[:, None] > y)
        if not lower.any():
            continue
        sub[lower] = following
        following += 1
        cuts += 1

    if not cuts:
        return comps, 0
    return components(labels), cuts


def row_x_height(members: Sequence[Component], x_height: float) -> float:
    heights = [c.y1 - c.y0 for c in members if 0.4 * x_height <= c.y1 - c.y0 <= 2.2 * x_height]
    return float(median(heights)) if heights else x_height


def span(baseline: Sequence[Point], x0: float, x1: float, limit: float) -> list[Point]:
    xs = sorted({x0, x1} | {p[0] for p in baseline if x0 < p[0] < x1})
    return [(x, y_at(baseline, x, limit)) for x in xs]


def slope(points: Sequence[Point]) -> float:
    xs = np.array([p[0] for p in points], float)
    ys = np.array([p[1] for p in points], float)
    if len(xs) < 2 or np.ptp(xs) < 1:
        return 0.0
    return float(np.polyfit(xs, ys, 1)[0])


def render(
    gray: Gray, labels: Labels, members: Sequence[Component], baseline: Sequence[Point], x_height: float
) -> tuple[Image.Image, Placement] | None:
    h, w = gray.shape
    x0_ink = min(c.x0 for c in members)
    x1_ink = max(c.x1 for c in members)
    y0_ink = min(c.y0 for c in members)
    y1_ink = max(c.y1 for c in members)
    limit = 4.0 * x_height
    base = y_at(baseline, 0.5 * (x0_ink + x1_ink), limit)
    up = min(UP_MAX * x_height, max(UP_RATIO * x_height, base - y0_ink + INK_MARGIN * x_height))
    down = min(DOWN_MAX * x_height, max(DOWN_RATIO * x_height, y1_ink - base + INK_MARGIN * x_height))
    side = SIDE_RATIO * x_height
    x0 = max(1.0, x0_ink - side)
    x1 = min(w - 2.0, x1_ink + side)
    if x1 - x0 < 4:
        return None
    m = slope(span(baseline, x0, x1, limit))
    norm = (1.0 + m * m) ** 0.5
    cos, sin = 1.0 / norm, m / norm
    sx, sy = x0, y_at(baseline, x0, limit)

    corners = [(sx + u * cos - v * sin, sy + u * sin + v * cos) for u in (0.0, (x1 - x0) * norm) for v in (-up, down)]
    px0 = max(0, int(min(p[0] for p in corners)) - 2)
    px1 = min(w, int(max(p[0] for p in corners)) + 3)
    py0 = max(0, int(min(p[1] for p in corners)) - 2)
    py1 = min(h, int(max(p[1] for p in corners)) + 3)
    if px1 - px0 < 4 or py1 - py0 < 4:
        return None

    tile = gray[py0:py1, px0:px1].copy()
    sub = labels[py0:py1, px0:px1]
    own = np.isin(sub, [c.k for c in members])
    other = (sub > 0) & ~own
    if HALO:
        other = ndimage.binary_dilation(other, np.ones((3, 3), bool), iterations=HALO) & ~own
    tile[other] = PAPER

    out_w = max(4, round((x1 - x0) * norm))
    out_h = max(4, round(up + down))
    image = Image.fromarray(tile).transform(
        (out_w, out_h),
        Image.Transform.AFFINE,
        (cos, -sin, sx - px0 + up * sin, sin, cos, sy - py0 - up * cos),
        resample=Image.Resampling.BICUBIC,
        fillcolor=PAPER,
    )
    if image.width > MAX_WIDTH:
        image = image.resize(
            (MAX_WIDTH, max(1, round(image.height * MAX_WIDTH / image.width))), Image.Resampling.LANCZOS
        )
    placement = Placement(
        origin=(sx + up * sin, sy - up * cos),
        cos=cos,
        sin=sin,
        scale_x=out_w / image.width,
        scale_y=out_h / image.height,
    )
    return image, placement


def lines_of(photo: Image.Image, fragments: Sequence[Fragment]) -> list[Line]:
    gray: Gray = np.asarray(photo.convert("L"))
    red: Gray = np.asarray(photo.convert("RGB"))[:, :, 0]
    labels, comps, x_height = ink(red)
    if len(comps) > MAX_COMPONENTS:
        raise too_complex()
    rows = group_rows(fragments)
    assign(comps, rows, x_height)
    comps, cuts = cut_straddling(comps, labels, x_height)
    if cuts:
        assign(comps, rows, x_height)

    lines = []
    for r, row in enumerate(rows):
        members = [c for c in comps if c.row == r]
        if not members:
            continue
        rendered = render(gray, labels, members, row.baseline, row_x_height(members, x_height))
        if rendered is None:
            continue
        image, placement = rendered
        lines.append(
            Line(
                row=r + 1,
                image=image,
                box=(
                    min(c.x0 for c in members),
                    min(c.y0 for c in members),
                    max(c.x1 for c in members),
                    max(c.y1 for c in members),
                ),
                baseline=row.baseline,
                placement=placement,
            )
        )
    return lines


class Segmenter:
    def __init__(self) -> None:
        from kraken.configs import SegmentationInferenceConfig
        from kraken.tasks import SegmentationTaskModel

        self._model = SegmentationTaskModel.load_model()
        self._config = SegmentationInferenceConfig()

    def fragments(self, photo: Image.Image) -> list[Fragment]:
        with threadpool_limits(limits=self._config.num_threads):
            segmentation = self._model.predict(im=photo, config=self._config)
        return [
            Fragment.of(line.baseline, line.boundary) for line in segmentation.lines if line.baseline and line.boundary
        ]

    def lines(self, photo: Image.Image) -> list[Line]:
        return lines_of(photo, self.fragments(photo))
