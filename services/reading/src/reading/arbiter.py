import logging
import time
import uuid
from collections import Counter
from collections.abc import Callable, Collection
from dataclasses import dataclass
from typing import Protocol

from reading.alto import alto_of
from reading.arbitration import Alert, Position, a_text, gate_open, positions_of, with_places
from reading.recognition import Reading
from reading.rules import SecondRefusedError
from reading.second import Second, second_of, with_second
from reading.store import ReadingA, Store, StoreError

MODEL = "medium"
MODEL_VERSION = "1"
PERSONAL = "personal"
MAX_LISTED_LINES = 50

log = logging.getLogger("reading")


@dataclass(frozen=True)
class Arbitration:
    page_id: str
    user_id: str
    b1: str
    reading: Reading
    duration_ms: int
    b2: str | None = None
    model_id: str | None = None


@dataclass(frozen=True)
class Outcome:
    reason: str
    tokens: int


class ArbitrationError(Exception):
    pass


class LanguageSource(Protocol):
    def language_of(self, text: str) -> str | None: ...


class Rules(Protocol):
    def decide(
        self,
        positions: list[Position],
        b1: str,
        a: str,
        language: str | None,
        level: str,
        b2: str | None = None,
        missing: Collection[int] = frozenset(),
    ) -> list[Position]: ...


class PageArbiter(Protocol):
    def arbitrate(self, arbitration: Arbitration) -> Outcome: ...


def new_name() -> str:
    return f"a-{uuid.uuid4().hex}.xml"


def alerts_of(second: Second | None) -> list[Alert]:
    if second is None or not (second.absent_from_b2 or second.absent_from_b1):
        return []
    details: dict[str, object] = {
        "absent_from_b2": list(second.absent_from_b2[:MAX_LISTED_LINES]),
        "absent_from_b1": list(second.absent_from_b1[:MAX_LISTED_LINES]),
    }
    return [Alert("missing_line", details)]


class Arbiter:
    def __init__(
        self,
        store: Store,
        language: LanguageSource,
        rules: Rules | None = None,
        name: Callable[[], str] = new_name,
    ) -> None:
        self._store = store
        self._language = language
        self._rules = rules
        self._name = name

    def arbitrate(self, arbitration: Arbitration) -> Outcome:
        page = arbitration.page_id
        started = time.perf_counter()
        try:
            models = self._store.models(arbitration.user_id)
        except StoreError as error:
            log.error("arbitration failed page=%s step=gate settled=%s", page, error.settled)
            raise ArbitrationError from error
        model = next((found for found in models if found.id == arbitration.model_id), None)
        if arbitration.model_id is not None and model is None:
            log.info("arbitration refused page=%s reason=model_not_found", page)
            return Outcome("model_not_found", 0)
        opened = gate_open(models, arbitration.model_id)
        placed = with_places(positions_of(arbitration.b1, arbitration.reading.lines), arbitration.b1)
        language = self._language.language_of(arbitration.b1)
        second = self._second(arbitration)
        positions = with_second(placed, second)
        if opened and self._rules is not None:
            try:
                level = self._store.correction_level(page, arbitration.user_id)
            except StoreError as error:
                log.error("arbitration failed page=%s step=level settled=%s", page, error.settled)
                raise ArbitrationError from error
            reading_a = a_text(arbitration.reading.lines)
            try:
                positions = self._rules.decide(
                    positions,
                    arbitration.b1,
                    reading_a,
                    language,
                    level,
                    b2=None if second is None else second.text,
                    missing=frozenset() if second is None else frozenset(second.absent_from_b2),
                )
            except SecondRefusedError:
                log.info("second reading left out page=%s", page)
                second = None
                positions = self._rules.decide(placed, arbitration.b1, reading_a, language, level)

        path = f"{arbitration.user_id}/{page}/{self._name()}"
        try:
            self._store.upload_alto(path, alto_of(arbitration.reading).encode())
        except StoreError as error:
            log.error("arbitration failed page=%s step=upload alto=%s", page, self._remove(path))
            raise ArbitrationError from error

        write = ReadingA(
            page_id=page,
            user_id=arbitration.user_id,
            raw_text=a_text(arbitration.reading.lines),
            model=MODEL if model is None else PERSONAL,
            model_version=MODEL_VERSION if model is None else str(model.version),
            model_id=None if model is None else model.id,
            duration_ms=arbitration.duration_ms,
            alto_path=path,
            language=language,
            tokens=positions,
            alerts=alerts_of(second),
        )
        try:
            reason = self._store.record(write)
        except StoreError as error:
            alto = self._remove(path) if error.settled else "left"
            log.error("arbitration failed page=%s step=record settled=%s alto=%s", page, error.settled, alto)
            raise ArbitrationError from error

        if reason != "recorded":
            log.info("arbitration refused page=%s reason=%s alto=%s", page, reason, self._remove(path))
            return Outcome(reason, 0)

        anchors = Counter(position.anchor_kind or "none" for position in positions)
        log.info(
            "arbitrated page=%s gate=%s language=%s tokens=%d word=%d line=%d none=%d second=%s alerts=%d seconds=%.2f",
            page,
            "open" if opened else "closed",
            language or "-",
            len(positions),
            anchors["word"],
            anchors["line"],
            anchors["none"],
            "yes" if second is not None else "no",
            len(write.alerts),
            time.perf_counter() - started,
        )
        return Outcome("recorded", len(positions))

    def _second(self, arbitration: Arbitration) -> Second | None:
        if arbitration.b2 is None:
            return None
        second = second_of(arbitration.b1, arbitration.b2)
        if second is None:
            log.info("second reading left out page=%s", arbitration.page_id)
        return second

    def _remove(self, path: str) -> str:
        try:
            self._store.remove_alto(path)
        except StoreError:
            return "left"
        return "removed"
