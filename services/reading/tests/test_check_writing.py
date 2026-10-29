import io
import json
import logging

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from reading.app import GATE_HEADER, create_app
from reading.arbiter import Arbitration, Outcome
from reading.recognition import Reading, ReadLine, Word
from reading.refusal import too_complex
from reading.writing_test import template_lines

SECRET = "r" * 24 + "-shared-secret-of-the-test"
JPEG = "image/jpeg"


class FakeReader:
    def __init__(self, lines: list[str] | None = None, error: Exception | None = None) -> None:
        self.lines = lines or []
        self.error = error
        self.photos: list[Image.Image] = []

    def read(self, photo: Image.Image) -> Reading:
        self.photos.append(photo)
        if self.error is not None:
            raise self.error
        return Reading(
            width=photo.width,
            height=photo.height,
            lines=tuple(
                ReadLine(
                    row=index,
                    box=(0, 0, photo.width, photo.height),
                    ink=(0, 0, photo.width, photo.height),
                    words=tuple(Word(text, (0, 0, 1, 1), 0.9) for text in line.split()),
                )
                for index, line in enumerate(self.lines)
            ),
            segment_seconds=0.0,
            recognize_seconds=0.0,
        )


class NoArbiter:
    def arbitrate(self, arbitration: Arbitration) -> Outcome:
        raise AssertionError("no arbitration while checking a writing test")


def jpeg() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (640, 480), 200).save(out, format="JPEG")
    return out.getvalue()


def client_of(reader: FakeReader) -> TestClient:
    return TestClient(create_app(SECRET, reader, NoArbiter()))


def post(
    client: TestClient,
    content: bytes,
    query: str = "template=fr&sheet=1",
    content_type: str | None = JPEG,
    secret: str | None = SECRET,
) -> tuple[int, str]:
    sent: dict[str, str] = {}
    if secret is not None:
        sent[GATE_HEADER] = secret
    if content_type is not None:
        sent["Content-Type"] = content_type
    response = client.post(f"/check-writing?{query}" if query else "/check-writing", content=content, headers=sent)
    return response.status_code, response.text


def test_a_sheet_is_read_and_only_numbers_come_back() -> None:
    reader = FakeReader(list(template_lines("fr"))[:20])
    status, text = post(client_of(reader), jpeg())
    assert status == 200
    assert json.loads(text) == {"template": "fr", "sheet": 1, "lines": 20, "training": 20, "validation": 0}
    assert len(reader.photos) == 1
    assert reader.photos[0].mode == "RGB"


def test_the_second_sheet_counts_its_training_and_validation_lines() -> None:
    reader = FakeReader(list(template_lines("en"))[20:])
    status, text = post(client_of(reader), jpeg(), query="template=en&sheet=2")
    assert status == 200
    assert json.loads(text) == {"template": "en", "sheet": 2, "lines": 20, "training": 10, "validation": 10}


def test_a_page_that_is_not_the_text_keeps_no_line() -> None:
    reader = FakeReader(["completely different words here"] * 20)
    status, text = post(client_of(reader), jpeg())
    assert status == 200
    assert json.loads(text) == {"template": "fr", "sheet": 1, "lines": 20, "training": 0, "validation": 0}


def test_the_route_refuses_a_call_without_the_secret() -> None:
    reader = FakeReader()
    status, _ = post(client_of(reader), jpeg(), secret=None)
    assert status == 401
    status, _ = post(client_of(reader), jpeg(), secret=SECRET[::-1])
    assert status == 401
    assert reader.photos == []


@pytest.mark.parametrize(
    "query",
    [
        "",
        "template=fr",
        "sheet=1",
        "template=de&sheet=1",
        "template=fr&sheet=3",
        "template=fr&sheet=0",
        "template=fr&sheet=1&extra=1",
        "sheet=1&template=fr",
        "template=fr&sheet=01",
        "template=FR&sheet=1",
        "template=fr&sheet=1&sheet=2",
    ],
)
def test_a_malformed_query_is_refused_before_any_reading(query: str) -> None:
    reader = FakeReader()
    status, text = post(client_of(reader), jpeg(), query=query)
    assert status == 400
    assert json.loads(text) == {"error": "invalid_request"}
    assert reader.photos == []


def test_a_body_that_is_not_a_jpeg_is_refused() -> None:
    reader = FakeReader()
    status, text = post(client_of(reader), b"%PDF-1.7 not a photo")
    assert status == 415
    assert json.loads(text) == {"error": "unsupported_media_type"}
    status, _ = post(client_of(reader), jpeg(), content_type="image/png")
    assert status == 415
    assert reader.photos == []


def test_a_photo_above_the_bound_is_refused() -> None:
    status, text = post(client_of(FakeReader()), b"\xff\xd8\xff" + b"0" * (10 * 1024 * 1024))
    assert status == 413
    assert json.loads(text) == {"error": "too_large"}


def test_a_sheet_that_is_too_complex_answers_so() -> None:
    reader = FakeReader(error=too_complex())
    status, text = post(client_of(reader), jpeg())
    assert status == 422
    assert json.loads(text) == {"error": "too_complex"}


def test_a_reading_that_fails_answers_reading_failed() -> None:
    status, text = post(client_of(FakeReader(error=RuntimeError("PROBE-secret-detail"))), jpeg())
    assert status == 500
    assert json.loads(text) == {"error": "reading_failed"}
    assert "PROBE" not in text


def test_no_text_is_ever_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    lines = list(template_lines("fr"))[:20]
    status, text = post(client_of(FakeReader(lines)), jpeg())
    assert status == 200
    logged = "\n".join(
        f"{record.name} {record.getMessage()} {record.exc_text or ''}"
        for record in caplog.records
        if not record.name.startswith("httpx")
    )
    assert "checked template=fr sheet=1 lines=20 training=20 validation=0" in logged
    for word in ("pommes", "poires", "Zürich", "Quelle", "veste"):
        assert word not in logged + text
