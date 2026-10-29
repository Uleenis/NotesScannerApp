from dataclasses import dataclass, field
from decimal import Decimal
from typing import Protocol
from urllib.parse import quote, urlsplit

import httpx2

from reading.arbitration import Alert, Model, Position

ALTO_BUCKET = "alto"
ALTO_TYPE = "application/xml"
MODELS_BUCKET = "models"
REASONS = {"page_not_found", "not_text", "already_read", "model_not_found"}
LEVELS = {"course", "journal", "grammar"}
DEFAULT_LEVEL = "course"
SETTLED = {400, 401, 403, 404, 409}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
LOCAL_GATEWAY = "supabase_kong_"
TIMEOUT = 30.0


@dataclass(frozen=True)
class ReadingA:
    page_id: str
    user_id: str
    raw_text: str
    model: str
    model_version: str
    duration_ms: int
    alto_path: str
    language: str | None
    tokens: list[Position]
    alerts: list[Alert] = field(default_factory=list)
    model_id: str | None = None


@dataclass(frozen=True)
class ActiveModel:
    id: str
    path: str
    sha256: str


class StoreError(Exception):
    def __init__(self, settled: bool) -> None:
        super().__init__("settled" if settled else "unsettled")
        self.settled = settled


class Store(Protocol):
    def models(self, user_id: str) -> list[Model]: ...

    def correction_level(self, page_id: str, user_id: str) -> str: ...

    def upload_alto(self, path: str, alto: bytes) -> None: ...

    def record(self, write: ReadingA) -> str: ...

    def remove_alto(self, path: str) -> None: ...


def token_row(position: Position) -> dict[str, object]:
    return {
        "token_index": position.token_index,
        "line_index": position.line_index,
        "text": position.text,
        "rule": position.rule,
        "channel": position.channel,
        "reading_a": position.reading_a,
        "reading_b1": position.reading_b1,
        "reading_b2": position.reading_b2,
        "anchor_kind": position.anchor_kind,
        "anchor": None if position.anchor is None else list(position.anchor),
        "b1_start": position.b1_start,
        "b1_end": position.b1_end,
    }


def secure(url: str) -> bool:
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
    except ValueError:
        return False
    if parts.scheme == "https":
        return bool(host)
    return parts.scheme == "http" and (host in LOCAL_HOSTS or (host.startswith(LOCAL_GATEWAY) and "." not in host))


class SupabaseStore:
    def __init__(
        self, url: str, key: str, transport: httpx2.BaseTransport | None = None, timeout: float = TIMEOUT
    ) -> None:
        if not secure(url):
            raise ValueError("SUPABASE_URL is not an https address, nor http on the local stack")
        if not key:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY is not set")
        self._client = httpx2.Client(
            base_url=url.rstrip("/"),
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            transport=transport,
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
        )

    def _send(
        self,
        method: str,
        path: str,
        params: dict[str, str] | None = None,
        content: bytes | None = None,
        body: object = None,
        headers: dict[str, str] | None = None,
    ) -> httpx2.Response:
        try:
            response = self._client.request(method, path, params=params, content=content, json=body, headers=headers)
        except httpx2.HTTPError as error:
            raise StoreError(settled=False) from error
        if response.status_code in SETTLED:
            raise StoreError(settled=True)
        if response.status_code >= 300:
            raise StoreError(settled=False)
        return response

    def models(self, user_id: str) -> list[Model]:
        response = self._send(
            "GET", "/rest/v1/htr_models", params={"select": "id,status,cer,version", "user_id": f"eq.{user_id}"}
        )
        try:
            return [
                Model(
                    str(row["id"]),
                    str(row["status"]),
                    None if row["cer"] is None else Decimal(str(row["cer"])),
                    int(row["version"]),
                )
                for row in response.json()
            ]
        except (ValueError, KeyError, TypeError, ArithmeticError) as error:
            raise StoreError(settled=False) from error

    def active_model(self, user_id: str) -> ActiveModel | None:
        response = self._send(
            "GET",
            "/rest/v1/htr_models",
            params={"select": "id,storage_path,sha256", "user_id": f"eq.{user_id}", "status": "eq.active"},
        )
        try:
            rows = response.json()
        except ValueError as error:
            raise StoreError(settled=False) from error
        if not isinstance(rows, list) or len(rows) > 1:
            raise StoreError(settled=False)
        if not rows:
            return None
        row = rows[0]
        fields = [row.get(name) if isinstance(row, dict) else None for name in ("id", "storage_path", "sha256")]
        if not all(isinstance(value, str) for value in fields):
            raise StoreError(settled=False)
        return ActiveModel(*(str(value) for value in fields))

    def download_model(self, path: str, limit: int) -> bytes:
        try:
            with self._client.stream("GET", f"/storage/v1/object/{MODELS_BUCKET}/{quote(path)}") as response:
                if response.status_code in SETTLED:
                    raise StoreError(settled=True)
                if response.status_code != 200:
                    raise StoreError(settled=False)
                lengths = response.headers.get_list("content-length")
                if any(not length.isdigit() or int(length) > limit for length in lengths):
                    raise StoreError(settled=False)
                received = bytearray()
                for chunk in response.iter_bytes():
                    received += chunk
                    if len(received) > limit:
                        raise StoreError(settled=False)
                return bytes(received)
        except httpx2.HTTPError as error:
            raise StoreError(settled=False) from error

    def correction_level(self, page_id: str, user_id: str) -> str:
        response = self._send(
            "GET",
            "/rest/v1/pages",
            params={"select": "notebooks(correction_level)", "id": f"eq.{page_id}", "user_id": f"eq.{user_id}"},
        )
        try:
            rows = response.json()
        except ValueError as error:
            raise StoreError(settled=False) from error
        if not isinstance(rows, list) or len(rows) > 1:
            raise StoreError(settled=False)
        if not rows:
            return DEFAULT_LEVEL
        notebook = rows[0].get("notebooks") if isinstance(rows[0], dict) else None
        level = notebook.get("correction_level") if isinstance(notebook, dict) else None
        if level not in LEVELS:
            raise StoreError(settled=False)
        return str(level)

    def upload_alto(self, path: str, alto: bytes) -> None:
        self._send(
            "POST",
            f"/storage/v1/object/{ALTO_BUCKET}/{quote(path)}",
            content=alto,
            headers={"Content-Type": ALTO_TYPE, "x-upsert": "false"},
        )

    def record(self, write: ReadingA) -> str:
        body: dict[str, object] = {
            "p_page_id": write.page_id,
            "p_user_id": write.user_id,
            "p_raw_text": write.raw_text,
            "p_model": write.model,
            "p_model_version": write.model_version,
            "p_model_id": write.model_id,
            "p_duration_ms": write.duration_ms,
            "p_alto_path": write.alto_path,
            "p_language": write.language,
            "p_tokens": [token_row(position) for position in write.tokens],
        }
        if write.alerts:
            body["p_alerts"] = [{"kind": alert.kind, "details": alert.details} for alert in write.alerts]
        response = self._send("POST", "/rest/v1/rpc/record_reading_a", body=body)
        try:
            rows = response.json()
        except ValueError as error:
            raise StoreError(settled=False) from error
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
            raise StoreError(settled=False)
        recorded, reason = rows[0].get("recorded"), rows[0].get("reason")
        if recorded is True and reason == "recorded":
            return "recorded"
        if recorded is False and reason in REASONS:
            return str(reason)
        raise StoreError(settled=False)

    def remove_alto(self, path: str) -> None:
        self._send("DELETE", f"/storage/v1/object/{ALTO_BUCKET}", body={"prefixes": [path]})
