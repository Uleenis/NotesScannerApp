import io
import json
import logging
import os
import re
import threading
import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from reading.app import GATE_HEADER, create_app
from reading.arbiter import Arbitration, Outcome
from reading.photo import MAX_BYTES
from reading.recognition import Reader, Reading, ReadLine, Recognizer, TileReader, TileWord, Word
from reading.refusal import too_complex
from reading.segmentation import Segmenter

SECRET = "r" * 24 + "-shared-secret-of-the-test"
PAGE = "0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f"
USER = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
MODEL = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
QUERY = f"page_id={PAGE}&user_id={USER}"
PROBE = "PROBE-b1-text-that-must-never-come-back"
JPEG = "image/jpeg"

FIXED = Reading(
    width=640,
    height=480,
    lines=(
        ReadLine(
            row=1,
            box=(10, 20, 600, 90),
            ink=(15, 30, 590, 80),
            words=(Word("lantern", (15, 20, 200, 90), 0.9876), Word("meadow", (220, 20, 400, 90), 0.5)),
        ),
    ),
    segment_seconds=1.5,
    recognize_seconds=0.5,
)


class FakeReader:
    def __init__(self, reading: Reading = FIXED, error: Exception | None = None) -> None:
        self.reading = reading
        self.error = error
        self.photos: list[Image.Image] = []
        self.recognizers: list[TileReader | None] = []

    def read(self, photo: Image.Image, recognizer: TileReader | None = None) -> Reading:
        self.photos.append(photo)
        self.recognizers.append(recognizer)
        if self.error is not None:
            raise self.error
        return self.reading


def jpeg(size: tuple[int, int] = (640, 480), mode: str = "RGB", **options: object) -> bytes:
    out = io.BytesIO()
    Image.new(mode, size, 200).save(out, format="JPEG", **options)
    return out.getvalue()


def png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 200, 200)).save(out, format="PNG")
    return out.getvalue()


def served(caplog: pytest.LogCaptureFixture) -> str:
    return "\n".join(
        f"{record.name} {record.getMessage()} {record.exc_text or ''}"
        for record in caplog.records
        if not record.name.startswith("httpx")
    )


class NoArbiter:
    def arbitrate(self, arbitration: Arbitration) -> Outcome:
        raise AssertionError("no arbitration while reading")


class Personal:
    def words(self, tile: Image.Image) -> list[TileWord]:
        return []


class FakeModels:
    def __init__(self, chosen: tuple[TileReader | None, str | None] = (None, None)) -> None:
        self.chosen = chosen
        self.asked: list[tuple[str, str]] = []

    def for_user(self, user_id: str, page_id: str) -> tuple[TileReader | None, str | None]:
        self.asked.append((user_id, page_id))
        return self.chosen


def client_of(reader: FakeReader, models: FakeModels | None = None) -> TestClient:
    return TestClient(create_app(SECRET, reader, NoArbiter(), models or FakeModels()))


def post(
    client: TestClient,
    content: bytes,
    query: str = QUERY,
    content_type: str | None = JPEG,
    headers: dict[str, str] | None = None,
) -> tuple[int, str]:
    sent = {GATE_HEADER: SECRET, **(headers or {})}
    if content_type is not None:
        sent["Content-Type"] = content_type
    response = client.post(f"/recognize?{query}" if query else "/recognize", content=content, headers=sent)
    return response.status_code, response.text


def test_a_photo_is_read_into_lines_words_boxes_confidences_and_alto() -> None:
    reader = FakeReader()
    status, text = post(client_of(reader), jpeg())
    assert status == 200
    body = json.loads(text)
    assert body["page_id"] == PAGE
    assert (body["width"], body["height"]) == (640, 480)
    assert body["lines"] == [
        {
            "row": 1,
            "box": [10, 20, 600, 90],
            "ink": [15, 30, 590, 80],
            "words": [
                {"text": "lantern", "box": [15, 20, 200, 90], "confidence": 0.9876},
                {"text": "meadow", "box": [220, 20, 400, 90], "confidence": 0.5},
            ],
        }
    ]
    assert body["alto"].lstrip().startswith("<?xml")
    assert 'CONTENT="lantern"' in body["alto"]
    assert set(body) == {"page_id", "width", "height", "lines", "alto", "model_id"}
    assert body["model_id"] is None
    assert len(reader.photos) == 1
    assert reader.photos[0].mode == "RGB"
    assert reader.photos[0].size == (640, 480)


def test_a_page_is_read_by_the_model_chosen_for_its_owner_and_names_it() -> None:
    reader = FakeReader()
    personal = Personal()
    models = FakeModels((personal, MODEL))
    status, text = post(client_of(reader, models), jpeg())
    assert status == 200
    assert json.loads(text)["model_id"] == MODEL
    assert models.asked == [(USER, PAGE)]
    assert reader.recognizers == [personal]


def test_a_page_read_by_the_generic_names_no_model() -> None:
    reader = FakeReader()
    status, text = post(client_of(reader, FakeModels()), jpeg())
    assert status == 200
    assert json.loads(text)["model_id"] is None
    assert reader.recognizers == [None]


def test_a_reading_by_a_personal_model_says_so_in_its_log(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    post(client_of(FakeReader(), FakeModels((Personal(), MODEL))), jpeg())
    text = served(caplog)
    assert f"recognized page={PAGE} model=personal " in text
    assert USER not in text
    assert MODEL not in text


def test_a_refused_request_never_chooses_a_model() -> None:
    models = FakeModels((Personal(), MODEL))
    status, _ = post(client_of(FakeReader(), models), png())
    assert status == 415
    assert models.asked == []


def test_a_grey_photo_is_read_in_colour() -> None:
    reader = FakeReader()
    status, _ = post(client_of(reader), jpeg(mode="L"))
    assert status == 200
    assert reader.photos[0].mode == "RGB"


def test_the_photo_is_read_upright_as_its_orientation_tag_says() -> None:
    reader = FakeReader()
    exif = Image.Exif()
    exif[0x0112] = 6
    status, _ = post(client_of(reader), jpeg(size=(640, 480), exif=exif.tobytes()))
    assert status == 200
    assert reader.photos[0].size == (480, 640)


REFUSALS = [
    pytest.param(jpeg(), f"page_id={PAGE}&b1={PROBE}", JPEG, 400, "invalid_request", id="b1 beside the photo"),
    pytest.param(jpeg(), f"page_id={PAGE}&text={PROBE}", JPEG, 400, "invalid_request", id="any other field"),
    pytest.param(jpeg(), f"page_id={PAGE}&page_id={PAGE}", JPEG, 400, "invalid_request", id="page sent twice"),
    pytest.param(jpeg(), "", JPEG, 400, "invalid_request", id="no page"),
    pytest.param(jpeg(), f"page_id={PROBE}", JPEG, 400, "invalid_request", id="page not an identifier"),
    pytest.param(jpeg(), f"page_id={PAGE.upper()}", JPEG, 400, "invalid_request", id="page in capitals"),
    pytest.param(jpeg(), f"page_id={PAGE}&", JPEG, 400, "invalid_request", id="empty field"),
    pytest.param(jpeg(), f"page_id={PAGE}", JPEG, 400, "invalid_request", id="no user"),
    pytest.param(jpeg(), f"user_id={USER}&page_id={PAGE}", JPEG, 400, "invalid_request", id="fields swapped"),
    pytest.param(jpeg(), f"page_id={PAGE}&user_id={PROBE}", JPEG, 400, "invalid_request", id="user not an identifier"),
    pytest.param(jpeg(), f"{QUERY}&user_id={USER}", JPEG, 400, "invalid_request", id="user sent twice"),
    pytest.param(
        json.dumps({"page_id": PAGE, "b1": PROBE}).encode(),
        QUERY,
        "application/json",
        415,
        "unsupported_media_type",
        id="b1 in a json body",
    ),
    pytest.param(
        f'--x\r\nContent-Disposition: form-data; name="b1"\r\n\r\n{PROBE}\r\n--x--\r\n'.encode(),
        QUERY,
        "multipart/form-data; boundary=x",
        415,
        "unsupported_media_type",
        id="b1 in a form",
    ),
    pytest.param(jpeg(), QUERY, None, 415, "unsupported_media_type", id="no content type"),
    pytest.param(jpeg(), QUERY, "image/jpeg; b1=x", 415, "unsupported_media_type", id="typed with more"),
    pytest.param(png(), QUERY, JPEG, 415, "unsupported_media_type", id="a png called a jpeg"),
    pytest.param(PROBE.encode(), QUERY, JPEG, 415, "unsupported_media_type", id="text called a jpeg"),
    pytest.param(b"", QUERY, JPEG, 415, "unsupported_media_type", id="empty body"),
    pytest.param(jpeg()[:600] + PROBE.encode(), QUERY, JPEG, 400, "invalid_photo", id="broken jpeg"),
    pytest.param(b"\xff\xd8\xff" + bytes(MAX_BYTES), QUERY, JPEG, 413, "too_large", id="more than 10 mb"),
    pytest.param(jpeg(size=(4000, 3001)), QUERY, JPEG, 413, "too_large", id="more than 12 mpx"),
    pytest.param(jpeg(size=(8001, 16)), QUERY, JPEG, 413, "too_large", id="too wide"),
    pytest.param(jpeg(size=(16, 8001)), QUERY, JPEG, 413, "too_large", id="too tall"),
]


@pytest.mark.parametrize(("content", "query", "content_type", "status", "code"), REFUSALS)
def test_an_invalid_request_is_refused_without_its_content_coming_back(
    content: bytes,
    query: str,
    content_type: str | None,
    status: int,
    code: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    reader = FakeReader()
    got, text = post(client_of(reader), content, query, content_type)
    assert (got, json.loads(text)) == (status, {"error": code})
    assert reader.photos == []
    assert PROBE not in served(caplog)
    assert code in served(caplog)


def test_the_largest_photo_the_app_sends_is_read() -> None:
    reader = FakeReader()
    status, _ = post(client_of(reader), jpeg(size=(3000, 4000)))
    assert status == 200


def test_a_body_announced_too_long_is_refused_before_it_is_read() -> None:
    reader = FakeReader()
    status, text = post(client_of(reader), jpeg(), headers={"Content-Length": str(MAX_BYTES + 1)})
    assert (status, json.loads(text)) == (413, {"error": "too_large"})


def test_a_body_streamed_past_the_limit_without_a_length_is_refused() -> None:
    reader = FakeReader()

    def chunks() -> Iterator[bytes]:
        yield b"\xff\xd8\xff"
        for _ in range(11):
            yield bytes(1024 * 1024)

    response = client_of(reader).post(
        f"/recognize?{QUERY}", content=chunks(), headers={GATE_HEADER: SECRET, "Content-Type": JPEG}
    )
    assert "content-length" not in {name.lower() for name in response.request.headers}
    assert (response.status_code, response.json()) == (413, {"error": "too_large"})
    assert reader.photos == []


def test_a_progressive_photo_is_read() -> None:
    reader = FakeReader()
    status, _ = post(client_of(reader), jpeg(progressive=True, quality=90))
    assert status == 200
    assert len(reader.photos) == 1


def last_scan(data: bytes) -> bytes:
    start = data.rindex(b"\xff\xda")
    assert data.endswith(b"\xff\xd9")
    return data[start:-2]


def test_a_photo_made_of_endless_scans_is_refused_before_it_is_decoded() -> None:
    reader = FakeReader()
    photo = jpeg(size=(3000, 4000), progressive=True)
    crafted = photo[:-2] + last_scan(photo) * 20_000 + b"\xff\xd9"
    assert len(crafted) < MAX_BYTES
    started = time.perf_counter()
    status, text = post(client_of(reader), crafted)
    assert time.perf_counter() - started < 2
    assert (status, json.loads(text)) == (400, {"error": "invalid_photo"})
    assert reader.photos == []


def test_scans_hidden_behind_a_marker_no_photo_carries_are_refused() -> None:
    reader = FakeReader()
    photo = jpeg(progressive=True)
    hidden = last_scan(photo) * 4
    assert len(hidden) < 60_000
    for marker in (b"\x00", b"\x01", b"\xd0", b"\xd8", b"\xc8", b"\xcc", b"\xdc", b"\xf0", b"\x02", b"\xbf"):
        crafted = (
            photo[:-2]
            + b"\xff\xfe\x00\x06note"
            + b"\xff"
            + marker
            + (len(hidden) + 2).to_bytes(2, "big")
            + hidden
            + b"\xff\xd9"
        )
        status, text = post(client_of(reader), crafted)
        assert (status, json.loads(text)) == (400, {"error": "invalid_photo"}), marker
    assert reader.photos == []


def test_a_photo_coded_otherwise_than_the_app_codes_it_is_refused() -> None:
    reader = FakeReader()
    photo = jpeg()
    frame = photo.index(b"\xff\xc0")
    for kind in (b"\xc3", b"\xc9", b"\xcb"):
        crafted = photo[:frame] + b"\xff" + kind + photo[frame + 2 :]
        status, text = post(client_of(reader), crafted)
        assert (status, json.loads(text)) == (400, {"error": "invalid_photo"})
    status, text = post(client_of(reader), photo[:-2])
    assert (status, json.loads(text)) == (400, {"error": "invalid_photo"})
    assert reader.photos == []


def test_a_page_too_complex_to_read_answers_a_fixed_error() -> None:
    reader = FakeReader(error=too_complex())
    status, text = post(client_of(reader), jpeg())
    assert (status, json.loads(text)) == (422, {"error": "too_complex"})


class BlockingReader:
    def __init__(self) -> None:
        self.entered = threading.Semaphore(0)
        self.release = threading.Event()

    def read(self, photo: Image.Image, recognizer: TileReader | None = None) -> Reading:
        self.entered.release()
        self.release.wait(timeout=30)
        return FIXED


def test_requests_beyond_those_in_flight_are_turned_away() -> None:
    reader = BlockingReader()
    statuses: list[int] = []
    with TestClient(create_app(SECRET, reader, NoArbiter(), FakeModels(), max_in_flight=2)) as client:

        def call() -> None:
            statuses.append(post(client, jpeg())[0])

        waiting = [threading.Thread(target=call) for _ in range(2)]
        for thread in waiting:
            thread.start()
        for _ in waiting:
            assert reader.entered.acquire(timeout=30)
        status, text = post(client, jpeg())
        reader.release.set()
        for thread in waiting:
            thread.join()
        assert (status, json.loads(text)) == (503, {"error": "busy"})
        assert statuses == [200, 200]
        assert post(client, jpeg())[0] == 200


def test_a_failed_reading_answers_a_fixed_error_and_logs_only_a_code(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    reader = FakeReader(error=RuntimeError(PROBE))
    status, text = post(client_of(reader), jpeg())
    assert (status, json.loads(text)) == (500, {"error": "reading_failed"})
    assert PROBE not in text
    assert PROBE not in served(caplog)
    assert "reading_failed" in served(caplog)
    assert PAGE in served(caplog)


LOGGED = re.compile(
    rf"recognized page={PAGE} model=generic lines=\d+ words=\d+ segment_seconds=\d+\.\d\d "
    rf"recognize_seconds=\d+\.\d\d total_seconds=\d+\.\d\d"
)


def test_a_reading_logs_the_page_its_durations_and_counts_and_no_text(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    status, _ = post(client_of(FakeReader()), jpeg())
    assert status == 200
    messages = [record.getMessage() for record in caplog.records if record.name.startswith("reading")]
    assert len(messages) == 1
    assert LOGGED.fullmatch(messages[0])
    assert "lines=1 words=2" in messages[0]
    assert "lantern" not in served(caplog)
    assert "meadow" not in served(caplog)


@pytest.fixture(scope="module")
def reader() -> Reader:
    return Reader(Segmenter(), Recognizer(os.environ["READING_MODEL"]))


def written_page() -> bytes:
    face = ImageFont.load_default(size=60)
    canvas = Image.new("L", (1400, 700), 250)
    draw = ImageDraw.Draw(canvas)
    draw.text((120, 150), "copper lantern meadow", fill=20, font=face)
    draw.text((120, 400), "harbor pebble summit", fill=20, font=face)
    out = io.BytesIO()
    canvas.convert("RGB").save(out, format="JPEG", quality=92)
    return out.getvalue()


def test_a_real_reading_logs_neither_text_nor_image(
    reader: Reader, caplog: pytest.LogCaptureFixture, capfd: pytest.CaptureFixture[str]
) -> None:
    caplog.set_level(logging.DEBUG)
    client = TestClient(create_app(SECRET, reader, NoArbiter(), FakeModels()))
    photo = written_page()
    response = client.post(f"/recognize?{QUERY}", content=photo, headers={GATE_HEADER: SECRET, "Content-Type": JPEG})
    assert response.status_code == 200
    body = response.json()
    words = [word["text"] for line in body["lines"] for word in line["words"]]
    assert len(body["lines"]) == 2
    assert len(words) >= 4
    out, err = capfd.readouterr()
    logged = served(caplog) + out + err
    for word in words:
        if len(word) >= 4:
            assert word not in logged
    assert "<alto" not in logged
    assert "CONTENT=" not in logged
    assert "JFIF" not in logged
    reading_messages = [record.getMessage() for record in caplog.records if record.name.startswith("reading")]
    assert len(reading_messages) == 1
    assert LOGGED.fullmatch(reading_messages[0])
