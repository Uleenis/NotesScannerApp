import copy
import json
import logging
import threading
from typing import Any

import pytest
from fastapi.testclient import TestClient

from reading.alto import alto_of
from reading.app import GATE_HEADER, MAX_ARBITRATION_BYTES, answer, create_app
from reading.arbiter import Arbitration, ArbitrationError, Outcome
from reading.recognition import Reading, ReadLine, TileReader, Word
from reading.refusal import too_complex

SECRET = "a" * 24 + "-shared-secret-of-the-test"
USER = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
MODEL = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
PAGE = "0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f"
PROBE = "PROBE-text-that-must-never-come-back"
JSON = "application/json"

READING = Reading(
    width=640,
    height=480,
    lines=(
        ReadLine(
            row=1,
            box=(10, 20, 600, 90),
            ink=(15, 30, 590, 80),
            words=(Word("lantern", (15, 20, 200, 90), 0.9876), Word("meadow", (220, 20, 400, 90), 0.5)),
        ),
        ReadLine(row=3, box=(10, 120, 600, 190), ink=(15, 130, 590, 180), words=()),
    ),
    segment_seconds=0.0,
    recognize_seconds=0.0,
)


class EmptyReader:
    def read(self, photo: object, recognizer: TileReader | None = None) -> Reading:
        return READING


class GenericOnly:
    def for_user(self, user_id: str, page_id: str) -> tuple[TileReader | None, str | None]:
        return None, None


class FakeArbiter:
    def __init__(self, outcome: Outcome | None = None, error: Exception | None = None) -> None:
        self.outcome = outcome or Outcome("recorded", 3)
        self.error = error
        self.received: list[Arbitration] = []
        self.entered = threading.Semaphore(0)
        self.release: threading.Event | None = None

    def arbitrate(self, arbitration: Arbitration) -> Outcome:
        self.received.append(arbitration)
        self.entered.release()
        if self.release is not None:
            self.release.wait(timeout=30)
        if self.error is not None:
            raise self.error
        return self.outcome


def body(**changes: Any) -> dict[str, Any]:
    sent: dict[str, Any] = {
        "page_id": PAGE,
        "user_id": USER,
        "b1": "lantern meadows\nsummit",
        "a": answer(PAGE, READING, alto_of(READING), None),
        "duration_ms": 28000,
    }
    sent.update(changes)
    return sent


def post(
    client: TestClient,
    sent: object,
    content_type: str | None = JSON,
    headers: dict[str, str] | None = None,
) -> tuple[int, Any]:
    content = sent if isinstance(sent, bytes) else json.dumps(sent).encode()
    all_headers = {GATE_HEADER: SECRET, **(headers or {})}
    if content_type is not None:
        all_headers["Content-Type"] = content_type
    response = client.post("/arbitrate", content=content, headers=all_headers)
    return response.status_code, response.json()


def client_of(arbiter: FakeArbiter, max_in_flight: int = 4) -> TestClient:
    return TestClient(create_app(SECRET, EmptyReader(), arbiter, GenericOnly(), max_in_flight=max_in_flight))


def served(caplog: pytest.LogCaptureFixture) -> str:
    return "\n".join(
        f"{record.name} {record.getMessage()} {record.exc_text or ''}"
        for record in caplog.records
        if not record.name.startswith("httpx")
    )


def test_a_and_b1_of_a_page_are_arbitrated() -> None:
    arbiter = FakeArbiter()
    status, answered = post(client_of(arbiter), body())
    assert (status, answered) == (200, {"page_id": PAGE, "outcome": "recorded", "tokens": 3})
    [received] = arbiter.received
    assert received == Arbitration(
        page_id=PAGE, user_id=USER, b1="lantern meadows\nsummit", reading=READING, duration_ms=28000
    )


def test_the_model_that_read_a_is_handed_over() -> None:
    arbiter = FakeArbiter()
    status, _ = post(client_of(arbiter), body(a=answer(PAGE, READING, alto_of(READING), MODEL)))
    assert status == 200
    assert [received.model_id for received in arbiter.received] == [MODEL]


def test_a_read_by_the_generic_is_handed_over_without_a_model() -> None:
    arbiter = FakeArbiter()
    assert post(client_of(arbiter), body())[0] == 200
    assert [received.model_id for received in arbiter.received] == [None]


def test_b2_is_handed_over_when_it_came_and_left_empty_when_it_did_not() -> None:
    arbiter = FakeArbiter()
    client = client_of(arbiter)
    assert post(client, body(b2="lantern meadow summit"))[0] == 200
    assert post(client, body(b2=None))[0] == 200
    assert post(client, body())[0] == 200
    assert [received.b2 for received in arbiter.received] == ["lantern meadow summit", None, None]


@pytest.mark.parametrize("reason", ["page_not_found", "not_text", "already_read", "model_not_found"])
def test_a_refused_write_answers_its_reason(reason: str) -> None:
    status, answered = post(client_of(FakeArbiter(Outcome(reason, 0))), body())
    assert (status, answered) == (409, {"error": reason})


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        pytest.param(ArbitrationError(), 500, "arbitration_failed", id="store failure"),
        pytest.param(RuntimeError(PROBE), 500, "arbitration_failed", id="unexpected"),
        pytest.param(too_complex(), 422, "too_complex", id="too long to align"),
    ],
)
def test_a_failure_answers_a_fixed_error(
    error: Exception, status: int, code: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    got, answered = post(client_of(FakeArbiter(error=error)), body())
    assert (got, answered) == (status, {"error": code})
    assert PROBE not in served(caplog)
    assert code in served(caplog)


def changed_a(change: str) -> dict[str, Any]:
    a: dict[str, Any] = copy.deepcopy(body()["a"])
    line = a["lines"][0]
    word = line["words"][0]
    if change == "extra field":
        a["b1"] = PROBE
    elif change == "other page":
        a["page_id"] = USER
    elif change == "word outside the photo":
        word["box"] = [15, 20, 700, 90]
    elif change == "empty box":
        word["box"] = [200, 20, 200, 90]
    elif change == "box of three":
        word["box"] = [15, 20, 200]
    elif change == "negative box":
        line["box"] = [-1, 20, 600, 90]
    elif change == "box of floats":
        line["ink"] = [15.5, 30, 590, 80]
    elif change == "word with a space":
        word["text"] = f"lan {PROBE}"
    elif change == "empty word":
        word["text"] = ""
    elif change == "confidence above one":
        word["confidence"] = 1.5
    elif change == "rows out of order":
        a["lines"][1]["row"] = 1
    elif change == "alto of another reading":
        a["alto"] = a["alto"].replace("lantern", PROBE)
    elif change == "no alto":
        del a["alto"]
    elif change == "no lines":
        del a["lines"]
    elif change == "no model":
        del a["model_id"]
    elif change == "model not an identifier":
        a["model_id"] = "medium"
    elif change == "model in capitals":
        a["model_id"] = MODEL.upper()
    return a


INVALID = [
    pytest.param(body(b2=[PROBE]), id="b2 not text"),
    pytest.param(body(b2=PROBE * 20_000), id="b2 above the bound"),
    pytest.param(body(b3=PROBE), id="a third reading"),
    pytest.param(body(page_texts=PROBE), id="any other field"),
    pytest.param({k: v for k, v in body().items() if k != "b1"}, id="no b1"),
    pytest.param({k: v for k, v in body().items() if k != "user_id"}, id="no owner"),
    pytest.param(body(b1=[PROBE]), id="b1 not text"),
    pytest.param(body(page_id=PAGE.upper()), id="page in capitals"),
    pytest.param(body(page_id=PROBE), id="page not an identifier"),
    pytest.param(body(user_id=PROBE), id="owner not an identifier"),
    pytest.param(body(duration_ms=-1), id="negative duration"),
    pytest.param(body(duration_ms="28000"), id="duration as text"),
    pytest.param(body(duration_ms=True), id="duration as boolean"),
    pytest.param(body(duration_ms=2.5), id="duration as float"),
    *[
        pytest.param(body(a=changed_a(change)), id=change)
        for change in [
            "extra field",
            "other page",
            "word outside the photo",
            "empty box",
            "box of three",
            "negative box",
            "box of floats",
            "word with a space",
            "empty word",
            "confidence above one",
            "rows out of order",
            "alto of another reading",
            "no alto",
            "no lines",
            "no model",
            "model not an identifier",
            "model in capitals",
        ]
    ],
    pytest.param(PROBE.encode(), id="not json"),
    pytest.param(json.dumps([body()]).encode(), id="a list"),
]


@pytest.mark.parametrize("sent", INVALID)
def test_an_invalid_request_is_refused_without_its_content_coming_back(
    sent: object, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    arbiter = FakeArbiter()
    status, answered = post(client_of(arbiter), sent)
    assert (status, answered) == (400, {"error": "invalid_request"})
    assert arbiter.received == []
    assert PROBE not in served(caplog)


def test_a_query_beside_the_body_is_refused() -> None:
    arbiter = FakeArbiter()
    response = client_of(arbiter).post(
        f"/arbitrate?b1={PROBE}",
        content=json.dumps(body()).encode(),
        headers={GATE_HEADER: SECRET, "Content-Type": JSON},
    )
    assert (response.status_code, response.json()) == (400, {"error": "invalid_request"})
    assert arbiter.received == []


@pytest.mark.parametrize(
    "content_type",
    [
        pytest.param(None, id="no content type"),
        pytest.param("text/plain", id="text"),
        pytest.param("application/json; charset=utf-8", id="typed with more"),
        pytest.param("image/jpeg", id="a photo"),
    ],
)
def test_a_body_that_is_not_json_is_refused(content_type: str | None) -> None:
    arbiter = FakeArbiter()
    status, answered = post(client_of(arbiter), body(), content_type=content_type)
    assert (status, answered) == (415, {"error": "unsupported_media_type"})
    assert arbiter.received == []


def test_a_body_too_large_is_refused() -> None:
    arbiter = FakeArbiter()
    status, answered = post(client_of(arbiter), body(b1="x" * MAX_ARBITRATION_BYTES))
    assert (status, answered) == (413, {"error": "too_large"})
    assert arbiter.received == []


def test_a_body_announced_too_long_is_refused_before_it_is_read() -> None:
    status, answered = post(
        client_of(FakeArbiter()), body(), headers={"Content-Length": str(MAX_ARBITRATION_BYTES + 1)}
    )
    assert (status, answered) == (413, {"error": "too_large"})


def test_an_arbitration_logs_the_page_and_its_outcome_and_no_text(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    status, _ = post(client_of(FakeArbiter()), body(b1=PROBE))
    assert status == 200
    text = served(caplog)
    assert PROBE not in text
    assert "lantern" not in text
    assert USER not in text


def test_requests_beyond_those_in_flight_are_turned_away() -> None:
    arbiter = FakeArbiter()
    arbiter.release = threading.Event()
    statuses: list[int] = []
    with client_of(arbiter, max_in_flight=1) as client:

        def call() -> None:
            statuses.append(post(client, body())[0])

        waiting = threading.Thread(target=call)
        waiting.start()
        assert arbiter.entered.acquire(timeout=30)
        status, answered = post(client, body())
        arbiter.release.set()
        waiting.join()
        assert (status, answered) == (503, {"error": "busy"})
        assert statuses == [200]
        assert post(client, body())[0] == 200
