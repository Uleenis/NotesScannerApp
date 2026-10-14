import contextlib
import logging
import re
from decimal import Decimal

import pytest

from reading.alto import alto_of
from reading.arbiter import Arbiter, Arbitration, ArbitrationError
from reading.arbitration import Model, Position
from reading.recognition import Reading, ReadLine, Word
from reading.store import ReadingA, StoreError

USER = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
PAGE = "0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f"
B1_PROBE = "Zanzibarque"
A_PROBE = "Zanzibarqe"
PATH = re.compile(rf"{USER}/{PAGE}/a-[0-9a-f]{{32}}\.xml")

READING = Reading(
    width=640,
    height=480,
    lines=(
        ReadLine(
            row=1,
            box=(10, 10, 600, 60),
            ink=(12, 15, 590, 55),
            words=(Word("Le", (12, 10, 60, 60), 0.99), Word(A_PROBE, (70, 10, 250, 60), 0.4)),
        ),
    ),
    segment_seconds=0.0,
    recognize_seconds=0.0,
)


def arbitration(b1: str = f"Le {B1_PROBE} dort", reading: Reading = READING) -> Arbitration:
    return Arbitration(page_id=PAGE, user_id=USER, b1=b1, reading=reading, duration_ms=28000)


class FakeStore:
    def __init__(
        self,
        models: list[Model] | None = None,
        reason: str = "recorded",
        fail: dict[str, StoreError] | None = None,
    ) -> None:
        self._models = models or []
        self._reason = reason
        self._fail = fail or {}
        self.calls: list[str] = []
        self.uploads: dict[str, bytes] = {}
        self.writes: list[ReadingA] = []
        self.removed: list[str] = []

    def _step(self, name: str) -> None:
        self.calls.append(name)
        if name in self._fail:
            raise self._fail[name]

    def models(self, user_id: str) -> list[Model]:
        assert user_id == USER
        self._step("models")
        return self._models

    def upload_alto(self, path: str, alto: bytes) -> None:
        self._step("upload")
        self.uploads[path] = alto

    def record(self, write: ReadingA) -> str:
        self._step("record")
        self.writes.append(write)
        return self._reason

    def remove_alto(self, path: str) -> None:
        self._step("remove")
        self.removed.append(path)


class FakeLanguage:
    def __init__(self, language: str | None = "fr") -> None:
        self.language = language
        self.texts: list[str] = []

    def language_of(self, text: str) -> str | None:
        self.texts.append(text)
        return self.language


class FakeRules:
    def __init__(self) -> None:
        self.calls: list[tuple[list[Position], str | None]] = []

    def decide(self, positions: list[Position], language: str | None) -> list[Position]:
        self.calls.append((positions, language))
        return [
            Position(
                p.token_index, p.line_index, p.text, 10, "none", p.reading_a, p.reading_b1, p.anchor_kind, p.anchor
            )
            for p in positions
        ]


def logged(caplog: pytest.LogCaptureFixture) -> str:
    return "\n".join(record.getMessage() for record in caplog.records)


def test_a_is_uploaded_then_written_with_its_positions_and_language() -> None:
    store = FakeStore()
    language = FakeLanguage("fr")
    outcome = Arbiter(store, language).arbitrate(arbitration())
    assert (outcome.reason, outcome.tokens) == ("recorded", 3)
    assert store.calls == ["models", "upload", "record"]
    [path] = store.uploads
    assert PATH.fullmatch(path)
    assert store.uploads[path] == alto_of(READING).encode()
    [write] = store.writes
    assert write.page_id == PAGE
    assert write.user_id == USER
    assert write.raw_text == f"Le {A_PROBE}"
    assert (write.model, write.model_version) == ("medium", "1")
    assert write.duration_ms == 28000
    assert write.alto_path == path
    assert write.language == "fr"
    assert [(p.text, p.reading_a, p.anchor_kind) for p in write.tokens] == [
        ("Le", "Le", "word"),
        (B1_PROBE, A_PROBE, "word"),
        ("dort", None, "line"),
    ]
    assert language.texts == [f"Le {B1_PROBE} dort"]
    assert store.removed == []


def test_with_the_gate_closed_the_rules_are_never_asked_and_no_position_has_a_rule() -> None:
    rules = FakeRules()
    store = FakeStore(models=[Model("active", Decimal("0.2")), Model("candidate", Decimal("0.05"))])
    Arbiter(store, FakeLanguage(), rules).arbitrate(arbitration())
    assert rules.calls == []
    assert all(p.rule is None and p.channel is None for p in store.writes[0].tokens)


def test_with_the_gate_open_the_rules_decide_each_position() -> None:
    rules = FakeRules()
    store = FakeStore(models=[Model("active", Decimal("0.129"))])
    Arbiter(store, FakeLanguage("en"), rules).arbitrate(arbitration())
    [(positions, language)] = rules.calls
    assert language == "en"
    assert [p.text for p in positions] == ["Le", B1_PROBE, "dort"]
    assert [(p.rule, p.channel) for p in store.writes[0].tokens] == [(10, "none")] * 3


def test_a_page_whose_language_is_not_found_is_written_without_one() -> None:
    store = FakeStore()
    Arbiter(store, FakeLanguage(None)).arbitrate(arbitration())
    assert store.writes[0].language is None


@pytest.mark.parametrize("reason", ["page_not_found", "not_text", "already_read"])
def test_a_refused_write_erases_the_alto_it_uploaded(reason: str) -> None:
    store = FakeStore(reason=reason)
    outcome = Arbiter(store, FakeLanguage()).arbitrate(arbitration())
    assert outcome.reason == reason
    assert store.removed == list(store.uploads)
    assert store.calls == ["models", "upload", "record", "remove"]


def test_a_write_surely_not_done_erases_the_alto() -> None:
    store = FakeStore(fail={"record": StoreError(settled=True)})
    with pytest.raises(ArbitrationError):
        Arbiter(store, FakeLanguage()).arbitrate(arbitration())
    assert store.removed == list(store.uploads)


def test_a_write_perhaps_done_keeps_the_alto_and_says_so(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    store = FakeStore(fail={"record": StoreError(settled=False)})
    with pytest.raises(ArbitrationError):
        Arbiter(store, FakeLanguage()).arbitrate(arbitration())
    assert store.removed == []
    assert "alto=left" in logged(caplog)


def test_a_failed_upload_writes_nothing_and_erases_what_may_have_arrived() -> None:
    store = FakeStore(fail={"upload": StoreError(settled=False)})
    with pytest.raises(ArbitrationError):
        Arbiter(store, FakeLanguage()).arbitrate(arbitration())
    assert store.calls == ["models", "upload", "remove"]
    assert store.writes == []


def test_an_erase_that_fails_is_logged_and_the_refusal_stands(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    store = FakeStore(reason="already_read", fail={"remove": StoreError(settled=False)})
    outcome = Arbiter(store, FakeLanguage()).arbitrate(arbitration())
    assert outcome.reason == "already_read"
    assert "alto=left" in logged(caplog)


def test_models_out_of_reach_stop_before_anything_is_uploaded() -> None:
    store = FakeStore(fail={"models": StoreError(settled=False)})
    with pytest.raises(ArbitrationError):
        Arbiter(store, FakeLanguage()).arbitrate(arbitration())
    assert store.calls == ["models"]


def test_each_attempt_has_its_own_file() -> None:
    store = FakeStore(reason="already_read")
    arbiter = Arbiter(store, FakeLanguage())
    arbiter.arbitrate(arbitration())
    arbiter.arbitrate(arbitration())
    assert len(store.removed) == 2
    assert store.removed[0] != store.removed[1]


def test_an_empty_b1_writes_a_without_positions() -> None:
    store = FakeStore()
    outcome = Arbiter(store, FakeLanguage(None)).arbitrate(arbitration(b1=""))
    assert outcome.tokens == 0
    assert store.writes[0].tokens == []


def test_an_empty_a_writes_positions_without_anchors() -> None:
    empty = Reading(width=640, height=480, lines=(), segment_seconds=0.0, recognize_seconds=0.0)
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration(reading=empty))
    write = store.writes[0]
    assert write.raw_text == ""
    assert [(p.reading_a, p.anchor_kind) for p in write.tokens] == [(None, None)] * 3


@pytest.mark.parametrize(
    "store",
    [
        pytest.param(FakeStore(), id="recorded"),
        pytest.param(FakeStore(reason="not_text"), id="refused"),
        pytest.param(FakeStore(fail={"record": StoreError(settled=False)}), id="failed"),
    ],
)
def test_the_logs_carry_no_text_of_the_page(store: FakeStore, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    with contextlib.suppress(ArbitrationError):
        Arbiter(store, FakeLanguage()).arbitrate(arbitration())
    text = logged(caplog)
    assert PAGE in text
    assert B1_PROBE not in text
    assert A_PROBE not in text
    assert USER not in text
