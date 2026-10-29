import contextlib
import logging
import re
from collections.abc import Collection, Sequence
from dataclasses import replace
from decimal import Decimal

import pytest

from reading.alto import alto_of
from reading.arbiter import Arbiter, Arbitration, ArbitrationError
from reading.arbitration import Alert, Model, Position
from reading.recognition import Reading, ReadLine, Word
from reading.rules import Rules, SecondRefusedError
from reading.store import ReadingA, StoreError
from reading.tokens import line_tokens

USER = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
PAGE = "0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f"
MODEL = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
OLDER = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a"
B1_PROBE = "Zanzibarque"
A_PROBE = "Zanzibarqe"
B2_PROBE = "Zanzibarquo"
DIAERESIS = chr(0x308)
ACUTE = chr(0x301)
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


def arbitration(
    b1: str = f"Le {B1_PROBE} dort", reading: Reading = READING, b2: str | None = None, model_id: str | None = None
) -> Arbitration:
    return Arbitration(page_id=PAGE, user_id=USER, b1=b1, reading=reading, duration_ms=28000, b2=b2, model_id=model_id)


def in_service(cer: str = "0.1", status: str = "active", model_id: str = MODEL) -> Model:
    return Model(model_id, status, Decimal(cer), 3)


class FakeStore:
    def __init__(
        self,
        models: list[Model] | None = None,
        reason: str = "recorded",
        fail: dict[str, StoreError] | None = None,
        level: str = "course",
    ) -> None:
        self._models = models or []
        self._reason = reason
        self._level = level
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

    def correction_level(self, page_id: str, user_id: str) -> str:
        assert (page_id, user_id) == (PAGE, USER)
        self._step("level")
        return self._level

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
    def __init__(self, refuse_second: bool = False) -> None:
        self.refuse_second = refuse_second
        self.calls: list[tuple[list[Position], str, str, str | None, str, str | None, frozenset[int]]] = []

    def decide(
        self,
        positions: list[Position],
        b1: str,
        a: str,
        language: str | None,
        level: str,
        b2: str | None = None,
        missing: Collection[int] = frozenset(),
    ) -> list[Position]:
        self.calls.append((positions, b1, a, language, level, b2, frozenset(missing)))
        if self.refuse_second and b2 is not None:
            raise SecondRefusedError
        return [replace(p, rule=10, channel="none") for p in positions]


class Untouchable:
    def phonemes(self, words: Sequence[str], language: str) -> list[str]:
        raise AssertionError("phonemes asked")

    def flags(self, text: str) -> list[bool]:
        raise AssertionError("entities asked")


class Ports:
    def __init__(self) -> None:
        self.phoneme_calls = 0
        self.entity_texts: list[str] = []

    def phonemes(self, words: Sequence[str], language: str) -> list[str]:
        self.phoneme_calls += 1
        return [""] * len(words)

    def flags(self, text: str) -> list[bool]:
        self.entity_texts.append(text)
        return [False] * len(line_tokens(text))


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
    store = FakeStore(models=[in_service("0.2"), in_service("0.05", "candidate", OLDER)])
    Arbiter(store, FakeLanguage(), rules).arbitrate(arbitration(model_id=MODEL))
    assert rules.calls == []
    assert all(p.rule is None and p.channel is None for p in store.writes[0].tokens)


@pytest.mark.parametrize(
    ("models", "model_id"),
    [
        pytest.param([in_service()], None, id="a read by the generic"),
        pytest.param(
            [in_service("0.1", "retired"), in_service("0.05", model_id=OLDER)], MODEL, id="a read by a retired model"
        ),
        pytest.param([in_service("0.2")], MODEL, id="a read by a model above the threshold"),
        pytest.param([in_service("0.1", "candidate")], MODEL, id="a read by a candidate"),
    ],
)
def test_the_rules_stay_silent_unless_a_was_read_by_a_model_in_service(
    models: list[Model], model_id: str | None
) -> None:
    rules = FakeRules()
    store = FakeStore(models=models)
    assert Arbiter(store, FakeLanguage(), rules).arbitrate(arbitration(model_id=model_id)).reason == "recorded"
    assert rules.calls == []
    assert all(p.rule is None and p.channel is None for p in store.writes[0].tokens)


def test_a_read_by_the_generic_is_written_as_the_generic() -> None:
    store = FakeStore(models=[in_service()])
    Arbiter(store, FakeLanguage(), FakeRules()).arbitrate(arbitration(model_id=None))
    write = store.writes[0]
    assert (write.model, write.model_version, write.model_id) == ("medium", "1", None)


def test_a_read_by_a_personal_model_is_written_with_that_model() -> None:
    store = FakeStore(models=[in_service("0.2")])
    Arbiter(store, FakeLanguage(), FakeRules()).arbitrate(arbitration(model_id=MODEL))
    write = store.writes[0]
    assert (write.model, write.model_version, write.model_id) == ("personal", "3", MODEL)


def test_a_read_by_a_model_the_user_no_longer_has_writes_nothing(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    rules = FakeRules()
    store = FakeStore(models=[in_service(model_id=OLDER)])
    outcome = Arbiter(store, FakeLanguage(), rules).arbitrate(arbitration(model_id=MODEL))
    assert outcome.reason == "model_not_found"
    assert store.calls == ["models"]
    assert rules.calls == []
    assert f"arbitration refused page={PAGE} reason=model_not_found" in logged(caplog)
    assert MODEL not in logged(caplog)


def test_with_the_gate_closed_neither_phonemes_nor_entities_are_asked() -> None:
    store = FakeStore(models=[in_service("0.13")])
    untouchable = Untouchable()
    Arbiter(store, FakeLanguage("fr"), Rules(untouchable, untouchable)).arbitrate(arbitration(model_id=MODEL))
    write = store.writes[0]
    assert [(p.text, p.rule, p.channel) for p in write.tokens] == [
        ("Le", None, None),
        (B1_PROBE, None, None),
        ("dort", None, None),
    ]
    assert "level" not in store.calls


def test_with_the_gate_open_the_rules_decide_each_position() -> None:
    rules = FakeRules()
    store = FakeStore(models=[in_service("0.129")], level="journal")
    Arbiter(store, FakeLanguage("en"), rules).arbitrate(arbitration(model_id=MODEL))
    [(positions, b1, a, language, level, b2, missing)] = rules.calls
    assert (b1, a, language, level) == (f"Le {B1_PROBE} dort", f"Le {A_PROBE}", "en", "journal")
    assert (b2, missing) == (None, frozenset())
    assert [(p.text, p.a_index, p.confidence) for p in positions] == [
        ("Le", 0, 0.99),
        (B1_PROBE, 1, 0.4),
        ("dort", None, None),
    ]
    assert [(p.rule, p.channel) for p in store.writes[0].tokens] == [(10, "none")] * 3
    assert store.calls == ["models", "level", "upload", "record"]


def test_with_the_gate_open_the_rules_write_the_words_and_their_channels() -> None:
    store = FakeStore(models=[in_service("0.1")])
    Arbiter(store, FakeLanguage("fr"), Rules(Ports(), Ports())).arbitrate(arbitration(model_id=MODEL))
    assert [(p.text, p.rule, p.channel) for p in store.writes[0].tokens] == [
        ("Le", 9, "none"),
        (B1_PROBE, 8, "layer"),
        ("dort", 10, "none"),
    ]


def test_with_the_gate_open_a_french_page_goes_through_the_entities() -> None:
    ports = Ports()
    store = FakeStore(models=[in_service("0.1")])
    Arbiter(store, FakeLanguage("fr"), Rules(ports, ports)).arbitrate(arbitration(model_id=MODEL))
    assert ports.entity_texts == [f"Le {B1_PROBE} dort", f"Le {A_PROBE}"]


@pytest.mark.parametrize("language", ["en", "es", None])
def test_with_the_gate_open_a_page_not_in_french_never_goes_through_the_entities(language: str | None) -> None:
    ports = Ports()
    store = FakeStore(models=[in_service("0.1")])
    Arbiter(store, FakeLanguage(language), Rules(ports, ports)).arbitrate(arbitration(model_id=MODEL))
    assert ports.entity_texts == []
    assert len(store.writes) == 1


def test_a_correction_level_out_of_reach_stops_before_anything_is_uploaded() -> None:
    store = FakeStore(models=[in_service("0.1")], fail={"level": StoreError(settled=False)})
    with pytest.raises(ArbitrationError):
        Arbiter(store, FakeLanguage(), FakeRules()).arbitrate(arbitration(model_id=MODEL))
    assert store.calls == ["models", "level"]


def test_failing_rules_stop_before_anything_is_uploaded() -> None:
    store = FakeStore(models=[in_service("0.1")])
    with pytest.raises(AssertionError):
        Arbiter(store, FakeLanguage("fr"), Rules(Untouchable(), Untouchable())).arbitrate(arbitration(model_id=MODEL))
    assert store.calls == ["models", "level"]


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
    ("store", "model_id"),
    [
        pytest.param(FakeStore(), None, id="recorded"),
        pytest.param(FakeStore(reason="not_text"), None, id="refused"),
        pytest.param(FakeStore(fail={"record": StoreError(settled=False)}), None, id="failed"),
        pytest.param(FakeStore(models=[in_service("0.1")], level="journal"), MODEL, id="gate open"),
        pytest.param(FakeStore(), MODEL, id="model not found"),
    ],
)
def test_the_logs_carry_no_text_of_the_page(
    store: FakeStore, model_id: str | None, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    with contextlib.suppress(ArbitrationError):
        Arbiter(store, FakeLanguage(), Rules(Ports(), Ports())).arbitrate(
            arbitration(b2=f"Le {B2_PROBE} dort", model_id=model_id)
        )
    text = logged(caplog)
    assert PAGE in text
    assert B1_PROBE not in text
    assert A_PROBE not in text
    assert B2_PROBE not in text
    assert USER not in text


def test_b2_is_read_into_each_position_even_with_the_gate_closed() -> None:
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration(b2=f"Le {B2_PROBE} dort"))
    [write] = store.writes
    assert [(p.text, p.reading_b2) for p in write.tokens] == [("Le", "Le"), (B1_PROBE, B2_PROBE), ("dort", "dort")]
    assert all(p.rule is None and p.channel is None for p in write.tokens)
    assert write.alerts == []


def test_without_b2_no_position_holds_a_reading_of_it() -> None:
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration())
    assert [p.reading_b2 for p in store.writes[0].tokens] == [None, None, None]


def test_each_position_holds_its_place_in_the_raw_text_of_b1() -> None:
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration())
    assert [(p.b1_start, p.b1_end) for p in store.writes[0].tokens] == [(0, 2), (3, 14), (15, 19)]


def test_the_places_are_counted_in_the_characters_of_a_b1_that_is_not_composed() -> None:
    b1 = f"e{ACUTE}te{ACUTE} {B1_PROBE} dort"
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration(b1=b1))
    places = [(p.b1_start, p.b1_end) for p in store.writes[0].tokens]
    assert [b1[start:end] for start, end in places] == [f"e{ACUTE}te{ACUTE}", B1_PROBE, "dort"]


def test_a_b1_whose_words_cannot_be_placed_is_written_without_any_place() -> None:
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration(b1=f"o{DIAERESIS}{ACUTE} oui"))
    assert [(p.b1_start, p.b1_end) for p in store.writes[0].tokens] == [(None, None), (None, None)]


def test_the_rules_are_given_b2_and_the_lines_it_lacks() -> None:
    rules = FakeRules()
    store = FakeStore(models=[in_service("0.1")])
    Arbiter(store, FakeLanguage("fr"), rules).arbitrate(
        arbitration(b1="Jour 27\nLe chat dort", b2="Le chat dort", model_id=MODEL)
    )
    [(_, _, _, _, _, b2, missing)] = rules.calls
    assert (b2, missing) == ("Le chat dort", frozenset({0}))


def test_a_line_b2_lacks_is_an_alert_even_with_the_gate_closed() -> None:
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration(b1="Jour 27\nLe chat dort", b2="Le chat dort"))
    assert store.writes[0].alerts == [Alert("missing_line", {"absent_from_b2": [0], "absent_from_b1": []})]


def test_a_line_b1_lacks_is_an_alert_too() -> None:
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration(b1="Le chat dort", b2="Jour 27\nLe chat dort"))
    assert store.writes[0].alerts == [Alert("missing_line", {"absent_from_b2": [], "absent_from_b1": [0]})]


def test_the_lines_an_alert_names_are_capped() -> None:
    b1 = "\n".join(f"mot{i}" for i in range(60))
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration(b1=b1, b2="mot0"))
    [alert] = store.writes[0].alerts
    assert alert.details["absent_from_b2"] == list(range(1, 51))
    assert alert.details["absent_from_b1"] == []


def test_readings_that_agree_on_every_line_raise_no_alert() -> None:
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration(b1="Jour 27\nLe chat dort", b2="Jour 27\nLe chat dort"))
    assert store.writes[0].alerts == []


def test_a_b2_beyond_the_bounds_is_left_out_and_the_page_is_read_without_it(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    b1 = " ".join(f"mot{i}" for i in range(1001))
    store = FakeStore()
    Arbiter(store, FakeLanguage()).arbitrate(arbitration(b1=b1, b2=b1))
    [write] = store.writes
    assert len(write.tokens) == 1001
    assert all(p.reading_b2 is None for p in write.tokens)
    assert write.alerts == []
    assert "second reading left out" in logged(caplog)


def test_a_b2_the_entities_refuse_is_left_out_and_the_page_is_decided_without_it(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    rules = FakeRules(refuse_second=True)
    store = FakeStore(models=[in_service("0.1")])
    Arbiter(store, FakeLanguage("fr"), rules).arbitrate(
        arbitration(b1="Jour 27\nLe chat dort", b2="Le chat dort", model_id=MODEL)
    )
    assert [(call[5], call[6]) for call in rules.calls] == [("Le chat dort", frozenset({0})), (None, frozenset())]
    [write] = store.writes
    assert all(p.reading_b2 is None for p in write.tokens)
    assert write.alerts == []
    assert [p.rule for p in write.tokens] == [10] * 5
    assert "second reading left out" in logged(caplog)
