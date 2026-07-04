#!/usr/bin/env python3
"""Local HTTP service for the Multiwfn 3Dmol GUI demo."""

from __future__ import annotations

import argparse
import functools
import http.server
import mimetypes
import os
from pathlib import Path
import socket
import socketserver
import sys
import threading
import urllib.parse
import webbrowser


def find_free_port(host: str, preferred: int) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((host, preferred))
            return preferred
        except OSError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((host, 0))
        return int(probe.getsockname()[1])


def send_file(handler: http.server.BaseHTTPRequestHandler, path: Path) -> None:
    if not path.is_file():
        handler.send_error(404, "File not found")
        return
    content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    data = path.read_bytes()
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def make_handler(frontend_dir: Path, session_dir: Path, manifest: Path):
    class Multiwfn3DmolHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(frontend_dir), **kwargs)

        def log_message(self, fmt: str, *args) -> None:
            sys.stderr.write("[multiwfn-3dmol] " + fmt % args + "\n")

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            request_path = urllib.parse.unquote(parsed.path)

            if request_path in ("", "/"):
                target = "/index.html?manifest=/session/manifest.json"
                self.send_response(302)
                self.send_header("Location", target)
                self.end_headers()
                return

            if request_path == "/session/manifest.json":
                send_file(self, manifest)
                return

            if request_path.startswith("/session/"):
                rel = request_path[len("/session/") :]
                candidate = (session_dir / rel).resolve()
                try:
                    candidate.relative_to(session_dir)
                except ValueError:
                    self.send_error(403, "Invalid session path")
                    return
                send_file(self, candidate)
                return

            super().do_GET()

    return Multiwfn3DmolHandler


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the Multiwfn 3Dmol GUI demo")
    parser.add_argument("--frontend", default="frontend/3dmol-viewer", help="Path to the 3Dmol frontend directory")
    parser.add_argument("--session", default="multiwfn_3dmol_session", help="Path to the generated GUI session")
    parser.add_argument("--manifest", default=None, help="Path to the generated manifest")
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind address")
    parser.add_argument("--port", type=int, default=8765, help="Preferred HTTP port")
    parser.add_argument("--open", action="store_true", help="Open the frontend in the default browser")
    parser.add_argument("--once", action="store_true", help="Exit after a key press instead of serving forever")
    args = parser.parse_args()

    frontend_dir = Path(args.frontend).expanduser().resolve()
    session_dir = Path(args.session).expanduser().resolve()
    manifest = Path(args.manifest).expanduser().resolve() if args.manifest else session_dir / "manifest.json"

    if not frontend_dir.is_dir():
        print(f"Frontend directory not found: {frontend_dir}", file=sys.stderr)
        return 2
    if not manifest.is_file():
        print(f"Manifest not found: {manifest}", file=sys.stderr)
        return 2

    port = find_free_port(args.host, args.port)
    handler = make_handler(frontend_dir, session_dir, manifest)
    server = ThreadingHTTPServer((args.host, port), handler)
    url = f"http://{args.host}:{port}/index.html?manifest=/session/manifest.json"

    print(f"Multiwfn 3Dmol GUI service: {url}")
    if args.open:
        threading.Timer(0.35, functools.partial(webbrowser.open, url)).start()

    if args.once:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            input("Press ENTER to stop the 3Dmol GUI service...")
        finally:
            server.shutdown()
        return 0

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Multiwfn 3Dmol GUI service.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
