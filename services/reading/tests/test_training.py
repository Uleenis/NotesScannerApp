import json
import struct
from pathlib import Path

import pytest
from PIL import Image

from reading.harvest import Sample, TileLine
from reading.recognition import TileWord
from reading.training import (
    ModelError,
    ValidationSample,
    alphabet_of,
    best_checkpoint,
    checked_model,
    faults_of,
    faults_written_correctly,
    ketos_test_command,
    ketos_train_command,
    report_cer,
    sha256_of,
    sheet_samples,
)
from reading.writing_test import sheet_lines


def weights(path: Path, header: bytes = b'{"w": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}') -> Path:
    path.write_bytes(struct.pack("<Q", len(header)) + header + b"\x00\x00\x80\x3f")
    return path


def tile(text: str) -> TileLine:
    return TileLine(Image.new("L", (400, 30), 255), tuple(TileWord(word, 0.0, 10.0, 0.9) for word in text.split()))


def test_training_keeps_every_setting_of_the_spikes() -> None:
    command = ketos_train_command(
        "ketos", Path("/models/medium.safetensors"), Path("t.lst"), Path("v.lst"), Path("out"), "cuda:0"
    )
    assert command == [
        "ketos", "--device", "cuda:0", "--precision", "bf16-mixed", "train",
        "-f", "path", "-t", "t.lst", "-e", "v.lst", "-i", "/models/medium.safetensors",
        "--resize", "new", "--arch", "ppocrv6", "--variant", "medium", "--max-width", "1600",
        "-B", "2", "--augment", "-r", "0.0003", "--warmup", "200", "-N", "120", "-q", "fixed", "-o", "out",
    ]  # fmt: skip


def test_the_validation_cer_is_measured_by_ketos_test() -> None:
    assert ketos_test_command("ketos", Path("m.safetensors"), Path("v.lst"), "cuda:0") == [
        "ketos", "--device", "cuda:0", "test", "-f", "path", "-m", "m.safetensors", "-e", "v.lst",
    ]  # fmt: skip
    report = "=== report m ===\n\n400\tCharacters\n52\tErrors\n87.00%\tCharacter Accuracy\n"
    assert report_cer(report) == pytest.approx(0.13)


def test_a_report_without_counts_is_an_error() -> None:
    with pytest.raises(ValueError, match="no character error rate"):
        report_cer("0\tCharacters\n0\tErrors\n")


def test_a_model_is_loaded_only_as_safetensors_with_its_fingerprint(tmp_path: Path) -> None:
    good = weights(tmp_path / "model.safetensors")
    assert checked_model(good, sha256_of(good)) == good
    with pytest.raises(ModelError, match="fingerprint"):
        checked_model(good, "0" * 64)
    checkpoint = weights(tmp_path / "model.ckpt")
    with pytest.raises(ModelError, match="not a weights file"):
        checked_model(checkpoint, sha256_of(checkpoint))
    pickled = tmp_path / "pickled.safetensors"
    pickled.write_bytes(b"\x80\x04\x95" + b"\x00" * 64)
    with pytest.raises(ModelError, match="not a safetensors"):
        checked_model(pickled, sha256_of(pickled))
    link = tmp_path / "link.safetensors"
    link.symlink_to(good)
    with pytest.raises(ModelError):
        checked_model(link, sha256_of(good))


def test_only_a_checkpoint_of_the_task_folder_is_ever_converted(tmp_path: Path) -> None:
    task = tmp_path / "task"
    output = task / "output"
    output.mkdir(parents=True)
    (output / "checkpoint_03-0.8100.ckpt").write_bytes(b"x")
    (output / "checkpoint_07-0.9200.ckpt").write_bytes(b"x")
    (output / "checkpoint_09-0.9000.ckpt").write_bytes(b"x")
    (output / "other.ckpt").write_bytes(b"x")
    assert best_checkpoint(output, task) == (output / "checkpoint_07-0.9200.ckpt").resolve()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "checkpoint_99-0.9900.ckpt").write_bytes(b"x")
    (output / "checkpoint_99-0.9999.ckpt").symlink_to(elsewhere / "checkpoint_99-0.9900.ckpt")
    with pytest.raises(ModelError, match="outside the task"):
        best_checkpoint(output, task)
    with pytest.raises(ModelError, match="outside the task"):
        best_checkpoint(elsewhere, task)


def test_the_test_sheets_give_training_and_validation_lines_as_printed() -> None:
    first = sheet_lines("fr", 1)
    second = sheet_lines("fr", 2)
    training, validation = sheet_samples("fr", 1, [tile(line) for line in first])
    assert [sample.text for sample in training] == list(first)
    assert validation == []
    training, validation = sheet_samples("fr", 2, [tile(line) for line in second])
    assert [sample.text for sample in training] == list(second[:10])
    assert [v.sample.text for v in validation] == list(second[10:])
    assert next(v.lines for v in validation) == range(31, 32)


def test_a_test_line_read_too_badly_or_across_the_two_parts_is_left_out() -> None:
    second = list(sheet_lines("fr", 2))
    tiles = (
        [tile(line) for line in second[:9]]
        + [tile(second[9] + " " + second[10])]
        + [tile("#" * 40)]
        + [tile(line) for line in second[12:]]
    )
    training, validation = sheet_samples("fr", 2, tiles)
    assert len(training) == 9
    assert [v.sample.text for v in validation] == second[12:]


def test_a_test_line_keeps_its_tile() -> None:
    lines = [tile(line) for line in sheet_lines("en", 1)]
    training, _ = sheet_samples("en", 1, lines)
    assert all(sample.image is line.image for sample, line in zip(training, lines, strict=True))


def test_a_fault_counts_when_the_model_writes_its_correct_form() -> None:
    faults = faults_of("fr")
    first = faults[0]
    printed = sheet_lines("fr", 2)[first.line - 21]
    sample = ValidationSample(Sample(Image.new("L", (10, 10)), printed), range(first.line, first.line + 1))
    corrected = printed.replace(first.written, first.correct, 1)
    assert faults_written_correctly([printed], [sample], faults) == 0
    assert faults_written_correctly([corrected], [sample], faults) == 1


def test_a_fault_of_two_words_is_counted_as_its_words() -> None:
    fault = next(f for f in faults_of("fr") if " " in f.written)
    printed = sheet_lines("fr", 2)[fault.line - 21]
    sample = ValidationSample(Sample(Image.new("L", (10, 10)), printed), range(fault.line, fault.line + 1))
    assert faults_written_correctly([printed.replace(fault.written, fault.correct, 1)], [sample], [fault]) == 1


def test_each_template_lists_eight_faults_on_validation_lines() -> None:
    texts = json.loads(
        (Path(__file__).parents[1] / "src" / "reading" / "writing_test_texts.json").read_text(encoding="utf-8")
    )
    for template in ("fr", "en"):
        faults = faults_of(template)
        assert len(faults) == 8
        assert all(31 <= fault.line <= 40 for fault in faults)
        assert all(fault.written in texts[template]["lines"][fault.line - 1] for fault in faults)


def test_the_alphabet_is_the_characters_of_the_training_lines() -> None:
    assert alphabet_of([Sample(Image.new("L", (1, 1)), "abc"), Sample(Image.new("L", (1, 1)), "cd é")]) == 6
