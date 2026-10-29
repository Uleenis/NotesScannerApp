import hashlib
import json
import re
import struct
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from reading.harvest import Sample, TileLine
from reading.tokens import tokens_of
from reading.writing_test import (
    BREAK,
    MAX_CER,
    SHEET_LINES,
    TEXTS,
    TRAINING_LINES,
    cer,
    cut,
    line_of,
    sheet_lines,
)

GENERIC_SHA256 = "15313b51ace64cbfa81f8f6ef25ad64f04e5a6fb7f7823e67b107527bc081ac9"
MAX_MODEL_BYTES = 100 * 1024 * 1024
MAX_HEADER_BYTES = 16 * 1024 * 1024
MAX_SAMPLES = 20_000
TRAIN_SECONDS = 60 * 60
WEIGHTS = ".safetensors"
CHECKPOINT = re.compile(r"^checkpoint_\d+-(\d+\.\d+)\.ckpt$")
BEST = re.compile(r"^best_(\d+\.\d+)\.safetensors$")
CHARACTERS = re.compile(r"^(\d+)\s+Characters$", re.MULTILINE)
ERRORS = re.compile(r"^(\d+)\s+Errors$", re.MULTILINE)


class ModelError(Exception):
    pass


@dataclass(frozen=True)
class Fault:
    line: int
    written: str
    correct: str


@dataclass(frozen=True)
class ValidationSample:
    sample: Sample
    lines: range


def faults_of(template: str) -> list[Fault]:
    texts = json.loads(TEXTS.read_text(encoding="utf-8"))
    return [Fault(f["line"], f["written"], f["correct"]) for f in texts[template]["faults"]]


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def header_of(path: Path) -> dict[str, object] | None:
    size = path.stat().st_size
    if size < 10 or size > MAX_MODEL_BYTES:
        return None
    with path.open("rb") as file:
        (length,) = struct.unpack("<Q", file.read(8))
        if length < 2 or length > MAX_HEADER_BYTES or 8 + length > size:
            return None
        header = file.read(length)
    try:
        parsed = json.loads(header)
    except (UnicodeDecodeError, ValueError, RecursionError):
        return None
    return parsed if isinstance(parsed, dict) else None


def is_safetensors(path: Path) -> bool:
    return header_of(path) is not None


def checked_model(path: Path, sha256: str) -> Path:
    if path.suffix != WEIGHTS or not path.is_file() or path.is_symlink():
        raise ModelError("not a weights file")
    if not is_safetensors(path):
        raise ModelError("not a safetensors file")
    if sha256_of(path) != sha256:
        raise ModelError("fingerprint mismatch")
    return path


def own_checkpoint(path: Path, task_dir: Path) -> Path:
    resolved = path.resolve()
    if path.is_symlink() or not resolved.is_relative_to(task_dir.resolve()) or not CHECKPOINT.match(path.name):
        raise ModelError("checkpoint outside the task")
    return resolved


def best_checkpoint(output: Path, task_dir: Path) -> Path | None:
    found = [
        (float(match.group(1)), path)
        for path in output.glob("checkpoint_*.ckpt")
        if (match := CHECKPOINT.match(path.name))
    ]
    if not found:
        return None
    return own_checkpoint(max(found, key=lambda item: (item[0], item[1].name))[1], task_dir)


def best_weights(output: Path) -> Path | None:
    found = [
        (float(match.group(1)), path) for path in output.glob(f"best_*{WEIGHTS}") if (match := BEST.match(path.name))
    ]
    return max(found, key=lambda item: (item[0], item[1].name))[1] if found else None


def ketos_train_command(
    ketos: str, base: Path, train_list: Path, validation_list: Path, output: Path, device: str
) -> list[str]:
    return [
        ketos,
        "--device",
        device,
        "--precision",
        "bf16-mixed",
        "train",
        "-f",
        "path",
        "-t",
        str(train_list),
        "-e",
        str(validation_list),
        "-i",
        str(base),
        "--resize",
        "new",
        "--arch",
        "ppocrv6",
        "--variant",
        "medium",
        "--max-width",
        "1600",
        "-B",
        "2",
        "--augment",
        "-r",
        "0.0003",
        "--warmup",
        "200",
        "-N",
        "120",
        "-q",
        "fixed",
        "-o",
        str(output),
    ]


def ketos_test_command(ketos: str, model: Path, validation_list: Path, device: str) -> list[str]:
    return [ketos, "--device", device, "test", "-f", "path", "-m", str(model), "-e", str(validation_list)]


def report_cer(report: str) -> float:
    characters = CHARACTERS.search(report)
    errors = ERRORS.search(report)
    if characters is None or errors is None or int(characters.group(1)) == 0:
        raise ValueError("no character error rate in the report")
    return int(errors.group(1)) / int(characters.group(1))


def sheet_samples(template: str, sheet: int, lines: Sequence[TileLine]) -> tuple[list[Sample], list[ValidationSample]]:
    reference_lines = sheet_lines(template, sheet)
    read = [(" ".join(word.text for word in line.words), line) for line in lines]
    read = [(text, line) for text, line in read if text]
    if not read:
        return [], []
    reference = BREAK.join(reference_lines)
    starts = []
    offset = 0
    for printed in reference_lines:
        starts.append(offset)
        offset += len(printed) + 1
    first_line = (sheet - 1) * SHEET_LINES
    training: list[Sample] = []
    validation: list[ValidationSample] = []
    for (text, line), piece in zip(read, cut(reference, [text for text, _ in read]), strict=True):
        if piece.first < 0 or cer(text, piece.text) > MAX_CER:
            continue
        begins = first_line + line_of(starts, piece.first)
        ends = first_line + line_of(starts, piece.last)
        if ends < TRAINING_LINES:
            training.append(Sample(line.image, piece.text))
        elif begins >= TRAINING_LINES:
            validation.append(ValidationSample(Sample(line.image, piece.text), range(begins + 1, ends + 2)))
    return training, validation


def occurrences(text: str, phrase: str) -> int:
    words = [token.form for token in tokens_of(text)]
    wanted = [token.form for token in tokens_of(phrase)]
    if not wanted:
        return 0
    return sum(words[start : start + len(wanted)] == wanted for start in range(len(words) - len(wanted) + 1))


def faults_written_correctly(
    predictions: Sequence[str], validation: Sequence[ValidationSample], faults: Sequence[Fault]
) -> int:
    written = 0
    for fault in faults:
        for predicted, sample in zip(predictions, validation, strict=True):
            if fault.line not in sample.lines:
                continue
            if occurrences(predicted, fault.correct) > occurrences(sample.sample.text, fault.correct):
                written += 1
                break
    return written


def alphabet_of(samples: Sequence[Sample]) -> int:
    return len({character for sample in samples for character in sample.text})
