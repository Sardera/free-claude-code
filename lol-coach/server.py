"""Local French LoL practice notebook; independent from the proxy project.

Launch: cd /absolute/path/to/lol-coach && uv run server.py
Then open http://127.0.0.1:8765 (override with --port). No API key, account,
database, root .env or third-party Python package is used. Stop with Ctrl+C.
Only the explicit ASSETS below are served, never arbitrary filesystem paths.

Progress, reviews and authorized excerpts stay in this browser's localStorage.
Use the Help / backup panel before clearing browser data or changing origin/port.
The app is not an AI, Riot client integration or automatic video transcriber.
Lessons are original fundamentals, not live-patch champion recommendations.
The only outbound request is a bounded HTTPS request to Riot Data Dragon's
fixed versions endpoint, without proxies or redirects. Failure is normal offline.
"""

import argparse
import contextlib
import json
import re
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/data.js": ("data.js", "text/javascript; charset=utf-8"),
    "/model.js": ("model.js", "text/javascript; charset=utf-8"),
    "/pwa.js": ("pwa.js", "text/javascript; charset=utf-8"),
    "/sw.js": ("sw.js", "text/javascript; charset=utf-8"),
    "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
    "/icon-192.png": ("icon-192.png", "image/png"),
    "/icon-512.png": ("icon-512.png", "image/png"),
    "/icon-maskable-512.png": ("icon-maskable-512.png", "image/png"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}
VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json"
MAX_RESPONSE = 65_536


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PatchCache:
    """Cache successful lookups for an hour and failures for a minute."""

    def __init__(self):
        self.lock = threading.Lock()
        self.expires = 0.0
        self.value: dict[str, str | None] = {
            "version": None,
            "checked_at": None,
            "status": "unavailable",
            "source": VERSIONS_URL,
        }

    def get(self) -> dict[str, str | None]:
        with self.lock:
            if time.monotonic() < self.expires:
                return dict(self.value)
            checked_at = datetime.now(UTC).isoformat()
            try:
                opener = build_opener(ProxyHandler({}), NoRedirect())
                request = Request(
                    VERSIONS_URL, headers={"User-Agent": "LolCoachLocal/1.0"}
                )
                with opener.open(request, timeout=3) as response:
                    raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE:
                    raise ValueError("Oversized response")
                versions = json.loads(raw)
                if (
                    not isinstance(versions, list)
                    or not versions
                    or not isinstance(versions[0], str)
                    or re.fullmatch(r"\d{1,3}\.\d{1,3}\.\d{1,3}", versions[0]) is None
                ):
                    raise ValueError("Invalid version response")
                self.value = {
                    "version": versions[0],
                    "checked_at": checked_at,
                    "status": "available",
                    "source": VERSIONS_URL,
                }
                self.expires = time.monotonic() + 3600
            except OSError, URLError, ValueError, RecursionError:
                self.value = {
                    "version": None,
                    "checked_at": checked_at,
                    "status": "unavailable",
                    "source": VERSIONS_URL,
                }
                self.expires = time.monotonic() + 60
            return dict(self.value)


PATCH = PatchCache()


class CoachHandler(BaseHTTPRequestHandler):
    server: ThreadingHTTPServer

    def do_GET(self):
        self.respond(head_only=False)

    def do_HEAD(self):
        self.respond(head_only=True)

    def respond(self, *, head_only: bool):
        port = self.server.server_port
        if self.headers.get("Host") not in {
            f"127.0.0.1:{port}",
            f"localhost:{port}",
        }:
            self.reply(403, b"Host not allowed", "text/plain", head_only=head_only)
            return
        try:
            path = unquote(urlsplit(self.path).path, errors="strict")
        except ValueError:
            self.reply(400, b"Invalid path", "text/plain", head_only=head_only)
            return
        if path == "/api/patch":
            payload = json.dumps(PATCH.get()).encode()
            self.reply(200, payload, "application/json", head_only=head_only)
        elif path in ASSETS:
            filename, content_type = ASSETS[path]
            try:
                payload = (ROOT / filename).read_bytes()
            except OSError:
                self.reply(503, b"Asset unavailable", "text/plain", head_only=head_only)
                return
            self.reply(200, payload, content_type, head_only=head_only)
        else:
            self.reply(404, b"Not found", "text/plain", head_only=head_only)

    def reply(self, status: int, payload: bytes, content_type: str, *, head_only: bool):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "connect-src 'self'; img-src 'self'; font-src 'self'; "
            "worker-src 'self'; manifest-src 'self'; "
            "object-src 'none'; frame-src 'none'; frame-ancestors 'none'; "
            "base-uri 'none'; form-action 'self'",
        )
        self.end_headers()
        if not head_only:
            self.wfile.write(payload)


class CoachServer(ThreadingHTTPServer):
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("--port must be between 1024 and 65535")
    with CoachServer(("127.0.0.1", args.port), CoachHandler) as server:
        print(f"LoL Coach → http://127.0.0.1:{args.port} · Ctrl+C to stop", flush=True)
        with contextlib.suppress(KeyboardInterrupt):
            server.serve_forever()


if __name__ == "__main__":
    main()
