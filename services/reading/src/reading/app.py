import hmac

from fastapi import FastAPI
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from reading.secret import check_secret

GATE_HEADER = "X-Reading-Secret"


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


def create_app(secret: str) -> FastAPI:
    check_secret(secret)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.add_middleware(SecretGate, secret=secret)
    return app
