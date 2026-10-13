from dataclasses import dataclass, field
from statistics import median

import numpy as np
import numpy.typing as npt
from scipy import ndimage
from skimage.filters import threshold_sauvola

Gray = npt.NDArray[np.uint8]
Labels = npt.NDArray[np.int32]
Floats = npt.NDArray[np.float64]
Flags = npt.NDArray[np.bool_]
Box = tuple[slice, slice]

DARK_RATIO = 0.58
SPREAD = 0.45
CEILING = 0.95
CORE_PERCENTILE = 40
DARK_PERCENTILE = 20
PAPER_PERCENTILE = 90
MINIMUM_CANDIDATES = 12
FIRST_WINDOW = 41
FIRST_X_HEIGHT = 30.0
SAUVOLA_K = 0.2


@dataclass
class Band:
    row: int
    base: float
    cost: float
    mass: float


@dataclass
class Component:
    k: int
    y0: int
    y1: int
    x0: int
    x1: int
    rows: Floats
    counts: Floats
    mass: float
    candidates: list[Band] = field(default_factory=list)
    row: int | None = None
    cost: float = 0.0


def profile(labels: Labels, box: Box, k: int) -> Component:
    counts = (labels[box] == k).sum(axis=1).astype(np.float64)
    return Component(
        k=k,
        y0=int(box[0].start),
        y1=int(box[0].stop),
        x0=int(box[1].start),
        x1=int(box[1].stop),
        rows=np.arange(box[0].start, box[0].stop, dtype=np.float64),
        counts=counts,
        mass=float(counts.sum()),
    )


def components(labels: Labels) -> list[Component]:
    boxes: list[Box | None] = ndimage.find_objects(labels)
    return [profile(labels, box, k) for k, box in enumerate(boxes, 1) if box is not None]


def dark_cut(dark: Floats, areas: Floats, candidates: Flags, paper: float, strict: bool) -> float:
    if strict:
        return DARK_RATIO * paper
    selected = candidates & (areas > 0)
    if selected.sum() < MINIMUM_CANDIDATES:
        return DARK_RATIO * paper
    core = float(np.percentile(dark[selected], CORE_PERCENTILE))
    return min(CEILING * paper, core + SPREAD * (paper - core))


def darkness(values: Floats) -> float:
    return float(np.percentile(values, DARK_PERCENTILE))


def label_image(
    gray: Gray, window: int, paper: float, x_height: float, strict: bool
) -> tuple[Labels, Flags, list[Box]]:
    mask = gray < threshold_sauvola(gray, window_size=window, k=SAUVOLA_K)
    labels, count = ndimage.label(mask, np.ones((3, 3), bool))
    if not count:
        return labels, np.zeros(0, bool), []
    index = np.arange(1, count + 1)
    areas = np.asarray(ndimage.sum(mask, labels, index), np.float64)
    boxes: list[Box] = ndimage.find_objects(labels)
    heights = np.array([box[0].stop - box[0].start for box in boxes], float)
    widths = np.array([box[1].stop - box[1].start for box in boxes], float)
    dark = np.asarray(ndimage.labeled_comprehension(gray, labels, index, darkness, float, 255.0), np.float64)
    thin = np.minimum(heights, widths)

    shape = ((widths > 8 * x_height) & (heights < 0.35 * x_height)) | (
        (heights > 8 * x_height) & (widths < 0.35 * x_height)
    )
    shape |= (widths > 0.5 * gray.shape[1]) | (heights > 0.5 * gray.shape[0])
    size = (areas >= max(6.0, 0.01 * x_height * x_height)) & (areas <= 40.0 * x_height * x_height)

    cut = dark_cut(dark, areas, size & ~shape, paper, strict)
    rule = shape | (dark > cut) | ((thin < 0.2 * x_height) & (dark > 0.45 * cut + 0.55 * paper))
    keep = size & ~rule
    table = np.zeros(count + 1, np.int32)
    table[1:][keep] = index[keep]
    return table[labels], keep, boxes


def ink(red: Gray) -> tuple[Labels, list[Component], float]:
    paper = float(np.percentile(red, PAPER_PERCENTILE))
    _, keep, boxes = label_image(red, FIRST_WINDOW, paper, FIRST_X_HEIGHT, strict=True)
    heights = [box[0].stop - box[0].start for box, kept in zip(boxes, keep, strict=True) if kept]
    x_height = float(median(heights)) if heights else FIRST_X_HEIGHT
    window = int(max(15, min(151, 2 * x_height))) | 1
    labels, _, _ = label_image(red, window, paper, x_height, strict=False)
    return labels, components(labels), x_height
