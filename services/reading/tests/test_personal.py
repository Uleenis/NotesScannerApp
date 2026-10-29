import hashlib
import json
import logging
import os
import struct
import threading
import time
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from reading.personal import ActiveModel, Models, entry_of
from reading.recognition import Recognizer, TileWord
from reading.store import StoreError
from reading.training import MAX_MODEL_BYTES

USER = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
OTHER = "7b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e"
PAGE = "0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f"
MODEL = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
GENERIC_ENTRY: dict[str, object] = {
    "_kraken_min_version": "7.0.0",
    "_tasks": ["recognition"],
    "_model": "PPOCRv6Model",
    "variant": "medium",
    "num_classes": 4,
    "height": 96,
    "codec": {"a": [1], "b": [2], "c": [3]},
    "seg_type": "baselines",
    "one_channel_mode": "RGB",
    "legacy_polygons": False,
    "accuracy": [],
    "metrics": [],
}


def weights(entry: dict[str, object] | None = None, prefix: str = "net", extra: bytes = b"") -> bytes:
    meta = {prefix: GENERIC_ENTRY if entry is None else entry}
    header = json.dumps({"__metadata__": {"kraken_meta": json.dumps(meta)}}).encode()
    return struct.pack("<Q", len(header)) + header + extra


def fingerprint(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def active(data: bytes, user: str = USER, model: str = MODEL) -> ActiveModel:
    return ActiveModel(id=model, path=f"{user}/{model}.safetensors", sha256=fingerprint(data))


class FakeSource:
    def __init__(
        self,
        models: dict[str, ActiveModel | None],
        files: dict[str, bytes],
        fail: bool = False,
        down: bool = False,
        delay: float = 0.0,
    ) -> None:
        self.models = models
        self.files = files
        self.fail = fail
        self.down = down
        self.delay = delay
        self.downloads: list[tuple[str, int]] = []

    def active_model(self, user_id: str) -> ActiveModel | None:
        if self.fail:
            raise StoreError(settled=False)
        return self.models.get(user_id)

    def download_model(self, path: str, limit: int) -> bytes:
        self.downloads.append((path, limit))
        time.sleep(self.delay)
        if self.down:
            raise StoreError(settled=False)
        if path not in self.files:
            raise StoreError(settled=True)
        return self.files[path]


class Loaded:
    def __init__(self, path: Path) -> None:
        self.data = path.read_bytes()

    def words(self, tile: Image.Image) -> list[TileWord]:
        return []


class FakeLoader:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.paths: list[Path] = []

    def __call__(self, path: Path) -> Loaded:
        self.paths.append(path)
        if self.error is not None:
            raise self.error
        return Loaded(path)


def models_of(
    source: FakeSource, folder: Path, loader: FakeLoader | None = None, capacity: int = 4
) -> tuple[Models, FakeLoader]:
    loader = loader or FakeLoader()
    return Models(source, loader, GENERIC_ENTRY, folder, capacity=capacity), loader


def logged(caplog: pytest.LogCaptureFixture) -> str:
    return "\n".join(record.getMessage() for record in caplog.records)


def test_a_user_without_a_personal_model_is_read_by_the_generic(tmp_path: Path) -> None:
    models, loader = models_of(FakeSource({}, {}), tmp_path)
    assert models.for_user(USER, PAGE) == (None, None)
    assert loader.paths == []


def test_the_active_personal_model_reads_the_pages_of_its_owner(tmp_path: Path) -> None:
    data = weights()
    model = active(data)
    source = FakeSource({USER: model}, {model.path: data})
    models, _ = models_of(source, tmp_path)
    recognizer, model_id = models.for_user(USER, PAGE)
    assert isinstance(recognizer, Loaded)
    assert recognizer.data == data
    assert model_id == MODEL
    assert source.downloads == [(model.path, MAX_MODEL_BYTES)]


def test_a_loaded_model_is_kept_and_not_downloaded_again(tmp_path: Path) -> None:
    data = weights()
    model = active(data)
    source = FakeSource({USER: model}, {model.path: data})
    models, loader = models_of(source, tmp_path)
    first, _ = models.for_user(USER, PAGE)
    second, _ = models.for_user(USER, PAGE)
    assert first is second
    assert len(source.downloads) == 1
    assert len(loader.paths) == 1


def test_no_more_than_four_models_are_kept_and_the_oldest_used_goes_first(tmp_path: Path) -> None:
    users = [f"{index}a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" for index in range(5)]
    data = weights()
    found = {user: active(data, user=user, model=f"{user[:-1]}e") for user in users}
    source = FakeSource(dict(found), {model.path: data for model in found.values()})
    models, loader = models_of(source, tmp_path)
    for user in users[:4]:
        models.for_user(user, PAGE)
    models.for_user(users[0], PAGE)
    models.for_user(users[4], PAGE)
    assert len(loader.paths) == 5
    models.for_user(users[0], PAGE)
    assert len(loader.paths) == 5
    models.for_user(users[1], PAGE)
    assert len(loader.paths) == 6


def test_a_new_active_model_replaces_the_one_kept(tmp_path: Path) -> None:
    first = weights()
    second = weights(extra=b"retrained")
    old = active(first)
    new = active(second, model=OTHER)
    source = FakeSource({USER: old}, {old.path: first, new.path: second})
    models, _ = models_of(source, tmp_path)
    models.for_user(USER, PAGE)
    source.models[USER] = new
    recognizer, model_id = models.for_user(USER, PAGE)
    assert isinstance(recognizer, Loaded)
    assert recognizer.data == second
    assert model_id == OTHER


def test_the_file_is_erased_once_the_model_is_loaded(tmp_path: Path) -> None:
    data = weights()
    model = active(data)
    models, loader = models_of(FakeSource({USER: model}, {model.path: data}), tmp_path)
    models.for_user(USER, PAGE)
    assert loader.paths[0].parent == tmp_path
    assert loader.paths[0].suffix == ".safetensors"
    assert list(tmp_path.iterdir()) == []


def unavailable(models: Models, caplog: pytest.LogCaptureFixture, reason: str) -> None:
    with caplog.at_level(logging.INFO, logger="reading"):
        assert models.for_user(USER, PAGE) == (None, None)
    assert f"personal_model_unavailable page={PAGE} reason={reason}" in logged(caplog)


def test_a_missing_file_reads_with_the_generic_and_says_so(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    model = active(weights())
    models, loader = models_of(FakeSource({USER: model}, {}), tmp_path)
    unavailable(models, caplog, "missing")
    assert loader.paths == []


def test_a_wrong_fingerprint_reads_with_the_generic_and_says_so(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    data = weights()
    model = active(data)
    source = FakeSource({USER: model}, {model.path: weights(extra=b"swapped")})
    models, loader = models_of(source, tmp_path)
    unavailable(models, caplog, "file")
    assert loader.paths == []
    assert list(tmp_path.iterdir()) == []


def test_a_file_that_is_not_safetensors_is_never_loaded(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    data = b"PK\x03\x04" + b"\x00" * 64
    model = active(data)
    models, loader = models_of(FakeSource({USER: model}, {model.path: data}), tmp_path)
    unavailable(models, caplog, "file")
    assert loader.paths == []


def test_a_model_that_fails_to_load_reads_with_the_generic(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    data = weights()
    model = active(data)
    source = FakeSource({USER: model}, {model.path: data})
    models, _ = models_of(source, tmp_path, FakeLoader(RuntimeError("missing keys")))
    unavailable(models, caplog, "load")
    assert list(tmp_path.iterdir()) == []


def test_a_model_out_of_reach_reads_with_the_generic(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    models, _ = models_of(FakeSource({}, {}, fail=True), tmp_path)
    unavailable(models, caplog, "store")


@pytest.mark.parametrize(
    "model",
    [
        pytest.param(ActiveModel(MODEL, f"{OTHER}/{MODEL}.safetensors", "0" * 64), id="another user's folder"),
        pytest.param(ActiveModel(MODEL, f"{USER}/{OTHER}.safetensors", "0" * 64), id="another model's file"),
        pytest.param(ActiveModel(MODEL, f"{USER}/../{MODEL}.safetensors", "0" * 64), id="a climb"),
        pytest.param(ActiveModel(MODEL, f"{USER}/{MODEL}.ckpt", "0" * 64), id="a checkpoint"),
        pytest.param(ActiveModel("medium", f"{USER}/medium.safetensors", "0" * 64), id="not an identifier"),
        pytest.param(ActiveModel(MODEL, f"{USER}/{MODEL}.safetensors", "0" * 63), id="short fingerprint"),
        pytest.param(ActiveModel(MODEL, f"{USER}/{MODEL}.safetensors", "A" * 64), id="fingerprint in capitals"),
    ],
)
def test_a_model_named_otherwise_than_its_fixed_path_is_never_downloaded(
    model: ActiveModel, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    source = FakeSource({USER: model}, {model.path: weights()})
    models, _ = models_of(source, tmp_path)
    unavailable(models, caplog, "path")
    assert source.downloads == []


def changed(**fields: object) -> dict[str, object]:
    return {**GENERIC_ENTRY, **fields}


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(weights(changed(_model="TorchVGSLModel")), id="another kind of network"),
        pytest.param(weights(changed(variant="large")), id="another size"),
        pytest.param(weights(changed(height=4096)), id="another height"),
        pytest.param(weights(changed(_tasks=["segmentation"])), id="another task"),
        pytest.param(weights(changed(spec="[1,48,0,1 Cr3,3,32]")), id="a key the generic lacks"),
        pytest.param(weights(changed(num_classes=1_000_000)), id="too many classes"),
        pytest.param(weights(changed(num_classes=True)), id="classes not a number"),
        pytest.param(weights(changed(codec=["a"])), id="codec not a table"),
        pytest.param(weights({"x": 1}), id="an entry of nothing known"),
        pytest.param(weights(changed(codec={"a": [1, 1, 1, 1, 1]})), id="a code too long"),
        pytest.param(weights(changed(codec={"a": [4]})), id="a label beyond the classes"),
        pytest.param(weights(changed(codec={"a": ["1"]})), id="a label not a number"),
        pytest.param(weights(changed(codec={"a": 1})), id="a code not a list"),
    ],
)
def test_a_model_built_otherwise_than_the_generic_is_never_loaded(
    data: bytes, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    model = active(data)
    models, loader = models_of(FakeSource({USER: model}, {model.path: data}), tmp_path)
    unavailable(models, caplog, "architecture")
    assert loader.paths == []


def test_a_file_holding_two_models_is_never_loaded(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    meta = {"one": GENERIC_ENTRY, "two": GENERIC_ENTRY}
    header = json.dumps({"__metadata__": {"kraken_meta": json.dumps(meta)}}).encode()
    data = struct.pack("<Q", len(header)) + header
    model = active(data)
    models, loader = models_of(FakeSource({USER: model}, {model.path: data}), tmp_path)
    unavailable(models, caplog, "architecture")
    assert loader.paths == []


def test_the_logs_carry_neither_the_user_nor_the_path(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    model = active(weights())
    models, _ = models_of(FakeSource({USER: model}, {}), tmp_path)
    with caplog.at_level(logging.DEBUG):
        models.for_user(USER, PAGE)
    text = logged(caplog)
    assert USER not in text
    assert MODEL not in text


def test_the_generic_entry_is_read_from_the_generic_model() -> None:
    entry = entry_of(Path(os.environ["READING_MODEL"]))
    assert entry["_model"] == "PPOCRv6Model"
    assert entry["variant"] == "medium"


def test_a_copy_of_the_generic_loads_through_kraken_as_a_personal_model(tmp_path: Path) -> None:
    generic = Path(os.environ["READING_MODEL"])
    data = generic.read_bytes()
    model = active(data)
    folder = tmp_path / "models"
    folder.mkdir()
    source = FakeSource({USER: model}, {model.path: data})
    models = Models(source, lambda path: Recognizer(str(path)), entry_of(generic), folder)
    recognizer, model_id = models.for_user(USER, PAGE)
    assert isinstance(recognizer, Recognizer)
    assert model_id == MODEL
    assert list(folder.iterdir()) == []


def written_tile() -> Image.Image:
    tile = Image.new("RGB", (900, 120), (250, 250, 250))
    ImageDraw.Draw(tile).text(
        (20, 25), "copper lantern meadow", fill=(20, 20, 20), font=ImageFont.load_default(size=60)
    )
    return tile


def test_a_personal_copy_of_the_generic_reads_like_it_once_its_file_is_erased(tmp_path: Path) -> None:
    generic = Path(os.environ["READING_MODEL"])
    data = generic.read_bytes()
    model = active(data)
    folder = tmp_path / "models"
    folder.mkdir()
    models = Models(
        FakeSource({USER: model}, {model.path: data}), lambda path: Recognizer(str(path)), entry_of(generic), folder
    )
    recognizer, _ = models.for_user(USER, PAGE)
    assert recognizer is not None
    assert list(folder.iterdir()) == []
    assert recognizer.words(written_tile()) == Recognizer(str(generic)).words(written_tile())


def polyglot() -> bytes:
    import kraken
    from coremltools.models.utils import load_spec

    spec = load_spec(str(Path(kraken.__file__).parent / "blla.mlmodel"))
    user_defined = spec.description.metadata.userDefined
    meta = json.loads(user_defined["kraken_meta"])
    meta["model_type"] = ["recognition"]
    user_defined["kraken_meta"] = json.dumps(meta)
    generic = entry_of(Path(os.environ["READING_MODEL"]))
    skip = 0x44 + (0x00 << 7) + (0x20 << 14)
    length = skip + 5
    head = '{"Ā ":"x","__metadata__":{"kraken_meta":' + json.dumps(json.dumps({"net": generic})) + "}}"
    raw = head.encode()
    assert length & 0xFF == 0x49
    assert len(raw) <= length
    coreml: bytes = spec.SerializeToString()
    return struct.pack("<Q", length) + raw + b" " * (length - len(raw)) + coreml


def test_a_file_that_is_also_a_coreml_model_never_loads_the_coreml_network(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    data = polyglot()
    model = active(data)
    generic = entry_of(Path(os.environ["READING_MODEL"]))
    source = FakeSource({USER: model}, {model.path: data})
    models = Models(source, lambda path: Recognizer(str(path)), generic, tmp_path)
    unavailable(models, caplog, "load")


def test_a_full_disk_reads_with_the_generic_and_says_so(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    data = weights()
    model = active(data)
    models, loader = models_of(FakeSource({USER: model}, {model.path: data}), tmp_path / "gone")
    unavailable(models, caplog, "disk")
    assert loader.paths == []


def test_a_model_refused_once_is_not_downloaded_again(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    data = weights(changed(variant="large"))
    model = active(data)
    source = FakeSource({USER: model}, {model.path: data})
    models, _ = models_of(source, tmp_path)
    unavailable(models, caplog, "architecture")
    caplog.clear()
    unavailable(models, caplog, "architecture")
    assert len(source.downloads) == 1


def test_a_storage_out_of_reach_is_tried_again_on_the_next_page(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    data = weights()
    model = active(data)
    source = FakeSource({USER: model}, {model.path: data}, down=True)
    models, _ = models_of(source, tmp_path)
    unavailable(models, caplog, "store")
    source.down = False
    recognizer, model_id = models.for_user(USER, PAGE)
    assert recognizer is not None
    assert model_id == MODEL
    assert len(source.downloads) == 2


def test_a_model_its_owner_no_longer_has_leaves_memory(tmp_path: Path) -> None:
    data = weights()
    model = active(data)
    source = FakeSource({USER: model}, {model.path: data})
    models, loader = models_of(source, tmp_path)
    models.for_user(USER, PAGE)
    source.models[USER] = None
    assert models.for_user(USER, PAGE) == (None, None)
    source.models[USER] = model
    models.for_user(USER, PAGE)
    assert len(loader.paths) == 2


def test_a_replaced_model_leaves_memory(tmp_path: Path) -> None:
    first = weights()
    second = weights(extra=b"retrained")
    old = active(first)
    new = active(second, model=OTHER)
    source = FakeSource({USER: old}, {old.path: first, new.path: second})
    models, loader = models_of(source, tmp_path)
    models.for_user(USER, PAGE)
    source.models[USER] = new
    models.for_user(USER, PAGE)
    source.models[USER] = old
    models.for_user(USER, PAGE)
    assert len(loader.paths) == 3


def test_pages_of_one_owner_read_at_once_load_the_model_once(tmp_path: Path) -> None:
    data = weights()
    model = active(data)
    source = FakeSource({USER: model}, {model.path: data}, delay=0.2)
    models, loader = models_of(source, tmp_path)
    found: list[tuple[object, str | None]] = []
    threads = [threading.Thread(target=lambda: found.append(models.for_user(USER, PAGE))) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(source.downloads) == 1
    assert len(loader.paths) == 1
    assert len({id(recognizer) for recognizer, _ in found}) == 1
    assert {model_id for _, model_id in found} == {MODEL}


def test_a_cached_model_reads_while_another_owner_waits_for_a_download(tmp_path: Path) -> None:
    data = weights()
    first = active(data)
    slow = active(data, user=OTHER, model=OTHER)
    source = FakeSource({USER: first, OTHER: slow}, {first.path: data, slow.path: data})
    models, _ = models_of(source, tmp_path)
    models.for_user(USER, PAGE)
    source.delay = 1.0
    waiting = threading.Thread(target=lambda: models.for_user(OTHER, PAGE))
    waiting.start()
    time.sleep(0.1)
    started = time.perf_counter()
    assert models.for_user(USER, PAGE)[1] == MODEL
    assert time.perf_counter() - started < 0.5
    waiting.join()
