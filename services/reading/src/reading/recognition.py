import logging
import math
import re
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from PIL import Image
from threadpoolctl import threadpool_limits

from reading.segmentation import Line

Box = tuple[int, int, int, int]

SPACES = re.compile(r"(\s+)")
QUIET = ("kraken", "lightning", "lightning.fabric", "pytorch_lightning")


@dataclass(frozen=True)
class TileWord:
    text: str
    x0: float
    x1: float
    confidence: float


@dataclass(frozen=True)
class Word:
    text: str
    box: Box
    confidence: float


@dataclass(frozen=True)
class ReadLine:
    row: int
    box: Box
    ink: Box
    words: tuple[Word, ...]


@dataclass(frozen=True)
class Reading:
    width: int
    height: int
    lines: tuple[ReadLine, ...]
    segment_seconds: float
    recognize_seconds: float


class LineSource(Protocol):
    def lines(self, photo: Image.Image) -> list[Line]: ...


class TileReader(Protocol):
    def words(self, tile: Image.Image) -> list[TileWord]: ...


class PageReader(Protocol):
    def read(self, photo: Image.Image) -> Reading: ...


def words_of(
    prediction: str, cuts: Sequence[Sequence[Sequence[float]]], confidences: Sequence[float], width: int
) -> list[TileWord]:
    words = []
    offset = 0
    for segment in SPACES.split(prediction):
        if not segment:
            continue
        if not segment.isspace():
            own_cuts = cuts[offset : offset + len(segment)]
            own_confidences = confidences[offset : offset + len(segment)]
            if own_cuts and own_confidences:
                xs = [float(point[0]) for polygon in own_cuts for point in polygon]
                confidence = round(sum(own_confidences) / len(own_confidences), 4)
                words.append(TileWord(segment, min(xs), max(xs) + 1.0, confidence))
            else:
                words.append(TileWord(segment, 0.0, float(width), 0.0))
        offset += len(segment)
    return words


def bounded(points: Sequence[tuple[float, float]], width: int, height: int) -> Box:
    x0 = min(max(0, math.floor(min(p[0] for p in points))), width - 1)
    y0 = min(max(0, math.floor(min(p[1] for p in points))), height - 1)
    x1 = max(min(width, math.ceil(max(p[0] for p in points))), x0 + 1)
    y1 = max(min(height, math.ceil(max(p[1] for p in points))), y0 + 1)
    return (x0, y0, x1, y1)


def on_photo(line: Line, x0: float, x1: float, width: int, height: int) -> Box:
    tile_height = float(line.image.height)
    return bounded([line.to_photo(x, y) for x in (x0, x1) for y in (0.0, tile_height)], width, height)


def read_line(line: Line, words: Sequence[TileWord], width: int, height: int) -> ReadLine:
    return ReadLine(
        row=line.row,
        box=on_photo(line, 0.0, float(line.image.width), width, height),
        ink=line.box,
        words=tuple(
            Word(word.text, on_photo(line, word.x0, word.x1, width, height), word.confidence) for word in words
        ),
    )


def quiet_libraries() -> None:
    for name in QUIET:
        logging.getLogger(name).setLevel(logging.WARNING)


class Recognizer:
    def __init__(self, model_path: str) -> None:
        from kraken.configs import RecognitionInferenceConfig
        from kraken.tasks import RecognitionTaskModel

        quiet_libraries()
        self._model = RecognitionTaskModel.load_model(model_path)
        self._config = RecognitionInferenceConfig(num_line_workers=0)

    def words(self, tile: Image.Image) -> list[TileWord]:
        from kraken.containers import BBoxLine, Segmentation

        segmentation = Segmentation(
            type="bbox",
            imagename="tile",
            text_direction="horizontal-lr",
            script_detection=False,
            lines=[BBoxLine(id="tile", bbox=(0, 0, tile.width, tile.height))],
        )
        with threadpool_limits(limits=self._config.num_threads):
            records = list(self._model.predict(im=tile, segmentation=segmentation, config=self._config))
        words = []
        for record in records:
            words += words_of(record.prediction, record.cuts, record.confidences, tile.width)
        return words


class Reader:
    def __init__(self, segmenter: LineSource, recognizer: TileReader) -> None:
        quiet_libraries()
        self._segmenter = segmenter
        self._recognizer = recognizer
        self._lock = threading.Lock()

    def read(self, photo: Image.Image) -> Reading:
        with self._lock:
            started = time.perf_counter()
            lines = self._segmenter.lines(photo)
            segmented = time.perf_counter()
            read = tuple(
                read_line(line, self._recognizer.words(line.image), photo.width, photo.height) for line in lines
            )
            recognized = time.perf_counter()
        return Reading(
            width=photo.width,
            height=photo.height,
            lines=read,
            segment_seconds=segmented - started,
            recognize_seconds=recognized - segmented,
        )
