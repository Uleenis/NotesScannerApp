import os
import threading
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import pytest
from PIL import Image, ImageDraw, ImageFont
from threadpoolctl import threadpool_info

from reading import segmentation
from reading.alto import alto_of
from reading.recognition import Reader, Reading, ReadLine, Recognizer, TileWord, Word, words_of
from reading.refusal import RefusalError
from reading.segmentation import Fragment, Line, Segmenter, lines_of

ALTO = "{http://www.loc.gov/standards/alto/ns-v4#}"
PAPER = 250
INK = 20
LINES = [["copper", "lantern", "meadow"], ["fable", "river", "orbit"], ["harbor", "pebble", "summit"]]
SIZE = (1500, 900)
ANGLE = 2.0

Box = tuple[int, int, int, int]


def cut(x: int, height: int = 40) -> list[list[int]]:
    return [[x, 0], [x, height], [x, height], [x, 0]]


def test_words_are_the_runs_between_spaces_with_their_cuts_and_confidences() -> None:
    prediction = " ab  cd"
    cuts = [cut(1), cut(10), cut(20), cut(25), cut(30), cut(40), cut(50)]
    confidences = [0.5, 0.9, 0.7, 0.4, 0.4, 1.0, 0.8]
    words = words_of(prediction, cuts, confidences, width=60)
    assert words == [TileWord("ab", 10.0, 21.0, 0.8), TileWord("cd", 40.0, 51.0, 0.9)]


def test_a_confidence_is_the_mean_of_its_characters_rounded_as_kraken_writes_it() -> None:
    words = words_of("abc", [cut(1), cut(2), cut(3)], [0.99991, 0.99992, 0.99996], width=10)
    assert words == [TileWord("abc", 1.0, 4.0, 0.9999)]


def test_an_empty_or_blank_prediction_has_no_word() -> None:
    assert words_of("", [], [], width=10) == []
    assert words_of("   ", [cut(1), cut(2), cut(3)], [0.5, 0.5, 0.5], width=10) == []


def test_a_word_without_its_cuts_is_never_given_an_invented_box() -> None:
    with pytest.raises(ValueError):
        words_of("ab cd", [cut(1), cut(2), cut(3)], [0.9, 0.9, 0.9], width=80)
    with pytest.raises(ValueError):
        words_of("ab", [cut(1), cut(2)], [0.9], width=80)


def test_a_word_box_runs_from_its_first_to_its_last_character_and_stays_in_its_tile() -> None:
    assert words_of("a", [cut(30)], [0.7], width=80) == [TileWord("a", 30.0, 31.0, 0.7)]
    assert words_of("ab", [cut(5), cut(79)], [0.7, 0.9], width=80) == [TileWord("ab", 5.0, 80.0, 0.8)]


def font() -> ImageFont.FreeTypeFont:
    face = ImageFont.load_default(size=60)
    assert isinstance(face, ImageFont.FreeTypeFont)
    return face


def draw_page() -> tuple[Image.Image, list[list[Box]]]:
    canvas = Image.new("L", SIZE, PAPER)
    face = font()
    drawn = []
    for index, words in enumerate(LINES):
        x = 120
        y = 140 + index * 240
        boxes = []
        for word in words:
            layer = Image.new("L", SIZE, 0)
            ImageDraw.Draw(layer).text((x, y), word, fill=255, font=face)
            layer = layer.rotate(ANGLE, resample=Image.Resampling.BICUBIC, center=(120, y))
            box = layer.getbbox()
            assert box is not None
            canvas.paste(Image.new("L", SIZE, INK), mask=layer)
            boxes.append(box)
            x += round(face.getlength(word + " "))
        drawn.append(boxes)
    return canvas.convert("RGB"), drawn


@pytest.fixture(scope="module")
def reader() -> Reader:
    return Reader(Segmenter(), Recognizer(os.environ["READING_MODEL"]))


@pytest.fixture(scope="module")
def page() -> tuple[Image.Image, list[list[Box]]]:
    return draw_page()


@pytest.fixture(scope="module")
def reading(reader: Reader, page: tuple[Image.Image, list[list[Box]]]) -> Reading:
    return reader.read(page[0])


def inside(box: Box, outer: Box) -> bool:
    return outer[0] <= box[0] < box[2] <= outer[2] and outer[1] <= box[1] < box[3] <= outer[3]


def overlap(a: Box, b: Box) -> bool:
    return max(a[0], b[0]) < min(a[2], b[2]) and max(a[1], b[1]) < min(a[3], b[3])


def holds(box: Box, point: tuple[float, float]) -> bool:
    return box[0] <= point[0] <= box[2] and box[1] <= point[1] <= box[3]


def test_every_line_of_the_page_is_read_in_order(reading: Reading) -> None:
    assert (reading.width, reading.height) == SIZE
    assert len(reading.lines) == len(LINES)
    assert [line.row for line in reading.lines] == sorted(line.row for line in reading.lines)
    assert reading.segment_seconds > 0
    assert reading.recognize_seconds > 0


def test_every_word_has_a_box_on_the_photo_and_a_confidence(reading: Reading) -> None:
    for line in reading.lines:
        assert line.words
        for word in line.words:
            assert word.text.strip() == word.text != ""
            assert 0.0 <= word.confidence <= 1.0
            assert inside(word.box, (0, 0, *SIZE))


def test_every_word_box_lies_in_its_line(reading: Reading) -> None:
    for line in reading.lines:
        assert inside(line.ink, line.box)
        for word in line.words:
            assert inside(word.box, line.box)
            assert overlap(word.box, line.ink)


def test_word_boxes_land_on_the_written_words(reading: Reading, page: tuple[Image.Image, list[list[Box]]]) -> None:
    _, drawn = page
    for line, written in zip(reading.lines, drawn, strict=True):
        assert len(line.words) == len(written)
        assert [word.box[0] for word in line.words] == sorted(word.box[0] for word in line.words)
        for word, expected in zip(line.words, written, strict=True):
            centre = (0.5 * (expected[0] + expected[2]), 0.5 * (expected[1] + expected[3]))
            assert holds(word.box, centre), (word.box, expected)
            assert overlap(word.box, expected)


def edits(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def test_the_page_is_read_word_for_word(reading: Reading) -> None:
    read = [[word.text for word in line.words] for line in reading.lines]
    close = sum(
        edits(a.lower(), b) <= 1 for got, want in zip(read, LINES, strict=True) for a, b in zip(got, want, strict=True)
    )
    assert close >= 8


def test_the_alto_carries_each_word_with_its_box_and_confidence(reading: Reading) -> None:
    root = ET.fromstring(alto_of(reading))
    assert root.tag == f"{ALTO}alto"
    page = root.find(f"{ALTO}Layout/{ALTO}Page")
    assert page is not None
    assert (int(page.get("WIDTH", "0")), int(page.get("HEIGHT", "0"))) == SIZE
    lines = list(root.iter(f"{ALTO}TextLine"))
    assert len(lines) == len(reading.lines)
    for element, line in zip(lines, reading.lines, strict=True):
        strings = element.findall(f"{ALTO}String")
        assert len(strings) == len(line.words)
        for string, word in zip(strings, line.words, strict=True):
            x, y = int(string.get("HPOS", "-1")), int(string.get("VPOS", "-1"))
            w, h = int(string.get("WIDTH", "-1")), int(string.get("HEIGHT", "-1"))
            assert string.get("CONTENT") == word.text
            assert (x, y, x + w, y + h) == word.box
            assert float(string.get("WC", "-1")) == word.confidence


def test_the_alto_escapes_what_it_carries() -> None:
    reading = Reading(
        width=100,
        height=50,
        lines=(),
        segment_seconds=0.0,
        recognize_seconds=0.0,
    )
    root = ET.fromstring(alto_of(reading))
    assert list(root.iter(f"{ALTO}TextLine")) == []
    marked = Reading(
        width=100,
        height=50,
        lines=(
            ReadLine(
                row=1,
                box=(0, 0, 100, 50),
                ink=(5, 5, 95, 45),
                words=(Word('<b a="1">&', (5, 5, 50, 45), 0.5),),
            ),
        ),
        segment_seconds=0.0,
        recognize_seconds=0.0,
    )
    string = ET.fromstring(alto_of(marked)).find(f".//{ALTO}String")
    assert string is not None
    assert string.get("CONTENT") == '<b a="1">&'


def test_a_blank_photo_is_read_as_no_line(reader: Reader) -> None:
    photo = Image.new("RGB", (900, 1200), (PAPER, PAPER, PAPER))
    reading = reader.read(photo)
    assert reading.lines == ()
    assert ET.fromstring(alto_of(reading)).find(f".//{ALTO}TextLine") is None


@dataclass
class Recorded:
    prediction: str = ""
    cuts: tuple[object, ...] = ()
    confidences: tuple[float, ...] = ()


class RecordingModel:
    def __init__(self) -> None:
        self.threads: list[int] = []

    def predict(self, im: Image.Image, segmentation: object, config: object) -> list[Recorded]:
        self.threads = [pool["num_threads"] for pool in threadpool_info()]
        return [Recorded()]


def test_the_recognizer_runs_on_one_thread_as_the_kraken_command_did(monkeypatch: pytest.MonkeyPatch) -> None:
    if (os.process_cpu_count() or 1) < 2:
        pytest.skip("one processor: the limit cannot be told apart from the machine")
    recognizer = Recognizer(os.environ["READING_MODEL"])
    model = RecordingModel()
    monkeypatch.setattr(recognizer, "_model", model)
    assert recognizer.words(Image.new("L", (300, 60), PAPER)) == []
    assert model.threads
    assert set(model.threads) == {1}
    assert any(pool["num_threads"] > 1 for pool in threadpool_info())


class SlowSegmenter:
    def __init__(self) -> None:
        self.running = 0
        self.most = 0
        self._guard = threading.Lock()

    def lines(self, photo: Image.Image) -> list[Line]:
        with self._guard:
            self.running += 1
            self.most = max(self.most, self.running)
        time.sleep(0.2)
        with self._guard:
            self.running -= 1
        return []


class NoRecognizer:
    def words(self, tile: Image.Image) -> list[TileWord]:
        return []


class SlowRecognizer:
    def __init__(self) -> None:
        self.calls = 0

    def words(self, tile: Image.Image) -> list[TileWord]:
        self.calls += 1
        time.sleep(0.1)
        return []


class FixedSegmenter:
    def __init__(self, lines: list[Line]) -> None:
        self._lines = lines

    def lines(self, photo: Image.Image) -> list[Line]:
        return self._lines


def drawn_lines(count: int) -> tuple[Image.Image, list[Line]]:
    canvas = Image.new("L", (1200, 200 + 120 * count), PAPER)
    face = font()
    fragments = []
    for index in range(count):
        top = 100 + 120 * index
        ImageDraw.Draw(canvas).text((100, top), "copper lantern", fill=INK, font=face)
        box = ImageDraw.Draw(canvas).textbbox((100, top), "copper lantern", font=face)
        base = float(top + face.getmetrics()[0])
        fragments.append(Fragment.of([(box[0], base), (box[2], base)], [(box[0], box[1]), (box[2], box[3])]))
    photo = canvas.convert("RGB")
    return photo, lines_of(photo, fragments)


def test_a_reading_that_outlasts_its_deadline_is_abandoned_between_lines() -> None:
    photo, lines = drawn_lines(4)
    assert len(lines) == 4
    recognizer = SlowRecognizer()
    reader = Reader(FixedSegmenter(lines), recognizer, deadline_seconds=0.15)
    with pytest.raises(RefusalError) as refused:
        reader.read(photo)
    assert (refused.value.status, refused.value.code) == (422, "too_complex")
    assert recognizer.calls < 4
    assert Reader(FixedSegmenter(lines), recognizer, deadline_seconds=5).read(photo).lines


def test_a_page_with_more_ink_components_than_any_page_of_notes_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    assert len(drawn_lines(2)[1]) == 2
    monkeypatch.setattr(segmentation, "MAX_COMPONENTS", 10)
    with pytest.raises(RefusalError) as refused:
        drawn_lines(2)
    assert (refused.value.status, refused.value.code) == (422, "too_complex")


def test_the_ceiling_of_ink_components_is_far_above_a_page_of_notes() -> None:
    assert segmentation.MAX_COMPONENTS >= 40_000


def test_one_page_is_read_at_a_time() -> None:
    segmenter = SlowSegmenter()
    reader = Reader(segmenter, NoRecognizer())
    photo = Image.new("RGB", (100, 100), (PAPER, PAPER, PAPER))
    threads = [threading.Thread(target=reader.read, args=(photo,)) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert segmenter.most == 1
