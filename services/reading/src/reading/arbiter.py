import logging
import time
import uuid
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from reading.alto import alto_of
from reading.arbitration import Position, a_text, gate_open, positions_of
from reading.recognition import Reading
from reading.store import ReadingA, Store, StoreError

MODEL = "medium"
MODEL_VERSION = "1"

log = logging.getLogger("reading")


@dataclass(frozen=True)
class Arbitration:
    page_id: str
    user_id: str
    b1: str
    reading: Reading
    duration_ms: int


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
        self, positions: list[Position], b1: str, a: str, language: str | None, level: str
    ) -> list[Position]: ...


class PageArbiter(Protocol):
    def arbitrate(self, arbitration: Arbitration) -> Outcome: ...


def new_name() -> str:
    return f"a-{uuid.uuid4().hex}.xml"


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
        opened = gate_open(models)
        positions = positions_of(arbitration.b1, arbitration.reading.lines)
        language = self._language.language_of(arbitration.b1)
        if opened and self._rules is not None:
            try:
                level = self._store.correction_level(page, arbitration.user_id)
            except StoreError as error:
                log.error("arbitration failed page=%s step=level settled=%s", page, error.settled)
                raise ArbitrationError from error
            positions = self._rules.decide(
                positions, arbitration.b1, a_text(arbitration.reading.lines), language, level
            )

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
            model=MODEL,
            model_version=MODEL_VERSION,
            duration_ms=arbitration.duration_ms,
            alto_path=path,
            language=language,
            tokens=positions,
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
            "arbitrated page=%s gate=%s language=%s tokens=%d word=%d line=%d none=%d seconds=%.2f",
            page,
            "open" if opened else "closed",
            language or "-",
            len(positions),
            anchors["word"],
            anchors["line"],
            anchors["none"],
            time.perf_counter() - started,
        )
        return Outcome("recorded", len(positions))

    def _remove(self, path: str) -> str:
        try:
            self._store.remove_alto(path)
        except StoreError:
            return "left"
        return "removed"
