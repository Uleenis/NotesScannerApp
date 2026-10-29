import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

import uvicorn

from reading.app import create_app
from reading.secret import SecretError, load_secret
from reading.store import Store, SupabaseStore

if TYPE_CHECKING:
    from reading.arbiter import Arbiter

MODEL_VARIABLE = "READING_MODEL"
NER_VARIABLE = "READING_NER"
ESPEAK_VARIABLE = "READING_ESPEAK_DIR"
URL_VARIABLE = "SUPABASE_URL"
KEY_VARIABLE = "SUPABASE_SERVICE_ROLE_KEY"


def arbiter_of(store: Store, ner: Path, espeak_dir: str | None) -> "Arbiter":
    from reading.arbiter import Arbiter
    from reading.entities import Camembert
    from reading.language import Lingua
    from reading.phonemes import Espeak
    from reading.rules import Rules

    return Arbiter(store, Lingua(), Rules(Espeak(espeak_dir), Camembert(ner)))


def main() -> int:
    try:
        secret = load_secret(os.environ)
    except SecretError as error:
        print(error, file=sys.stderr)
        return 1
    model = os.environ.get(MODEL_VARIABLE, "")
    if not os.path.isfile(model):
        print(f"{MODEL_VARIABLE} does not name a model file", file=sys.stderr)
        return 1
    ner = os.environ.get(NER_VARIABLE, "")
    if not os.path.isdir(ner):
        print(f"{NER_VARIABLE} does not name a folder", file=sys.stderr)
        return 1

    try:
        store = SupabaseStore(os.environ.get(URL_VARIABLE, ""), os.environ.get(KEY_VARIABLE, ""))
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    logging.getLogger("httpx2").setLevel(logging.WARNING)

    from reading.personal import Models, entry_of
    from reading.recognition import Reader, Recognizer
    from reading.segmentation import Segmenter

    reader = Reader(Segmenter(), Recognizer(model))
    models = Models(
        store, lambda path: Recognizer(str(path)), entry_of(Path(model)), Path(tempfile.mkdtemp(prefix="models-"))
    )
    arbiter = arbiter_of(store, Path(ner), os.environ.get(ESPEAK_VARIABLE) or None)
    uvicorn.run(
        create_app(secret, reader, arbiter, models),
        host="0.0.0.0",  # noqa: S104
        port=int(os.environ.get("PORT", "8080")),
        access_log=False,
        server_header=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
