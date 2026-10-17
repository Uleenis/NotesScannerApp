import logging
import os
import sys
from pathlib import Path

import uvicorn

from reading.app import create_app
from reading.secret import SecretError, load_secret
from reading.store import SupabaseStore

MODEL_VARIABLE = "READING_MODEL"
NER_VARIABLE = "READING_NER"
ESPEAK_VARIABLE = "READING_ESPEAK_DIR"
URL_VARIABLE = "SUPABASE_URL"
KEY_VARIABLE = "SUPABASE_SERVICE_ROLE_KEY"


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

    from reading.arbiter import Arbiter
    from reading.entities import Camembert
    from reading.language import Lingua
    from reading.phonemes import Espeak
    from reading.recognition import Reader, Recognizer
    from reading.rules import Rules
    from reading.segmentation import Segmenter

    reader = Reader(Segmenter(), Recognizer(model))
    rules = Rules(Espeak(os.environ.get(ESPEAK_VARIABLE) or None), Camembert(Path(ner)))
    uvicorn.run(
        create_app(secret, reader, Arbiter(store, Lingua(), rules)),
        host="0.0.0.0",  # noqa: S104
        port=int(os.environ.get("PORT", "8080")),
        access_log=False,
        server_header=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
