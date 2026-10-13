import hashlib
import os
from importlib import resources
from pathlib import Path

MEDIUM_SHA256 = "15313b51ace64cbfa81f8f6ef25ad64f04e5a6fb7f7823e67b107527bc081ac9"


def test_the_service_does_not_run_as_root() -> None:
    assert os.getuid() != 0
    assert os.getgid() != 0


def test_the_image_carries_the_generic_recognition_model() -> None:
    model = Path(os.environ["READING_MODEL"])
    assert model.name == "medium.safetensors"
    assert hashlib.sha256(model.read_bytes()).hexdigest() == MEDIUM_SHA256


def test_the_service_cannot_change_its_model() -> None:
    model = Path(os.environ["READING_MODEL"])
    assert not os.access(model, os.W_OK)
    assert not os.access(model.parent, os.W_OK)


def test_the_image_carries_the_kraken_segmenter() -> None:
    assert resources.files("kraken").joinpath("blla.mlmodel").is_file()


def test_the_image_carries_no_local_secret_file() -> None:
    assert not any(path.name == ".env" for path in Path("/app").rglob(".env"))
