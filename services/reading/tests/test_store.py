import json
from collections.abc import Callable
from decimal import Decimal

import httpx2
import pytest

from reading.arbiter import Arbiter, Arbitration
from reading.arbitration import Model, Position
from reading.language import Lingua
from reading.recognition import Reading, ReadLine, Word
from reading.store import ReadingA, StoreError, SupabaseStore

URL = "https://supabase.test"
KEY = "k" * 40 + "-service-key-of-the-test"
USER = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
PAGE = "0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f"
PATH = f"{USER}/{PAGE}/a-0123456789abcdef0123456789abcdef.xml"

Handler = Callable[[httpx2.Request], httpx2.Response]


class Recorder:
    def __init__(self, handler: Handler) -> None:
        self.handler = handler
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return self.handler(request)


def store_of(handler: Handler) -> tuple[SupabaseStore, Recorder]:
    recorder = Recorder(handler)
    return SupabaseStore(URL, KEY, transport=httpx2.MockTransport(recorder)), recorder


def answer(status: int, body: object = None) -> Handler:
    return lambda _: httpx2.Response(status, json=body)


def failing(error: type[httpx2.TransportError]) -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise error("down", request=request)

    return handler


WRITE = ReadingA(
    page_id=PAGE,
    user_id=USER,
    raw_text="Le chut\ndort",
    model="medium",
    model_version="1",
    duration_ms=28000,
    alto_path=PATH,
    language="fr",
    tokens=[
        Position(0, 0, "Le", None, None, "Le", "Le", "word", (12, 10, 60, 60)),
        Position(1, 1, "dort", None, None, None, "dort", None, None),
    ],
)


def test_every_call_carries_the_service_key() -> None:
    store, recorder = store_of(answer(200, []))
    store.models(USER)
    sent = recorder.requests[0]
    assert sent.headers["apikey"] == KEY
    assert sent.headers["authorization"] == f"Bearer {KEY}"


def test_the_models_of_the_user_are_read_with_their_status_and_measure() -> None:
    store, recorder = store_of(answer(200, [{"status": "active", "cer": 0.129}, {"status": "retired", "cer": None}]))
    assert store.models(USER) == [Model("active", Decimal("0.129")), Model("retired", None)]
    sent = recorder.requests[0]
    assert sent.method == "GET"
    assert sent.url.path == "/rest/v1/htr_models"
    assert dict(sent.url.params) == {"select": "status,cer", "user_id": f"eq.{USER}"}


def test_the_alto_is_uploaded_as_xml_without_overwriting() -> None:
    store, recorder = store_of(answer(200, {"Key": f"alto/{PATH}"}))
    store.upload_alto(PATH, b"<alto/>")
    sent = recorder.requests[0]
    assert sent.method == "POST"
    assert sent.url.path == f"/storage/v1/object/alto/{PATH}"
    assert sent.headers["content-type"] == "application/xml"
    assert sent.headers["x-upsert"] == "false"
    assert sent.content == b"<alto/>"


def test_reading_a_is_written_by_the_server_function_in_one_call() -> None:
    store, recorder = store_of(answer(200, [{"recorded": True, "reason": "recorded"}]))
    assert store.record(WRITE) == "recorded"
    sent = recorder.requests[0]
    assert sent.method == "POST"
    assert sent.url.path == "/rest/v1/rpc/record_reading_a"
    assert json.loads(sent.content) == {
        "p_page_id": PAGE,
        "p_user_id": USER,
        "p_raw_text": "Le chut\ndort",
        "p_model": "medium",
        "p_model_version": "1",
        "p_duration_ms": 28000,
        "p_alto_path": PATH,
        "p_language": "fr",
        "p_tokens": [
            {
                "token_index": 0,
                "line_index": 0,
                "text": "Le",
                "rule": None,
                "channel": None,
                "reading_a": "Le",
                "reading_b1": "Le",
                "anchor_kind": "word",
                "anchor": [12, 10, 60, 60],
            },
            {
                "token_index": 1,
                "line_index": 1,
                "text": "dort",
                "rule": None,
                "channel": None,
                "reading_a": None,
                "reading_b1": "dort",
                "anchor_kind": None,
                "anchor": None,
            },
        ],
    }


@pytest.mark.parametrize("reason", ["page_not_found", "not_text", "already_read"])
def test_a_refusal_of_the_server_function_is_returned(reason: str) -> None:
    store, _ = store_of(answer(200, [{"recorded": False, "reason": reason}]))
    assert store.record(WRITE) == reason


@pytest.mark.parametrize(
    "body",
    [
        pytest.param([], id="no row"),
        pytest.param([{"recorded": True, "reason": "page_not_found"}], id="recorded with a refusal"),
        pytest.param([{"recorded": False, "reason": "unknown"}], id="unknown reason"),
        pytest.param({"recorded": True}, id="not a list"),
    ],
)
def test_an_answer_of_another_shape_is_an_unsettled_failure(body: object) -> None:
    store, _ = store_of(answer(200, body))
    with pytest.raises(StoreError) as failed:
        store.record(WRITE)
    assert failed.value.settled is False


def test_the_alto_is_removed_by_its_path() -> None:
    store, recorder = store_of(answer(200, [{"name": PATH}]))
    store.remove_alto(PATH)
    sent = recorder.requests[0]
    assert sent.method == "DELETE"
    assert sent.url.path == "/storage/v1/object/alto"
    assert json.loads(sent.content) == {"prefixes": [PATH]}


CALLS: list[Callable[[SupabaseStore], object]] = [
    lambda store: store.models(USER),
    lambda store: store.upload_alto(PATH, b"<alto/>"),
    lambda store: store.record(WRITE),
    lambda store: store.remove_alto(PATH),
]


@pytest.mark.parametrize("call", CALLS)
@pytest.mark.parametrize(
    ("handler", "settled"),
    [
        pytest.param(answer(400, {"message": "bad"}), True, id="refused by the server"),
        pytest.param(answer(409, {"message": "exists"}), True, id="conflict"),
        pytest.param(answer(404, {"message": "missing"}), True, id="not found"),
        pytest.param(answer(408, None), False, id="gateway timeout before the answer"),
        pytest.param(answer(429, None), False, id="rate limited by a gateway"),
        pytest.param(answer(500, {"message": "error"}), False, id="server error"),
        pytest.param(answer(502, None), False, id="gateway error"),
        pytest.param(failing(httpx2.ConnectError), False, id="unreachable"),
        pytest.param(failing(httpx2.ReadTimeout), False, id="timeout"),
    ],
)
def test_a_failure_says_whether_the_write_surely_did_not_happen(
    call: Callable[[SupabaseStore], object], handler: Handler, settled: bool
) -> None:
    store, _ = store_of(handler)
    with pytest.raises(StoreError) as failed:
        call(store)
    assert failed.value.settled is settled
    assert KEY not in str(failed.value)


@pytest.mark.parametrize(
    "url",
    [
        pytest.param("", id="empty"),
        pytest.param("ftp://supabase.test", id="not http"),
        pytest.param("http://supabase.test", id="http off the local stack"),
        pytest.param("http://10.0.0.5:8000", id="http on the local network"),
        pytest.param("http://supabase_kong_x.example.com", id="http to a public host named like the gateway"),
        pytest.param("http://127.0.0.1@example.com", id="http to a public host behind a local name"),
        pytest.param("https://", id="no host"),
        pytest.param("supabase.test", id="no scheme"),
    ],
)
def test_the_key_travels_only_over_https_or_to_the_local_stack(url: str) -> None:
    with pytest.raises(ValueError, match="SUPABASE_URL") as refused:
        SupabaseStore(url, KEY)
    assert KEY not in str(refused.value)


@pytest.mark.parametrize(
    "url",
    [
        "https://abcdefghijklmnop.supabase.co",
        "http://supabase_kong_NotesScannerApp:8000",
        "http://127.0.0.1:54321",
        "http://localhost:54321",
        "http://[::1]:54321",
    ],
)
def test_https_and_the_local_stack_are_accepted(url: str) -> None:
    SupabaseStore(url, KEY)


def test_the_store_needs_a_key() -> None:
    with pytest.raises(ValueError, match="SUPABASE_SERVICE_ROLE_KEY"):
        SupabaseStore(URL, "")


def test_a_whole_arbitration_calls_three_addresses_and_never_writes_the_shown_text() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == "/rest/v1/htr_models":
            return httpx2.Response(200, json=[])
        if request.url.path == "/rest/v1/rpc/record_reading_a":
            return httpx2.Response(200, json=[{"recorded": True, "reason": "recorded"}])
        return httpx2.Response(200, json={})

    store, recorder = store_of(handler)
    reading = Reading(
        width=640,
        height=480,
        lines=(
            ReadLine(row=1, box=(10, 10, 600, 60), ink=(12, 15, 590, 55), words=(Word("Le", (12, 10, 60, 60), 0.9),)),
        ),
        segment_seconds=0.0,
        recognize_seconds=0.0,
    )
    arbitration = Arbitration(page_id=PAGE, user_id=USER, b1="Le chat", reading=reading, duration_ms=1)
    assert Arbiter(store, Lingua()).arbitrate(arbitration).reason == "recorded"
    paths = [(sent.method, sent.url.path) for sent in recorder.requests]
    assert paths[0] == ("GET", "/rest/v1/htr_models")
    assert paths[1][0] == "POST"
    assert paths[1][1].startswith(f"/storage/v1/object/alto/{USER}/{PAGE}/a-")
    assert paths[2] == ("POST", "/rest/v1/rpc/record_reading_a")
    assert len(paths) == 3
    assert not any("page_texts" in path or path.endswith("/readings") for _, path in paths)


def test_the_key_follows_no_redirect_and_no_proxy_of_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
    store = SupabaseStore(URL, KEY)
    assert store._client.trust_env is False
    assert store._client.follow_redirects is False
