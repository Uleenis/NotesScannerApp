import hmac
import logging
import re
import time

from fastapi import FastAPI, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from reading.alto import alto_of
from reading.arbiter import PageArbiter
from reading.contract import arbitration_of
from reading.personal import ModelChooser
from reading.photo import MAX_BYTES, open_photo
from reading.recognition import Box, PageReader, Reading
from reading.refusal import RefusalError, busy, invalid_request, too_large, unsupported
from reading.secret import check_secret
from reading.writing_test import count_sheet, read_lines

GATE_HEADER = "X-Reading-Secret"
PHOTO_TYPE = "image/jpeg"
JSON_TYPE = "application/json"
MAX_IN_FLIGHT = 4
MAX_ARBITRATION_BYTES = 12 * 1024 * 1024
IDENTIFIER = r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
QUERY = re.compile(rf"page_id={IDENTIFIER}&user_id={IDENTIFIER}")

CHECK_QUERY = re.compile(r"template=(fr|en)&sheet=([12])")

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


def page_of(request: Request) -> tuple[str, str]:
    found = QUERY.fullmatch(request.url.query)
    if found is None:
        raise invalid_request()
    return found.group(1), found.group(2)


def sheet_of(request: Request) -> tuple[str, int]:
    found = CHECK_QUERY.fullmatch(request.url.query)
    if found is None:
        raise invalid_request()
    return found.group(1), int(found.group(2))


def check_type(request: Request, expected: str = PHOTO_TYPE) -> None:
    types = request.headers.getlist("content-type")
    if types != [expected]:
        raise unsupported()


async def body_of(request: Request, limit: int = MAX_BYTES) -> bytes:
    lengths = request.headers.getlist("content-length")
    if any(not length.isdigit() or int(length) > limit for length in lengths):
        raise too_large()
    received = bytearray()
    async for chunk in request.stream():
        received += chunk
        if len(received) > limit:
            raise too_large()
    return bytes(received)


def listed(box: Box) -> list[int]:
    return list(box)


def answer(page_id: str, reading: Reading, alto: str, model_id: str | None) -> dict[str, object]:
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
        "model_id": model_id,
    }


def refusal(page_id: str | None, refused: RefusalError) -> JSONResponse:
    log.info("refused page=%s code=%s", page_id or "-", refused.code)
    return JSONResponse({"error": refused.code}, status_code=refused.status)


def create_app(
    secret: str, reader: PageReader, arbiter: PageArbiter, models: ModelChooser, max_in_flight: int = MAX_IN_FLIGHT
) -> FastAPI:
    check_secret(secret)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    in_flight = [0]
    arbitrating = [0]

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/recognize")
    async def recognize(request: Request) -> JSONResponse:
        if in_flight[0] >= max_in_flight:
            return refusal(None, busy())
        in_flight[0] += 1
        try:
            return await recognized(request)
        finally:
            in_flight[0] -= 1

    async def recognized(request: Request) -> JSONResponse:
        page_id = None
        try:
            page_id, user_id = page_of(request)
            check_type(request)
            photo = await run_in_threadpool(open_photo, await body_of(request))
            recognizer, model_id = await run_in_threadpool(models.for_user, user_id, page_id)
            started = time.perf_counter()
            reading = await run_in_threadpool(reader.read, photo, recognizer)
            alto = await run_in_threadpool(alto_of, reading)
            total = time.perf_counter() - started
        except RefusalError as refused:
            return refusal(page_id, refused)
        except Exception:
            log.error("failed page=%s code=reading_failed", page_id)
            return JSONResponse({"error": "reading_failed"}, status_code=500)
        log.info(
            "recognized page=%s model=%s lines=%d words=%d segment_seconds=%.2f recognize_seconds=%.2f "
            "total_seconds=%.2f",
            page_id,
            "generic" if model_id is None else "personal",
            len(reading.lines),
            sum(len(line.words) for line in reading.lines),
            reading.segment_seconds,
            reading.recognize_seconds,
            total,
        )
        return JSONResponse(answer(page_id, reading, alto, model_id))

    @app.post("/check-writing")
    async def check_writing(request: Request) -> JSONResponse:
        if in_flight[0] >= max_in_flight:
            return refusal(None, busy())
        in_flight[0] += 1
        try:
            return await checked(request)
        finally:
            in_flight[0] -= 1

    async def checked(request: Request) -> JSONResponse:
        try:
            template, sheet = sheet_of(request)
            check_type(request)
            photo = await run_in_threadpool(open_photo, await body_of(request))
            reading = await run_in_threadpool(reader.read, photo)
            counted = await run_in_threadpool(count_sheet, template, sheet, read_lines(reading))
        except RefusalError as refused:
            return refusal(None, refused)
        except Exception:
            log.error("failed code=reading_failed")
            return JSONResponse({"error": "reading_failed"}, status_code=500)
        log.info(
            "checked template=%s sheet=%d lines=%d training=%d validation=%d",
            template,
            sheet,
            counted.lines,
            counted.training,
            counted.validation,
        )
        return JSONResponse(
            {
                "template": template,
                "sheet": sheet,
                "lines": counted.lines,
                "training": counted.training,
                "validation": counted.validation,
            }
        )

    @app.post("/arbitrate")
    async def arbitrate(request: Request) -> JSONResponse:
        if arbitrating[0] >= max_in_flight:
            return refusal(None, busy())
        arbitrating[0] += 1
        try:
            return await arbitrated(request)
        finally:
            arbitrating[0] -= 1

    async def arbitrated(request: Request) -> JSONResponse:
        page_id = None
        try:
            if request.url.query:
                raise invalid_request()
            check_type(request, JSON_TYPE)
            arbitration = await run_in_threadpool(arbitration_of, await body_of(request, MAX_ARBITRATION_BYTES))
            page_id = arbitration.page_id
            outcome = await run_in_threadpool(arbiter.arbitrate, arbitration)
        except RefusalError as refused:
            return refusal(page_id, refused)
        except Exception:
            log.error("failed page=%s code=arbitration_failed", page_id or "-")
            return JSONResponse({"error": "arbitration_failed"}, status_code=500)
        if outcome.reason != "recorded":
            return JSONResponse({"error": outcome.reason}, status_code=409)
        return JSONResponse({"page_id": page_id, "outcome": outcome.reason, "tokens": outcome.tokens})

    app.add_middleware(SecretGate, secret=secret)
    return app
