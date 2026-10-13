import os
import sys

import uvicorn

from reading.app import create_app
from reading.secret import SecretError, load_secret


def main() -> int:
    try:
        secret = load_secret(os.environ)
    except SecretError as error:
        print(error, file=sys.stderr)
        return 1
    uvicorn.run(
        create_app(secret),
        host="0.0.0.0",  # noqa: S104
        port=int(os.environ.get("PORT", "8080")),
        access_log=False,
        server_header=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
