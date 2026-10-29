import io
import struct
from collections.abc import Mapping, Sequence
from pathlib import Path

import httpx2
import pytest
from PIL import Image

from reading.harvest import TileLine
from reading.recognition import TileWord
from reading.trainer import (
    LineReader,
    Settings,
    SupabaseApi,
    Task,
    TaskError,
    page_of,
    run_task,
    task_of,
)
from reading.training import sha256_of
from reading.writing_test import sheet_lines

TASK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
PHOTO = "/storage/v1/object/sign/photos/u/p/original.jpg?token=t"
SHEET_1 = "/storage/v1/object/sign/photos/u/writing-tests/t/1.jpg?token=a"
SHEET_2 = "/storage/v1/object/sign/photos/u/writing-tests/t/2.jpg?token=b"
MODEL = "/storage/v1/object/sign/models/u/m.safetensors?token=m"


def jpeg(marker: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("L", (64, 32), marker).save(buffer, format="JPEG")
    return buffer.getvalue()


def weights_bytes() -> bytes:
    header = b'{"w": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}'
    return struct.pack("<Q", len(header)) + header + b"\x00\x00\x80\x3f"


def tiles(lines: Sequence[str]) -> list[TileLine]:
    return [
        TileLine(Image.new("L", (400, 30), 255), tuple(TileWord(w, 0.0, 10.0, 0.9) for w in line.split()))
        for line in lines
    ]


class FakeApi:
    def __init__(self, files: Mapping[str, bytes]) -> None:
        self.files = dict(files)
        self.uploads: list[tuple[str, bytes]] = []
        self.reports: list[dict[str, object]] = []

    def claim(self) -> Task | None:
        return None

    def download(self, address: str, target: Path, max_bytes: int) -> None:
        if address not in self.files:
            raise TaskError("download refused")
        data = self.files[address]
        if len(data) > max_bytes:
            raise TaskError("download too large")
        target.write_bytes(data)

    def upload(self, task_id: str, model: Path) -> None:
        self.uploads.append((task_id, model.read_bytes()))

    def report(self, task_id: str, body: Mapping[str, object]) -> None:
        self.reports.append({"task_id": task_id, **body})


class Reader:
    def __init__(self, machine: "FakeMachine") -> None:
        self.machine = machine

    def lines(self, photo: Image.Image) -> list[TileLine]:
        marker = photo.convert("L").getpixel((0, 0))
        assert isinstance(marker, int)
        if marker < 60:
            return tiles(sheet_lines("fr", 1))
        if marker < 140:
            return tiles(sheet_lines("fr", 2))
        return tiles(["Le chat dort"])


class FakeMachine:
    def __init__(self, folder_seen: list[Path], produce: bool = True) -> None:
        self.readers: list[Path] = []
        self.commands: list[list[str]] = []
        self.folder_seen = folder_seen
        self.produce = produce
        self.converted: list[Path] = []

    def reader(self, model: Path) -> LineReader:
        self.readers.append(model)
        return Reader(self)

    def predict(self, model: Path, images: Sequence[Image.Image]) -> list[str]:
        return ["x"] * len(images)

    def run(self, command: Sequence[str], timeout: float) -> tuple[int, str]:
        self.commands.append(list(command))
        if "train" in command:
            output = Path(command[command.index("-o") + 1])
            self.folder_seen.append(output.parent)
            if self.produce:
                (output / "best_0.9100.safetensors").write_bytes(weights_bytes())
            return 0, ""
        model = command[command.index("-m") + 1]
        errors = 10 if model.endswith("best_0.9100.safetensors") else 30
        return 0, f"100\tCharacters\n{errors}\tErrors\n"

    def convert(self, checkpoint: Path, target: Path) -> Path:
        self.converted.append(checkpoint)
        target.write_bytes(weights_bytes())
        return target


def settings(tmp_path: Path) -> Settings:
    generic = tmp_path / "medium.safetensors"
    generic.write_bytes(weights_bytes())
    work = tmp_path / "work"
    work.mkdir()
    return Settings(generic=generic, work=work, ketos="ketos", device="cuda:0")


def task(model: tuple[str, str] | None = None) -> Task:
    return Task(
        TASK_ID,
        "fr",
        (SHEET_1, SHEET_2),
        model,
        (page_of({"photo": PHOTO, "b1": "Le chat dort", "language": "fr", "corrections": []}),),
    )


FILES = {SHEET_1: jpeg(20), SHEET_2: jpeg(100), PHOTO: jpeg(200)}


def never(a: str, b: str, language: str) -> bool:
    return False


def test_a_task_trains_measures_uploads_reports_and_erases_its_folder(tmp_path: Path) -> None:
    api = FakeApi(FILES)
    seen: list[Path] = []
    machine = FakeMachine(seen)
    config = settings(tmp_path)
    assert run_task(task(), api, machine, config, never) == "trained"
    assert [upload[0] for upload in api.uploads] == [TASK_ID]
    report = api.reports[0]
    assert report["outcome"] == "trained"
    assert (report["cer"], report["base_cer"]) == (0.1, 0.3)
    assert report["samples"] == 31
    assert report["sha256"] == sha256_of_bytes(weights_bytes())
    assert machine.readers == [config.generic]
    train = next(command for command in machine.commands if "train" in command)
    assert train[train.index("-i") + 1] == str(config.generic)
    assert seen and not seen[0].exists()
    assert list(config.work.iterdir()) == []


def sha256_of_bytes(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()


def test_the_active_model_reads_the_pages_once_its_fingerprint_is_checked(tmp_path: Path) -> None:
    api = FakeApi({**FILES, MODEL: weights_bytes()})
    machine = FakeMachine([])
    config = settings(tmp_path)
    assert run_task(task((MODEL, sha256_of_bytes(weights_bytes()))), api, machine, config, never) == "trained"
    assert machine.readers[0].name == "active.safetensors"
    train = next(command for command in machine.commands if "train" in command)
    assert train[train.index("-i") + 1] == str(config.generic)


def test_an_active_model_with_a_wrong_fingerprint_fails_the_task_and_is_never_read(tmp_path: Path) -> None:
    api = FakeApi({**FILES, MODEL: weights_bytes()})
    machine = FakeMachine([])
    config = settings(tmp_path)
    assert run_task(task((MODEL, "0" * 64)), api, machine, config, never) == "failed"
    assert machine.readers == []
    assert api.reports == [{"task_id": TASK_ID, "outcome": "failed"}]
    assert api.uploads == []
    assert list(config.work.iterdir()) == []


def test_a_training_that_produces_nothing_fails_and_erases_its_folder(tmp_path: Path) -> None:
    api = FakeApi(FILES)
    seen: list[Path] = []
    config = settings(tmp_path)
    assert run_task(task(), api, FakeMachine(seen, produce=False), config, never) == "failed"
    assert api.reports == [{"task_id": TASK_ID, "outcome": "failed"}]
    assert list(config.work.iterdir()) == []


def test_a_page_that_cannot_be_read_is_skipped(tmp_path: Path) -> None:
    files = {**FILES, PHOTO: b"not a jpeg"}
    api = FakeApi(files)
    assert run_task(task(), api, FakeMachine([]), settings(tmp_path), never) == "trained"
    assert api.reports[0]["samples"] == 30


def test_a_missing_test_photo_fails_the_task(tmp_path: Path) -> None:
    api = FakeApi({SHEET_1: FILES[SHEET_1], PHOTO: FILES[PHOTO]})
    assert run_task(task(), api, FakeMachine([]), settings(tmp_path), never) == "failed"


def answer(**task: object) -> dict[str, object]:
    base: dict[str, object] = {
        "task_id": TASK_ID,
        "template": "fr",
        "test": [SHEET_1, SHEET_2],
        "model": None,
        "pages": [],
    }
    base.update(task)
    return {"task": base}


def test_a_task_from_the_server_is_read_strictly() -> None:
    assert task_of({"task": None}) is None
    parsed = task_of(answer(model={"url": MODEL, "sha256": "a" * 64}))
    assert parsed is not None and parsed.model == (MODEL, "a" * 64)


@pytest.mark.parametrize(
    "bad",
    [
        {"test": ["https://evil.test/x.jpg?token=a", SHEET_2]},
        {"test": ["/storage/v1/object/sign/photos/../../x?token=a", SHEET_2]},
        {"test": [MODEL, SHEET_2]},
        {"model": {"url": PHOTO, "sha256": "a" * 64}},
        {"model": {"url": "/storage/v1/object/sign/models/u/m.ckpt?token=m", "sha256": "A" * 64}},
        {"template": "de"},
        {"task_id": "not-a-uuid"},
        {"pages": [{"photo": PHOTO, "b1": "x", "language": "fr", "corrections": [], "user_id": "u"}]},
        {"pages": [{"photo": "//evil.test/x.jpg", "b1": "x", "language": "fr", "corrections": []}]},
        {
            "pages": [
                {
                    "photo": PHOTO,
                    "b1": "x",
                    "language": "fr",
                    "corrections": [{"token_index": -1, "text": "a", "reading_a": None}],
                }
            ]
        },
        {"extra": 1},
    ],
)
def test_a_task_that_names_anything_else_is_refused(bad: dict[str, object]) -> None:
    with pytest.raises((TaskError, ValueError)):
        task_of(answer(**bad))


def test_the_api_sends_its_secret_follows_no_redirect_and_only_talks_to_its_own_supabase(tmp_path: Path) -> None:
    calls: list[httpx2.Request] = []

    def respond(request: httpx2.Request) -> httpx2.Response:
        calls.append(request)
        if request.url.path == "/functions/v1/training-claim":
            return httpx2.Response(200, json={"task": None})
        return httpx2.Response(302, headers={"location": "https://evil.test/"})

    client = httpx2.Client(transport=httpx2.MockTransport(respond), follow_redirects=False)
    api = SupabaseApi("https://project.supabase.co", "s" * 40, client)
    assert api.claim() is None
    assert calls[0].headers["x-training-secret"] == "s" * 40
    assert str(calls[0].url) == "https://project.supabase.co/functions/v1/training-claim"
    with pytest.raises(TaskError):
        api.download(PHOTO, tmp_path / "x.jpg", 100)
    assert str(calls[1].url).startswith("https://project.supabase.co/storage/v1/object/sign/photos/")
    assert len(calls) == 2


def test_the_api_refuses_a_plain_http_address_off_the_local_stack() -> None:
    with pytest.raises(ValueError, match="https"):
        SupabaseApi("http://project.supabase.co", "s" * 40)


def test_a_download_above_its_bound_is_refused(tmp_path: Path) -> None:
    client = httpx2.Client(transport=httpx2.MockTransport(lambda request: httpx2.Response(200, content=b"x" * 200)))
    api = SupabaseApi("http://127.0.0.1:54321", "s" * 40, client)
    with pytest.raises(TaskError, match="too large"):
        api.download(PHOTO, tmp_path / "x.jpg", 100)


def test_an_upload_address_for_another_file_is_refused(tmp_path: Path) -> None:
    other = "/storage/v1/object/upload/sign/models/u/dddddddd-dddd-4ddd-8ddd-dddddddddddd.safetensors?token=u"
    client = httpx2.Client(transport=httpx2.MockTransport(lambda request: httpx2.Response(200, json={"url": other})))
    api = SupabaseApi("http://127.0.0.1:54321", "s" * 40, client)
    model = tmp_path / "m.safetensors"
    model.write_bytes(weights_bytes())
    with pytest.raises(TaskError, match="upload address"):
        api.upload(TASK_ID, model)


def test_the_fingerprint_helper_hashes_the_file(tmp_path: Path) -> None:
    path = tmp_path / "m.safetensors"
    path.write_bytes(weights_bytes())
    assert sha256_of(path) == sha256_of_bytes(weights_bytes())
