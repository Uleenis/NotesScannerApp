import logging
import os
import sys

import uvicorn

from reading.app import create_app
from reading.secret import SecretError, load_secret

MODEL_VARIABLE = "READING_MODEL"


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
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")

    from reading.recognition import Reader, Recognizer
    from reading.segmentation import Segmenter

    reader = Reader(Segmenter(), Recognizer(model))
    uvicorn.run(
        create_app(secret, reader),
        host="0.0.0.0",  # noqa: S104
        port=int(os.environ.get("PORT", "8080")),
        access_log=False,
        server_header=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
