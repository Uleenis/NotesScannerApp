import os
from dataclasses import dataclass

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont
from skimage.filters import threshold_sauvola
from threadpoolctl import threadpool_info

from reading.segmentation import MAX_WIDTH, Fragment, Line, Segmenter, lines_of

PAPER = 250
WORDS = [
    "fable",
    "river",
    "copper",
    "lantern",
    "meadow",
    "orbit",
    "velvet",
    "harbor",
    "pebble",
    "summit",
    "willow",
    "thistle",
    "canvas",
    "ember",
]
TOLERANCE = 6
TOP = 220
SPACING = 170
MARGIN = 90
RULING = 200


@dataclass(frozen=True)
class Written:
    box: tuple[int, int, int, int]
    dark_right: int


def font_of(size: int = 56) -> ImageFont.FreeTypeFont:
    font = ImageFont.load_default(size=size)
    assert isinstance(font, ImageFont.FreeTypeFont)
    return font


def text_of(index: int, count: int) -> str:
    return " ".join(WORDS[(index * 5 + k) % len(WORDS)] for k in range(count))


def write(
    canvas: Image.Image,
    text: str,
    origin: tuple[int, int],
    ink: int,
    angle: float = 0.0,
    font_size: int = 56,
) -> tuple[int, int, int, int]:
    font = font_of(font_size)
    layer = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(layer).text(origin, text, fill=255, font=font)
    if angle:
        layer = layer.rotate(angle, resample=Image.Resampling.BICUBIC, center=origin)
    box = layer.getbbox()
    assert box is not None
    canvas.paste(Image.new("L", canvas.size, ink), mask=layer)
    return box


def draw_grid(canvas: Image.Image, step: int, shade: int) -> None:
    draw = ImageDraw.Draw(canvas)
    for x in range(step, canvas.width, step):
        draw.line([(x, 0), (x, canvas.height)], fill=shade, width=2)
    for y in range(step, canvas.height, step):
        draw.line([(0, y), (canvas.width, y)], fill=shade, width=2)


def draw_ruling(canvas: Image.Image, rows: int, shade: int) -> None:
    draw = ImageDraw.Draw(canvas)
    draw.line([(MARGIN, 0), (MARGIN, canvas.height)], fill=shade, width=2)
    for index in range(-1, rows):
        y = TOP + index * SPACING + 120
        draw.line([(0, y), (canvas.width, y)], fill=shade, width=2)


def page(
    rows: int,
    size: tuple[int, int] = (1600, 2000),
    ink: int = 20,
    grid: int | None = None,
    ruling: int | None = None,
    light: int | None = None,
    angle: float = 0.0,
    words: int = 4,
) -> tuple[Image.Image, list[Written]]:
    canvas = Image.new("L", size, PAPER)
    if grid is not None:
        draw_grid(canvas, 48, grid)
    if ruling is not None:
        draw_ruling(canvas, rows, ruling)
    written = []
    for index in range(rows):
        origin = (120, TOP + index * SPACING)
        box = write(canvas, text_of(index, words), origin, ink, angle)
        right = box[2]
        if light is not None:
            tail = write(canvas, WORDS[index % len(WORDS)], (box[2] + 30, origin[1]), light, angle)
            box = (min(box[0], tail[0]), min(box[1], tail[1]), max(box[2], tail[2]), max(box[3], tail[3]))
        written.append(Written(box, right))
    return canvas.convert("RGB"), written


def assert_box_near(found: tuple[int, int, int, int], expected: tuple[int, int, int, int]) -> None:
    assert all(abs(a - b) <= TOLERANCE for a, b in zip(found, expected, strict=True)), (found, expected)


@pytest.fixture(scope="module")
def segmenter() -> Segmenter:
    return Segmenter()


def test_every_written_line_is_found_in_order_from_the_top(segmenter: Segmenter) -> None:
    photo, written = page(rows=5)
    lines = segmenter.lines(photo)
    assert len(lines) == 5
    assert [line.row for line in lines] == sorted({line.row for line in lines})
    for line, expected in zip(lines, written, strict=True):
        assert_box_near(line.box, expected.box)


def test_each_line_becomes_one_straightened_tile_of_bounded_width(segmenter: Segmenter) -> None:
    photo, _ = page(rows=3, size=(3000, 1400), words=14)
    lines = segmenter.lines(photo)
    assert len(lines) == 3
    for line in lines:
        assert line.image.mode == "L"
        assert 0 < line.image.width <= MAX_WIDTH
        assert line.image.height > 0
    assert max(line.image.width for line in lines) == MAX_WIDTH


def test_a_printed_ruling_dark_enough_to_pass_for_ink_is_not_read_as_lines(segmenter: Segmenter) -> None:
    photo, written = page(rows=4, ruling=RULING)
    red = np.asarray(photo)[:, :, 0]
    rules = np.abs(red.astype(int) - RULING) <= 2
    binary = red < threshold_sauvola(red, window_size=57, k=0.2)
    assert (binary & rules).sum() > 0.9 * rules.sum()
    lines = segmenter.lines(photo)
    assert len(lines) == 4
    for line, expected in zip(lines, written, strict=True):
        assert_box_near(line.box, expected.box)


def test_a_light_stroke_at_the_end_of_a_pencil_line_is_kept(segmenter: Segmenter) -> None:
    photo, written = page(rows=4, ink=120, light=172, grid=205)
    lines = segmenter.lines(photo)
    assert len(lines) == 4
    for line, expected in zip(lines, written, strict=True):
        assert line.box[2] > expected.dark_right + 40
        assert_box_near(line.box, expected.box)


def ink_points(line: Line) -> list[tuple[int, int]]:
    tile = np.asarray(line.image)
    ys, xs = np.nonzero(tile < 100)
    return list(zip(xs.tolist(), ys.tolist(), strict=True))


def test_a_point_of_a_tile_lands_on_the_same_ink_of_the_photo(segmenter: Segmenter) -> None:
    photo, _ = page(rows=3, size=(3000, 1500), words=14, angle=2.5)
    gray = np.asarray(photo.convert("L"))
    lines = segmenter.lines(photo)
    assert len(lines) == 3
    assert any(line.image.width == MAX_WIDTH for line in lines)
    for line in lines:
        points = ink_points(line)
        assert len(points) > 500
        on_ink = 0
        x0, y0, x1, y1 = line.box
        for u, v in points:
            x, y = line.to_photo(u + 0.5, v + 0.5)
            assert x0 - TOLERANCE <= x <= x1 + TOLERANCE
            assert y0 - TOLERANCE <= y <= y1 + TOLERANCE
            if gray[int(y), int(x)] < 160:
                on_ink += 1
        assert on_ink / len(points) > 0.9


def test_a_blank_photo_has_no_line_and_no_error(segmenter: Segmenter) -> None:
    photo = Image.new("RGB", (1200, 1600), (PAPER, PAPER, PAPER))
    assert segmenter.lines(photo) == []


@dataclass
class Recorded:
    lines: list[object]


class RecordingModel:
    def __init__(self) -> None:
        self.threads: list[int] = []

    def predict(self, im: Image.Image, config: object) -> Recorded:
        self.threads = [pool["num_threads"] for pool in threadpool_info()]
        return Recorded(lines=[])


def test_the_segmenter_runs_on_one_thread_as_the_kraken_command_did(
    segmenter: Segmenter, monkeypatch: pytest.MonkeyPatch
) -> None:
    if (os.cpu_count() or 1) < 2:
        pytest.skip("one processor: the limit cannot be told apart from the machine")
    model = RecordingModel()
    monkeypatch.setattr(segmenter, "_model", model)
    photo, _ = page(rows=1)
    assert segmenter.fragments(photo) == []
    assert model.threads
    assert set(model.threads) == {1}
    assert any(pool["num_threads"] > 1 for pool in threadpool_info())


def test_fragments_of_the_same_height_make_one_line() -> None:
    canvas = Image.new("L", (1600, 600), PAPER)
    left = write(canvas, "copper lantern", (100, 250), 20)
    right = write(canvas, "meadow orbit", (900, 250), 20)
    base = float(left[3] - 12)
    fragments = [
        Fragment.of([(left[0], base), (left[2], base)], [(left[0], left[1]), (left[2], left[3])]),
        Fragment.of([(right[0], base + 4), (right[2], base + 4)], [(right[0], right[1]), (right[2], right[3])]),
    ]
    lines = lines_of(canvas.convert("RGB"), fragments)
    assert len(lines) == 1
    assert_box_near(lines[0].box, (left[0], min(left[1], right[1]), right[2], max(left[3], right[3])))


def fragment_under(box: tuple[int, int, int, int], top: int) -> Fragment:
    base = float(top + font_of().getmetrics()[0])
    return Fragment.of([(box[0], base), (box[2], base)], [(box[0], box[1]), (box[2], box[3])])


def test_the_ink_of_a_neighbouring_line_is_erased_from_a_tile() -> None:
    canvas = Image.new("L", (1200, 600), PAPER)
    above_layer = Image.new("L", canvas.size, 0)
    font = font_of()
    ImageDraw.Draw(above_layer).text((100, 200), "jumpy gypsy jig", fill=255, font=font)
    canvas.paste(Image.new("L", canvas.size, 20), mask=above_layer)
    above = above_layer.getbbox()
    below = write(canvas, "bold little thistle", (100, 262), 20)
    assert above is not None
    lines = lines_of(
        canvas.convert("RGB"),
        [fragment_under(above, 200), fragment_under(below, 262)],
    )
    assert len(lines) == 2
    tile = np.asarray(lines[1].image)
    reach = np.asarray(above_layer) > 0
    ys, xs = np.nonzero(tile < 230)
    landed = [lines[1].to_photo(u + 0.5, v + 0.5) for u, v in zip(xs.tolist(), ys.tolist(), strict=True)]
    assert lines[1].to_photo(0, 0)[1] < above[3] - 8
    assert not any(reach[int(y), int(x)] for x, y in landed)


def test_a_stroke_across_two_lines_is_cut_between_them() -> None:
    canvas = Image.new("L", (1200, 600), PAPER)
    upper = write(canvas, "harbor summit", (100, 200), 20)
    lower = write(canvas, "willow thistle", (100, 330), 20)
    x = upper[0] + 160
    ImageDraw.Draw(canvas).line([(x, upper[3] - 35), (x, lower[1] + 35)], fill=20, width=4)
    lines = lines_of(
        canvas.convert("RGB"),
        [fragment_under(upper, 200), fragment_under(lower, 330)],
    )
    assert len(lines) == 2
    assert lines[0].box[3] <= lower[1] + 10
    assert lines[1].box[1] >= upper[3] - 10


def test_lines_without_fragments_are_empty() -> None:
    canvas = Image.new("L", (800, 400), PAPER)
    write(canvas, "copper lantern", (100, 150), 20)
    assert lines_of(canvas.convert("RGB"), []) == []
