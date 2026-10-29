import logging
import re
import shutil
import signal
import subprocess
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx2
from PIL import Image

from reading.harvest import Correction, Homophones, Sample, TileLine, harvest
from reading.photo import open_photo
from reading.store import secure
from reading.training import (
    MAX_MODEL_BYTES,
    MAX_SAMPLES,
    TRAIN_SECONDS,
    ModelError,
    ValidationSample,
    alphabet_of,
    best_checkpoint,
    best_weights,
    checked_model,
    faults_of,
    faults_written_correctly,
    is_safetensors,
    ketos_test_command,
    ketos_train_command,
    report_cer,
    sha256_of,
    sheet_samples,
)

SECRET_HEADER = "X-Training-Secret"  # noqa: S105
SECRET_VARIABLE = "TRAINING_SECRET"  # noqa: S105
IDLE_SECONDS = 60.0
TIMEOUT = 60.0
MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_PAGES = 300
MAX_B1_CHARS = 100_000
MAX_CORRECTIONS = 10_000
TEMPLATES = frozenset({"fr", "en"})
SHA256 = re.compile(r"^[0-9a-f]{64}$")
LANGUAGE = re.compile(r"^[a-z]{2}$")
SIGNED = re.compile(r"^/storage/v1/object/sign/(photos|models)/[0-9A-Za-z/._-]+\?token=[0-9A-Za-z._-]+$")
UPLOAD = re.compile(r"^/storage/v1/object/upload/sign/models/[0-9a-f/-]+\.safetensors\?token=[0-9A-Za-z._-]+$")
INTERRUPT_GRACE = 120.0
TEST_SECONDS = 600
TASK_SECONDS = 100 * 60
HARVEST_SECONDS = 40 * 60
RESERVE_SECONDS = 20 * 60
MIN_TRAIN_SECONDS = 10 * 60

log = logging.getLogger("reading.trainer")


class TaskError(Exception):
    pass


@dataclass(frozen=True)
class Page:
    photo: str
    b1: str
    language: str | None
    corrections: dict[int, Correction]


@dataclass(frozen=True)
class Task:
    task_id: str
    template: str
    test: tuple[str, str]
    model: tuple[str, str] | None
    pages: tuple[Page, ...]


def signed(value: object, bucket: str) -> str:
    if (
        not isinstance(value, str)
        or not SIGNED.match(value)
        or not value.startswith(f"/storage/v1/object/sign/{bucket}/")
    ):
        raise TaskError("bad address")
    if ".." in value.split("?", 1)[0]:
        raise TaskError("bad address")
    return value


def page_of(value: object) -> Page:
    if not isinstance(value, dict) or set(value) != {"photo", "b1", "language", "corrections"}:
        raise TaskError("bad page")
    b1 = value["b1"]
    language = value["language"]
    corrections = value["corrections"]
    if not isinstance(b1, str) or len(b1) > MAX_B1_CHARS:
        raise TaskError("bad page")
    if language is not None and (not isinstance(language, str) or not LANGUAGE.match(language)):
        raise TaskError("bad page")
    if not isinstance(corrections, list) or len(corrections) > MAX_CORRECTIONS:
        raise TaskError("bad page")
    found: dict[int, Correction] = {}
    for entry in corrections:
        if not isinstance(entry, dict) or set(entry) != {"token_index", "text", "reading_a"}:
            raise TaskError("bad correction")
        index, text, reading_a = entry["token_index"], entry["text"], entry["reading_a"]
        if not isinstance(index, int) or isinstance(index, bool) or index < 0 or not isinstance(text, str) or not text:
            raise TaskError("bad correction")
        if reading_a is not None and not isinstance(reading_a, str):
            raise TaskError("bad correction")
        found[index] = Correction(index, text, reading_a)
    return Page(signed(value["photo"], "photos"), b1, language, found)


def claimed_id(value: object) -> str | None:
    task = value.get("task") if isinstance(value, dict) else None
    task_id = task.get("task_id") if isinstance(task, dict) else None
    if not isinstance(task_id, str):
        return None
    try:
        return task_id if str(uuid.UUID(task_id)) == task_id else None
    except ValueError:
        return None


def task_of(value: object) -> Task | None:
    if not isinstance(value, dict) or set(value) != {"task"}:
        raise TaskError("bad answer")
    task = value["task"]
    if task is None:
        return None
    if not isinstance(task, dict) or set(task) != {"task_id", "template", "test", "model", "pages"}:
        raise TaskError("bad task")
    task_id, template, test, model, pages = (task[key] for key in ("task_id", "template", "test", "model", "pages"))
    if not isinstance(task_id, str) or str(uuid.UUID(task_id)) != task_id:
        raise TaskError("bad task")
    if template not in TEMPLATES or not isinstance(test, list) or len(test) != 2:
        raise TaskError("bad task")
    if not isinstance(pages, list) or len(pages) > MAX_PAGES:
        raise TaskError("bad task")
    active = None
    if model is not None:
        if not isinstance(model, dict) or set(model) != {"url", "sha256"}:
            raise TaskError("bad model")
        sha = model["sha256"]
        if not isinstance(sha, str) or not SHA256.match(sha):
            raise TaskError("bad model")
        active = (signed(model["url"], "models"), sha)
    return Task(
        task_id,
        str(template),
        (signed(test[0], "photos"), signed(test[1], "photos")),
        active,
        tuple(page_of(p) for p in pages),
    )


class Api(Protocol):
    def claim(self) -> Task | None: ...

    def download(self, address: str, target: Path, max_bytes: int) -> None: ...

    def upload(self, task_id: str, model: Path) -> None: ...

    def report(self, task_id: str, body: Mapping[str, object]) -> None: ...


class SupabaseApi:
    def __init__(self, url: str, secret: str, client: httpx2.Client | None = None) -> None:
        if not secure(url):
            raise ValueError("SUPABASE_URL is not an https address, nor http on the local stack")
        self._base = url.rstrip("/")
        self._secret = secret
        self._client = client or httpx2.Client(timeout=TIMEOUT, follow_redirects=False, trust_env=False)

    def _call(self, name: str, body: Mapping[str, object]) -> Any:
        response = self._client.post(
            f"{self._base}/functions/v1/{name}",
            json=dict(body),
            headers={SECRET_HEADER: self._secret},
        )
        if response.status_code != 200:
            raise TaskError(f"{name} answered {response.status_code}")
        return response.json()

    def claim(self) -> Task | None:
        answer = self._call("training-claim", {})
        try:
            return task_of(answer)
        except (TaskError, ValueError):
            task_id = claimed_id(answer)
            if task_id is not None:
                self.report(task_id, {"outcome": "failed"})
            raise

    def download(self, address: str, target: Path, max_bytes: int) -> None:
        received = 0
        with self._client.stream("GET", f"{self._base}{address}") as response:
            if response.status_code != 200:
                raise TaskError("download refused")
            with target.open("wb") as file:
                for chunk in response.iter_bytes():
                    received += len(chunk)
                    if received > max_bytes:
                        raise TaskError("download too large")
                    file.write(chunk)

    def upload(self, task_id: str, model: Path) -> None:
        answer = self._call("training-upload", {"task_id": task_id})
        address = answer.get("url") if isinstance(answer, dict) else None
        if not isinstance(address, str) or not UPLOAD.match(address) or f"/{task_id}.safetensors?" not in address:
            raise TaskError("bad upload address")
        response = self._client.put(
            f"{self._base}{address}",
            content=model.read_bytes(),
            headers={"Content-Type": "application/octet-stream", "x-upsert": "true"},
        )
        if response.status_code != 200:
            raise TaskError("upload refused")

    def report(self, task_id: str, body: Mapping[str, object]) -> None:
        response = self._client.post(
            f"{self._base}/functions/v1/training-report",
            json={"task_id": task_id, **body},
            headers={SECRET_HEADER: self._secret},
        )
        if response.status_code not in (200, 404, 409):
            raise TaskError(f"training-report answered {response.status_code}")


class LineReader(Protocol):
    def lines(self, photo: Image.Image) -> list[TileLine]: ...


class Machine(Protocol):
    def reader(self, model: Path) -> LineReader: ...

    def predict(self, model: Path, images: Sequence[Image.Image]) -> list[str]: ...

    def run(self, command: Sequence[str], timeout: float) -> tuple[int, str]: ...

    def convert(self, checkpoint: Path, target: Path) -> Path: ...

    def release(self) -> None: ...


@dataclass(frozen=True)
class Settings:
    generic: Path
    work: Path
    ketos: str
    device: str


def write_samples(folder: Path, samples: Sequence[Sample]) -> Path:
    folder.mkdir(parents=True)
    listed = []
    for index, sample in enumerate(samples):
        image = folder / f"{index:05d}.png"
        sample.image.save(image)
        image.with_suffix(".gt.txt").write_text(sample.text + "\n", encoding="utf-8")
        listed.append(str(image))
    listing = folder.with_suffix(".lst")
    listing.write_text("\n".join(listed) + "\n", encoding="utf-8")
    return listing


def open_downloaded(path: Path) -> Image.Image:
    return open_photo(path.read_bytes())


def train(
    machine: Machine, settings: Settings, folder: Path, train_list: Path, validation_list: Path, seconds: float
) -> Path:
    output = folder / "output"
    output.mkdir()
    command = ketos_train_command(
        settings.ketos, settings.generic, train_list, validation_list, output, settings.device
    )
    machine.run(command, seconds)
    weights = best_weights(output)
    if weights is None:
        checkpoint = best_checkpoint(output, folder)
        if checkpoint is None:
            raise TaskError("no model produced")
        weights = machine.convert(checkpoint, output / "best.safetensors")
    if not is_safetensors(weights) or weights.stat().st_size > MAX_MODEL_BYTES:
        raise TaskError("no usable model")
    return weights


def measure_cer(machine: Machine, settings: Settings, model: Path, validation_list: Path) -> float:
    code, report = machine.run(
        ketos_test_command(settings.ketos, model, validation_list, settings.device), TEST_SECONDS
    )
    if code != 0:
        raise TaskError("test failed")
    return report_cer(report)


def run_task(
    task: Task,
    api: Api,
    machine: Machine,
    settings: Settings,
    homophones: Homophones,
    clock: Callable[[], float] = time.monotonic,
) -> str:
    started = clock()
    folder = settings.work / task.task_id
    try:
        folder.mkdir(parents=True)
        base = settings.generic
        if task.model is not None:
            address, sha = task.model
            target = folder / "active.safetensors"
            api.download(address, target, MAX_MODEL_BYTES)
            base = checked_model(target, sha)
        reader = machine.reader(base)

        training: list[Sample] = []
        validation: list[ValidationSample] = []
        for sheet, address in enumerate(task.test, start=1):
            target = folder / f"sheet-{sheet}.jpg"
            api.download(address, target, MAX_PHOTO_BYTES)
            kept, checked = sheet_samples(task.template, sheet, reader.lines(open_downloaded(target)))
            training += kept
            validation += checked
        if not validation or not training:
            raise TaskError("the test gives no line")

        for page in task.pages:
            if len(training) >= MAX_SAMPLES or clock() - started >= HARVEST_SECONDS:
                break
            target = folder / "page.jpg"
            try:
                api.download(page.photo, target, MAX_PHOTO_BYTES)
                lines = reader.lines(open_downloaded(target))
            except Exception:
                log.info("page_skipped")
                continue
            training += harvest(page.b1, lines, page.corrections, page.language, homophones)
        training = training[:MAX_SAMPLES]
        del reader
        machine.release()
        seconds = min(TRAIN_SECONDS, TASK_SECONDS - RESERVE_SECONDS - (clock() - started))
        if seconds < MIN_TRAIN_SECONDS:
            raise TaskError("no time left to train")

        train_list = write_samples(folder / "train", training)
        validation_list = write_samples(folder / "validation", [v.sample for v in validation])
        model = train(machine, settings, folder, train_list, validation_list, seconds)

        cer = measure_cer(machine, settings, model, validation_list)
        base_cer = measure_cer(machine, settings, base, validation_list)
        images = [v.sample.image for v in validation]
        faults = faults_of(task.template)
        written = faults_written_correctly(machine.predict(model, images), validation, faults)
        base_written = faults_written_correctly(machine.predict(base, images), validation, faults)

        api.upload(task.task_id, model)
        api.report(
            task.task_id,
            {
                "outcome": "trained",
                "cer": round(cer, 6),
                "base_cer": round(base_cer, 6),
                "faults": written,
                "base_faults": base_written,
                "alphabet": alphabet_of(training),
                "samples": len(training),
                "sha256": sha256_of(model),
            },
        )
        log.info("task_trained samples=%d cer=%.4f base_cer=%.4f", len(training), cer, base_cer)
        return "trained"
    except Exception as error:
        log.info("task_failed error=%s", type(error).__name__)
        try:
            api.report(task.task_id, {"outcome": "failed"})
        except Exception as reporting:
            log.info("report_failed error=%s", type(reporting).__name__)
        return "failed"
    finally:
        shutil.rmtree(folder, ignore_errors=True)


class KrakenMachine:
    def __init__(self, accelerator: str) -> None:
        self._accelerator = accelerator

    def reader(self, model: Path) -> LineReader:
        from reading.recognition import Recognizer
        from reading.segmentation import Segmenter

        segmenter = Segmenter()
        recognizer = Recognizer(str(model), accelerator=self._accelerator)

        class Lines:
            def lines(self, photo: Image.Image) -> list[TileLine]:
                return [TileLine(line.image, tuple(recognizer.words(line.image))) for line in segmenter.lines(photo)]

        return Lines()

    def predict(self, model: Path, images: Sequence[Image.Image]) -> list[str]:
        from reading.recognition import Recognizer

        recognizer = Recognizer(str(model), accelerator=self._accelerator)
        return [" ".join(word.text for word in recognizer.words(image)) for image in images]

    def run(self, command: Sequence[str], timeout: float) -> tuple[int, str]:
        process = subprocess.Popen(  # noqa: S603
            list(command), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
        try:
            output, _ = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.send_signal(signal.SIGINT)
            try:
                output, _ = process.communicate(timeout=INTERRUPT_GRACE)
            except subprocess.TimeoutExpired:
                process.kill()
                output, _ = process.communicate()
        return process.returncode, output or ""

    def convert(self, checkpoint: Path, target: Path) -> Path:
        from kraken.models.convert import convert_models

        return Path(convert_models([str(checkpoint)], str(target)))

    def release(self) -> None:
        import gc

        import torch

        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def generic_model(path: Path) -> Path:
    from reading.training import GENERIC_SHA256

    return checked_model(path, GENERIC_SHA256)


def serve(
    api: Api, machine: Machine, settings: Settings, homophones: Homophones, idle: float, stop: Callable[[], bool]
) -> None:
    while not stop():
        try:
            task = api.claim()
        except Exception as error:
            log.info("claim_failed error=%s", type(error).__name__)
            task = None
        if task is None:
            time.sleep(idle)
            continue
        run_task(task, api, machine, settings, homophones)


def homophones_of(espeak_dir: str | None) -> Homophones:
    from reading.phonemes import Espeak

    espeak = Espeak(espeak_dir)

    def same_sound(a: str, b: str, language: str) -> bool:
        first, second = espeak.phonemes([a, b], language)
        return bool(first) and first == second

    return same_sound


def clear(work: Path) -> None:
    for child in work.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


def main() -> int:
    import os
    import sys

    from reading.secret import SecretError, check_secret

    try:
        secret = check_secret(os.environ.get(SECRET_VARIABLE, ""), SECRET_VARIABLE)
        api = SupabaseApi(os.environ.get("SUPABASE_URL", ""), secret)
        generic = generic_model(Path(os.environ.get("TRAINING_MODEL", "")))
    except (SecretError, ValueError, ModelError, OSError) as error:
        print(error, file=sys.stderr)
        return 1
    work = Path(os.environ.get("TRAINING_WORK", "/work"))
    if not work.is_dir():
        print("TRAINING_WORK does not name a folder", file=sys.stderr)
        return 1
    clear(work)
    device = os.environ.get("TRAINING_DEVICE", "cuda:0")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    logging.getLogger("httpx2").setLevel(logging.WARNING)
    stopping: list[bool] = []
    signal.signal(signal.SIGTERM, lambda *_: stopping.append(True))
    settings = Settings(generic=generic, work=work, ketos="ketos", device=device)
    machine = KrakenMachine("gpu" if device.startswith("cuda") else "cpu")
    serve(
        api,
        machine,
        settings,
        homophones_of(os.environ.get("READING_ESPEAK_DIR") or None),
        IDLE_SECONDS,
        lambda: bool(stopping),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
