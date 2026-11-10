"""Contract tests for the independent, dependency-free lol-coach subproject."""

import importlib.util
import json
import shutil
import subprocess
import threading
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import MagicMock
from urllib.error import URLError

import pytest

APP = Path(__file__).resolve().parents[1] / "lol-coach"
spec = importlib.util.spec_from_file_location("lol_coach_server", APP / "server.py")
assert spec is not None and spec.loader is not None
coach = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coach)


@pytest.fixture
def local_server(monkeypatch):
    monkeypatch.setattr(coach.PATCH, "get", lambda: {"status": "unavailable"})
    with coach.CoachServer(("127.0.0.1", 0), coach.CoachHandler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        yield server.server_port
        server.shutdown()
        thread.join(timeout=3)


def request(port, path, *, method="GET", host=None):
    connection = HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Host": host} if host else {}
    connection.request(method, path, headers=headers)
    response = connection.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    connection.close()
    return result


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/styles.css",
        "/app.js",
        "/data.js",
        "/model.js",
        "/index.html",
        "/favicon.svg",
    ],
)
def test_static_allowlist_serves_app_with_security_headers(local_server, path):
    status, headers, body = request(local_server, path)
    assert status == 200 and body
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Cache-Control"] == "no-store"
    assert "default-src 'self'" in headers["Content-Security-Policy"]
    assert "frame-src 'none'" in headers["Content-Security-Policy"]
    assert "Access-Control-Allow-Origin" not in headers


@pytest.mark.parametrize(
    "path",
    [
        "/.env",
        "/../.env.example",
        "/%2e%2e/.env.example",
        "/%252e%252e/.env",
        "/%2f..%2f.env",
        "/%5c..%5c.env",
        "/server.py",
        "/pyproject.toml",
        "/model.test.js",
        "/.git/config",
        "/styles.css/../../AGENTS.md",
        "/app.js%00",
        "/%FF",
        "/unknown",
    ],
)
def test_traversal_and_nonassets_never_expose_files(local_server, path):
    status, _, body = request(local_server, path)
    assert status in {400, 404}
    assert body in {b"Not found", b"Invalid path"}


def test_host_guard_blocks_rebinding_and_absolute_urls(local_server):
    for host in ["evil.example", "127.0.0.1.evil.example", "localhost:1"]:
        status, _, body = request(local_server, "/", host=host)
        assert status == 403 and body == b"Host not allowed"


def test_head_and_missing_paths(local_server):
    status, headers, body = request(local_server, "/", method="HEAD")
    assert status == 200 and not body
    assert int(headers["Content-Length"]) == (APP / "index.html").stat().st_size
    assert request(local_server, "/", method="POST")[0] == 501


def test_missing_asset_is_a_bounded_error_without_filesystem_details(
    local_server, monkeypatch
):
    def unavailable(self):
        raise OSError("private filesystem location")

    monkeypatch.setattr(Path, "read_bytes", unavailable)
    status, _, body = request(local_server, "/")
    assert status == 503 and body == b"Asset unavailable"


def test_untrusted_content_is_not_rendered_with_html_sinks():
    code = (APP / "app.js").read_text()
    for sink in (
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "document.write",
        "eval(",
    ):
        assert sink not in code
    assert "document.createTextNode" in code
    assert "element.textContent" in code


def test_patch_api_ignores_arbitrary_fetch_parameters(local_server):
    status, headers, raw = request(local_server, "/api/patch?url=http://127.0.0.1/.env")
    assert status == 200
    assert headers["Content-Type"] == "application/json"
    assert json.loads(raw) == {"status": "unavailable"}


def opener_response(monkeypatch, raw):
    response = MagicMock()
    response.read.return_value = raw
    response.__enter__.return_value = response
    opener = MagicMock()
    opener.open.return_value = response
    build = MagicMock(return_value=opener)
    monkeypatch.setattr(coach, "build_opener", build)
    return build, opener, response


def test_patch_uses_fixed_https_endpoint_bounds_and_cache(monkeypatch):
    build, opener, response = opener_response(monkeypatch, b'["26.22.1","26.21.1"]')
    cache = coach.PatchCache()
    first = cache.get()
    assert first["status"] == "available" and first["version"] == "26.22.1"
    assert first["checked_at"] and first["source"] == coach.VERSIONS_URL
    assert cache.get() == first
    opener.open.assert_called_once()
    args, kwargs = opener.open.call_args
    assert args[0].full_url == coach.VERSIONS_URL
    assert kwargs["timeout"] == 3
    response.read.assert_called_once_with(coach.MAX_RESPONSE + 1)
    handlers = build.call_args.args
    assert handlers[0].proxies == {}
    assert isinstance(handlers[1], coach.NoRedirect)
    first["version"] = "tampered"
    assert cache.get()["version"] == "26.22.1"


@pytest.mark.parametrize(
    "raw",
    [
        b"not-json",
        b"[]",
        b"{}",
        b'["javascript:alert(1)"]',
        b"[42]",
        b'["invalid"]',
        b'["1234.1.1"]',
        b"x" * 65_537,
        b"[" * 2000 + b"]" * 2000,
    ],
)
def test_patch_invalid_and_oversized_data_is_honestly_unavailable(monkeypatch, raw):
    _, opener, _ = opener_response(monkeypatch, raw)
    result = coach.PatchCache().get()
    assert result["status"] == "unavailable" and result["version"] is None
    assert result["checked_at"]
    opener.open.assert_called_once()


@pytest.mark.parametrize("error", [URLError("offline"), TimeoutError(), OSError()])
def test_network_failure_is_cached_and_old_patch_not_presented_as_live(
    monkeypatch, error
):
    _, opener, _ = opener_response(monkeypatch, b'["26.22.1"]')
    cache = coach.PatchCache()
    assert cache.get()["version"] == "26.22.1"
    cache.expires = 0
    opener.open.side_effect = error
    result = cache.get()
    assert result["status"] == "unavailable" and result["version"] is None
    assert cache.get() == result and opener.open.call_count == 2


def test_redirects_not_followed():
    assert (
        coach.NoRedirect().redirect_request(None, None, 302, "", {}, "http://127.0.0.1")
        is None
    )


def test_frontend_contracts_with_node():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is optional for serving; required for frontend unit tests")
    result = subprocess.run(
        [node, "--test", "model.test.js"],
        cwd=APP,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
