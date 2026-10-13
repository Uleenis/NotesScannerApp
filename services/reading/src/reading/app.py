import hmac
import logging
import re
import time

from fastapi import FastAPI, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from reading.alto import alto_of
from reading.photo import MAX_BYTES, RefusalError, open_photo, too_large, unsupported
from reading.recognition import Box, PageReader, Reading
from reading.secret import check_secret

GATE_HEADER = "X-Reading-Secret"
PHOTO_TYPE = "image/jpeg"
QUERY = re.compile(r"page_id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")

log = logging.getLogger("reading")


class SecretGate:
    def __init__(self, app: ASGIApp, secret: str) -> None:
        self._app = app
        self._secret = check_secret(secret).encode()
        self._header = GATE_HEADER.lower().encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self._app(scope, receive, send)
            return
        if scope["type"] == "http" and self._allowed(scope):
            await self._app(scope, receive, send)
            return
        if scope["type"] == "http":
            await JSONResponse({"error": "unauthorized"}, status_code=401)(scope, receive, send)

    def _allowed(self, scope: Scope) -> bool:
        values = [value for name, value in scope["headers"] if name == self._header]
        return len(values) == 1 and hmac.compare_digest(values[0], self._secret)


def page_of(request: Request) -> str:
    found = QUERY.fullmatch(request.url.query)
    if found is None:
        raise RefusalError(400, "invalid_request")
    return found.group(1)


def check_type(request: Request) -> None:
    types = request.headers.getlist("content-type")
    if types != [PHOTO_TYPE]:
        raise unsupported()


async def body_of(request: Request) -> bytes:
    lengths = request.headers.getlist("content-length")
    if any(not length.isdigit() or int(length) > MAX_BYTES for length in lengths):
        raise too_large()
    received = bytearray()
    async for chunk in request.stream():
        received += chunk
        if len(received) > MAX_BYTES:
            raise too_large()
    return bytes(received)


def listed(box: Box) -> list[int]:
    return list(box)


def answer(page_id: str, reading: Reading, alto: str) -> dict[str, object]:
    return {
        "page_id": page_id,
        "width": reading.width,
        "height": reading.height,
        "lines": [
            {
                "row": line.row,
                "box": listed(line.box),
                "ink": listed(line.ink),
                "words": [
                    {"text": word.text, "box": listed(word.box), "confidence": word.confidence} for word in line.words
                ],
            }
            for line in reading.lines
        ],
        "alto": alto,
    }


def create_app(secret: str, reader: PageReader) -> FastAPI:
    check_secret(secret)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/recognize")
    async def recognize(request: Request) -> JSONResponse:
        page_id = None
        try:
            page_id = page_of(request)
            check_type(request)
            photo = open_photo(await body_of(request))
            started = time.perf_counter()
            reading = await run_in_threadpool(reader.read, photo)
            alto = alto_of(reading)
            total = time.perf_counter() - started
        except RefusalError as refused:
            log.info("refused page=%s code=%s", page_id or "-", refused.code)
            return JSONResponse({"error": refused.code}, status_code=refused.status)
        except Exception:
            log.error("failed page=%s code=reading_failed", page_id)
            return JSONResponse({"error": "reading_failed"}, status_code=500)
        log.info(
            "recognized page=%s lines=%d words=%d segment_seconds=%.2f recognize_seconds=%.2f total_seconds=%.2f",
            page_id,
            len(reading.lines),
            sum(len(line.words) for line in reading.lines),
            reading.segment_seconds,
            reading.recognize_seconds,
            total,
        )
        return JSONResponse(answer(page_id, reading, alto))

    app.add_middleware(SecretGate, secret=secret)
    return app
