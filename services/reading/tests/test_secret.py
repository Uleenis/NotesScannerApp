import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from PIL import Image

from reading.app import GATE_HEADER, create_app
from reading.recognition import Reading
from reading.secret import GATE_VARIABLE, SecretError, load_secret

SECRET = "s" * 24 + "-shared-secret-of-the-test"
OTHER = "o" * 24 + "-shared-secret-of-the-test"


class EmptyReader:
    def read(self, photo: Image.Image) -> Reading:
        return Reading(width=photo.width, height=photo.height, lines=(), segment_seconds=0.0, recognize_seconds=0.0)


app = create_app(SECRET, EmptyReader())
client = TestClient(app)

API_ROUTES = [route for route in app.routes if isinstance(route, APIRoute)]
ROUTES = [(method, route.path) for route in API_ROUTES for method in sorted(route.methods or set())]

PROBES = [
    *ROUTES,
    ("GET", "/"),
    ("GET", "/docs"),
    ("GET", "/redoc"),
    ("GET", "/openapi.json"),
    ("POST", "/recognize"),
    ("POST", "/arbitrate"),
    ("DELETE", "/health"),
]

REFUSED_HEADERS = [
    pytest.param({}, id="no secret"),
    pytest.param({GATE_HEADER: ""}, id="empty secret"),
    pytest.param({GATE_HEADER: OTHER}, id="wrong secret"),
    pytest.param({GATE_HEADER: SECRET[:-1]}, id="secret cut short"),
    pytest.param({GATE_HEADER: SECRET + "x"}, id="secret too long"),
    pytest.param({GATE_HEADER: SECRET.upper()}, id="secret in another case"),
    pytest.param({"Authorization": f"Bearer {SECRET}"}, id="secret in authorization"),
    pytest.param({"X-Other-Secret": SECRET}, id="secret in another header"),
]


def test_the_service_has_routes() -> None:
    assert ("GET", "/health") in ROUTES
    assert ("POST", "/recognize") in ROUTES


@pytest.mark.parametrize(("method", "path"), PROBES)
@pytest.mark.parametrize("headers", REFUSED_HEADERS)
def test_every_route_refuses_a_call_without_the_secret(method: str, path: str, headers: dict[str, str]) -> None:
    response = client.request(method, path, headers=headers, content=b"page")
    assert response.status_code == 401
    assert response.json() == {"error": "unauthorized"}
    assert SECRET not in response.text
    assert OTHER not in response.text


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_every_route_refuses_the_secret_sent_twice(method: str, path: str) -> None:
    response = client.request(method, path, headers=[(GATE_HEADER, SECRET), (GATE_HEADER, OTHER)])
    assert response.status_code == 401


def test_the_secret_opens_the_routes() -> None:
    response = client.get("/health", headers={GATE_HEADER: SECRET})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_the_secret_header_ignores_its_case() -> None:
    response = client.get("/health", headers={GATE_HEADER.lower(): SECRET})
    assert response.status_code == 200


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_the_service_publishes_no_description_of_itself(path: str) -> None:
    response = client.get(path, headers={GATE_HEADER: SECRET})
    assert response.status_code == 404


@pytest.mark.parametrize(
    "environ",
    [
        pytest.param({}, id="missing"),
        pytest.param({GATE_VARIABLE: ""}, id="empty"),
        pytest.param({GATE_VARIABLE: "   "}, id="blank"),
        pytest.param({GATE_VARIABLE: "short-secret"}, id="too short"),
        pytest.param({GATE_VARIABLE: f" {SECRET}"}, id="padded"),
    ],
)
def test_no_valid_secret_no_service(environ: dict[str, str]) -> None:
    with pytest.raises(SecretError):
        load_secret(environ)
    with pytest.raises(SecretError):
        create_app(environ.get(GATE_VARIABLE, ""), EmptyReader())


def test_a_valid_secret_is_loaded() -> None:
    assert load_secret({GATE_VARIABLE: SECRET}) == SECRET


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
        return port


def service_environ(**values: str) -> dict[str, str]:
    environ = {key: value for key, value in os.environ.items() if key != GATE_VARIABLE}
    environ.update(values)
    return environ


@pytest.mark.parametrize(
    "values",
    [
        pytest.param({}, id="missing"),
        pytest.param({GATE_VARIABLE: ""}, id="empty"),
        pytest.param({GATE_VARIABLE: "short-secret"}, id="too short"),
    ],
)
def test_the_service_refuses_to_start_without_a_valid_secret(values: dict[str, str]) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "reading"],
        env=service_environ(PORT=str(free_port()), **values),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0
    assert GATE_VARIABLE in result.stderr
    assert "short-secret" not in result.stderr + result.stdout


def test_the_service_starts_with_a_valid_secret() -> None:
    port = free_port()
    process = subprocess.Popen(
        [sys.executable, "-m", "reading"],
        env=service_environ(PORT=str(port), **{GATE_VARIABLE: SECRET}),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        status = None
        deadline = time.monotonic() + 60
        while status is None and time.monotonic() < deadline:
            request = urllib.request.Request(f"http://127.0.0.1:{port}/health", headers={GATE_HEADER: SECRET})
            try:
                with urllib.request.urlopen(request, timeout=2) as response:
                    status = response.status
            except (urllib.error.URLError, ConnectionError):
                assert process.poll() is None
                time.sleep(0.2)
        assert status == 200
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2)
            refused = None
        except urllib.error.HTTPError as error:
            refused = error.code
        assert refused == 401
    finally:
        process.terminate()
        output, _ = process.communicate(timeout=30)
    assert SECRET not in output
