import json
import logging
import os
import re
import tempfile
import threading
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from reading.recognition import TileReader
from reading.store import ActiveModel, StoreError
from reading.training import MAX_MODEL_BYTES, WEIGHTS, ModelError, checked_model, header_of

MAX_MODELS = 4
MAX_CLASSES = 2048
MAX_VERSION_LENGTH = 32
IDENTIFIER = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
FINGERPRINT = re.compile(r"[0-9a-f]{64}")
FIXED = ("_tasks", "_model", "variant", "height", "seg_type", "one_channel_mode", "legacy_polygons")
FREE = ("_kraken_min_version", "num_classes", "codec", "accuracy", "metrics")

log = logging.getLogger("reading")

__all__ = ["ActiveModel", "ModelChooser", "ModelSource", "Models", "entry_of", "fits"]


class ModelSource(Protocol):
    def active_model(self, user_id: str) -> ActiveModel | None: ...

    def download_model(self, path: str, limit: int) -> bytes: ...


class ModelChooser(Protocol):
    def for_user(self, user_id: str, page_id: str) -> tuple[TileReader | None, str | None]: ...


class UnavailableError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def entry_of(path: Path) -> dict[str, object]:
    header = header_of(path)
    metadata = None if header is None else header.get("__metadata__")
    meta = metadata.get("kraken_meta") if isinstance(metadata, dict) else None
    if not isinstance(meta, str):
        raise ModelError("no kraken metadata")
    try:
        models = json.loads(meta)
    except (ValueError, RecursionError) as error:
        raise ModelError("kraken metadata is not json") from error
    if not isinstance(models, dict) or len(models) != 1:
        raise ModelError("not exactly one model")
    [entry] = models.values()
    if not isinstance(entry, dict):
        raise ModelError("model metadata is not an object")
    return entry


def same(left: object, right: object) -> bool:
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def fits(entry: dict[str, object], generic: dict[str, object]) -> bool:
    fixed = [key for key in FIXED if key in generic]
    if not set(entry) <= {*fixed, *FREE}:
        return False
    if not all(key in entry and same(entry[key], generic[key]) for key in fixed):
        return False
    classes = entry.get("num_classes")
    if type(classes) is not int or not 2 <= classes <= MAX_CLASSES:
        return False
    codec = entry.get("codec")
    if not isinstance(codec, dict) or len(codec) >= MAX_CLASSES:
        return False
    version = entry.get("_kraken_min_version", "")
    if not isinstance(version, str) or len(version) > MAX_VERSION_LENGTH:
        return False
    return all(isinstance(entry.get(key, []), list) for key in ("accuracy", "metrics"))


def named(model: ActiveModel, user_id: str) -> bool:
    return (
        IDENTIFIER.fullmatch(model.id) is not None
        and model.path == f"{user_id}/{model.id}{WEIGHTS}"
        and FINGERPRINT.fullmatch(model.sha256) is not None
    )


class Models:
    def __init__(
        self,
        source: ModelSource,
        load: Callable[[Path], TileReader],
        generic: dict[str, object],
        folder: Path,
        capacity: int = MAX_MODELS,
    ) -> None:
        self._source = source
        self._load = load
        self._generic = generic
        self._folder = folder
        self._capacity = capacity
        self._loaded: OrderedDict[tuple[str, str, str], TileReader] = OrderedDict()
        self._lock = threading.Lock()

    def for_user(self, user_id: str, page_id: str) -> tuple[TileReader | None, str | None]:
        try:
            return self._chosen(user_id)
        except UnavailableError as error:
            log.warning("personal_model_unavailable page=%s reason=%s", page_id, error.reason)
            return None, None

    def _chosen(self, user_id: str) -> tuple[TileReader | None, str | None]:
        try:
            model = self._source.active_model(user_id)
        except StoreError as error:
            raise UnavailableError("store") from error
        if model is None:
            return None, None
        if not named(model, user_id):
            raise UnavailableError("path")
        key = (user_id, model.id, model.sha256)
        with self._lock:
            recognizer = self._loaded.get(key)
            if recognizer is None:
                recognizer = self._fetched(model)
                self._loaded[key] = recognizer
                while len(self._loaded) > self._capacity:
                    self._loaded.popitem(last=False)
            else:
                self._loaded.move_to_end(key)
        return recognizer, model.id

    def _fetched(self, model: ActiveModel) -> TileReader:
        try:
            data = self._source.download_model(model.path, MAX_MODEL_BYTES)
        except StoreError as error:
            raise UnavailableError("missing") from error
        descriptor, name = tempfile.mkstemp(suffix=WEIGHTS, dir=self._folder)
        path = Path(name)
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(data)
            del data
            try:
                checked_model(path, model.sha256)
            except ModelError as error:
                raise UnavailableError("file") from error
            try:
                entry = entry_of(path)
            except ModelError as error:
                raise UnavailableError("architecture") from error
            if not fits(entry, self._generic):
                raise UnavailableError("architecture")
            try:
                return self._load(path)
            except Exception as error:
                raise UnavailableError("load") from error
        finally:
            path.unlink(missing_ok=True)
