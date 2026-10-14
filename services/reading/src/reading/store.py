from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol
from urllib.parse import quote, urlsplit

import httpx2

from reading.arbitration import Model, Position

ALTO_BUCKET = "alto"
ALTO_TYPE = "application/xml"
REASONS = {"page_not_found", "not_text", "already_read"}
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


class StoreError(Exception):
    def __init__(self, settled: bool) -> None:
        super().__init__("settled" if settled else "unsettled")
        self.settled = settled


class Store(Protocol):
    def models(self, user_id: str) -> list[Model]: ...

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
        "anchor_kind": position.anchor_kind,
        "anchor": None if position.anchor is None else list(position.anchor),
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
        response = self._send("GET", "/rest/v1/htr_models", params={"select": "status,cer", "user_id": f"eq.{user_id}"})
        try:
            return [
                Model(str(row["status"]), None if row["cer"] is None else Decimal(str(row["cer"])))
                for row in response.json()
            ]
        except (ValueError, KeyError, TypeError, ArithmeticError) as error:
            raise StoreError(settled=False) from error

    def upload_alto(self, path: str, alto: bytes) -> None:
        self._send(
            "POST",
            f"/storage/v1/object/{ALTO_BUCKET}/{quote(path)}",
            content=alto,
            headers={"Content-Type": ALTO_TYPE, "x-upsert": "false"},
        )

    def record(self, write: ReadingA) -> str:
        response = self._send(
            "POST",
            "/rest/v1/rpc/record_reading_a",
            body={
                "p_page_id": write.page_id,
                "p_user_id": write.user_id,
                "p_raw_text": write.raw_text,
                "p_model": write.model,
                "p_model_version": write.model_version,
                "p_duration_ms": write.duration_ms,
                "p_alto_path": write.alto_path,
                "p_language": write.language,
                "p_tokens": [token_row(position) for position in write.tokens],
            },
        )
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
