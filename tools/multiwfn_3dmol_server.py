#!/usr/bin/env python3
"""Local HTTP service for the Multiwfn 3Dmol GUI demo."""

from __future__ import annotations

import argparse
import http.server
import json
import math
import mimetypes
from pathlib import Path
import platform
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser


BACKEND_REQUEST_LOCK = threading.Lock()
BACKEND_REQUEST_CONSUME_TIMEOUT = 5.0
ORBITAL_REQUEST_TIMEOUT = 300.0
BOND_REQUEST_TIMEOUT = 300.0
FBO_REQUEST_TIMEOUT = 900.0
ESP_REQUEST_TIMEOUT = 900.0
BACKEND_REQUEST_POLL_INTERVAL = 0.2
MAX_DYNAMIC_ORBITAL_CUBES = 12
BOND_METHODS = frozenset(("mayer", "gwbo", "wiberg_lowdin", "mulliken", "fbo"))
ESP_QUALITY_LEVELS = frozenset((25000, 50000, 120000, 300000, 500000, 1000000, 1500000))
LAST_REQUEST_ID = 0
BACKEND_UNAVAILABLE_MESSAGE = (
    "Multiwfn backend unavailable; restart visualization from menu 0 and keep the terminal open"
)


def find_free_port(host: str, preferred: int) -> int:
    if preferred > 0:
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


def send_json(handler: http.server.BaseHTTPRequestHandler, payload: dict, status: int = 200) -> None:
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def cleanup_session_files(session_dir: Path, *, startup: bool = False) -> None:
    patterns = ["response_*.json"]
    if startup:
        patterns.extend(("orbital_*.cube", "esp_density_*.cube", "esp_potential_*.cube"))
    for pattern in patterns:
        for path in session_dir.glob(pattern):
            try:
                path.unlink()
            except OSError:
                pass


def prune_dynamic_orbital_cubes(session_dir: Path, keep: int = MAX_DYNAMIC_ORBITAL_CUBES) -> None:
    cubes = sorted(
        session_dir.glob("orbital_*.cube"),
        key=lambda path: path.stat().st_mtime if path.exists() else 0,
        reverse=True,
    )
    for path in cubes[max(0, keep):]:
        try:
            path.unlink()
        except OSError:
            pass


def prune_dynamic_esp_cubes(session_dir: Path, payload: dict) -> None:
    keep = {
        Path(str(layer.get("path", ""))).name
        for layer in (payload.get("densityLayer", {}), payload.get("espLayer", {}))
        if isinstance(layer, dict) and layer.get("path")
    }
    for pattern in ("esp_density_*.cube", "esp_potential_*.cube"):
        for path in session_dir.glob(pattern):
            if path.name in keep:
                continue
            try:
                path.unlink()
            except OSError:
                pass


def next_request_id() -> int:
    global LAST_REQUEST_ID
    LAST_REQUEST_ID = max(int(time.time() * 1000), LAST_REQUEST_ID + 1)
    return LAST_REQUEST_ID


def request_backend(
    session_dir: Path,
    request_payload: str,
    *,
    timeout: float,
    timeout_message: str,
) -> dict:
    with BACKEND_REQUEST_LOCK:
        stop = session_dir / "gui_stop.flag"
        if stop.is_file():
            return {"ok": False, "message": BACKEND_UNAVAILABLE_MESSAGE}

        reqid = next_request_id()
        response = session_dir / f"response_{reqid}.json"
        request = session_dir / "gui_request.txt"
        if response.exists():
            response.unlink()
        request.write_text(f"{reqid} {request_payload}\n", encoding="utf-8")

        consumed = False
        consume_deadline = time.monotonic() + BACKEND_REQUEST_CONSUME_TIMEOUT
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if response.is_file():
                try:
                    return json.loads(response.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    pass

            if not consumed:
                if not request.is_file():
                    consumed = True
                elif stop.is_file():
                    return {"ok": False, "message": BACKEND_UNAVAILABLE_MESSAGE}
                elif time.monotonic() >= consume_deadline:
                    try:
                        pending = request.read_text(encoding="utf-8")
                    except FileNotFoundError:
                        consumed = True
                        continue
                    if pending.startswith(f"{reqid} "):
                        try:
                            request.unlink()
                        except FileNotFoundError:
                            pass
                        return {"ok": False, "message": BACKEND_UNAVAILABLE_MESSAGE}
                    return {"ok": False, "message": "Backend request was superseded; try again"}

            time.sleep(BACKEND_REQUEST_POLL_INTERVAL)

        return {"ok": False, "message": timeout_message}


def request_orbital(session_dir: Path, query: dict[str, list[str]]) -> dict:
    index = int(query.get("index", ["0"])[0] or 0)
    quality = int(query.get("quality", ["0"])[0] or 0)
    isovalue = float(query.get("isovalue", ["0.0"])[0] or 0.0)
    payload = request_backend(
        session_dir,
        f"orbital {index} {quality} {isovalue:.10g}",
        timeout=ORBITAL_REQUEST_TIMEOUT,
        timeout_message="Timed out waiting for Multiwfn orbital grid",
    )
    if payload.get("ok"):
        prune_dynamic_orbital_cubes(session_dir)
    return payload


def request_bond(session_dir: Path, query: dict[str, list[str]]) -> dict:
    try:
        atom1 = int(query.get("atom1", ["0"])[0] or 0)
        atom2 = int(query.get("atom2", ["0"])[0] or 0)
    except ValueError:
        return {"ok": False, "message": "Atom indices must be integers"}
    method = str(query.get("method", [""])[0] or "").strip().lower()
    if atom1 <= 0 or atom2 <= 0 or atom1 == atom2:
        return {"ok": False, "message": "Two distinct positive atom indices are required"}
    if method not in BOND_METHODS:
        return {"ok": False, "message": "Unsupported bond-order method"}
    timeout = FBO_REQUEST_TIMEOUT if method == "fbo" else BOND_REQUEST_TIMEOUT
    return request_backend(
        session_dir,
        f"bond {atom1} {atom2} {method}",
        timeout=timeout,
        timeout_message=f"Timed out waiting for Multiwfn {method} calculation",
    )


def request_esp(session_dir: Path, query: dict[str, list[str]]) -> dict:
    try:
        quality = int(query.get("quality", ["120000"])[0] or 120000)
        isovalue = float(query.get("isovalue", ["0.001"])[0] or 0.001)
    except ValueError:
        return {"ok": False, "message": "ESP quality and isovalue must be numeric"}
    if quality not in ESP_QUALITY_LEVELS:
        return {"ok": False, "message": "Unsupported ESP grid quality"}
    if not math.isfinite(isovalue) or isovalue <= 0.0 or isovalue > 0.1:
        return {"ok": False, "message": "ESP density isovalue must be between 0 and 0.1 a.u."}
    payload = request_backend(
        session_dir,
        f"esp {quality} {isovalue:.10g}",
        timeout=ESP_REQUEST_TIMEOUT,
        timeout_message="Timed out waiting for Multiwfn ESP calculation",
    )
    if payload.get("ok"):
        prune_dynamic_esp_cubes(session_dir, payload)
    return payload


def is_wsl() -> bool:
    try:
        release = Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return "microsoft" in release.lower() or "wsl" in release.lower()


def try_open_url(url: str) -> bool:
    if is_wsl():
        for opener in ("wslview", "cmd.exe", "powershell.exe"):
            resolved = shutil.which(opener)
            if not resolved:
                continue
            if opener == "cmd.exe":
                cmd = [resolved, "/C", "start", "", url]
            elif opener == "powershell.exe":
                cmd = [resolved, "-NoProfile", "-Command", f"Start-Process '{url}'"]
            else:
                cmd = [resolved, url]
            result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            if result.returncode == 0:
                return True

    system = platform.system()
    if system == "Darwin" and shutil.which("open"):
        return subprocess.run(["open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False).returncode == 0
    if system == "Windows":
        return webbrowser.open(url)

    for opener in ("xdg-open", "gio"):
        resolved = shutil.which(opener)
        if not resolved:
            continue
        cmd = [resolved, "open", url] if opener == "gio" else [resolved, url]
        result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        if result.returncode == 0:
            return True
    return False


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def make_handler(frontend_dir: Path, session_dir: Path, manifest: Path):
    class Multiwfn3DmolHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(frontend_dir), **kwargs)

        def log_message(self, fmt: str, *args) -> None:
            sys.stderr.write("[multiwfn-3dmol] " + fmt % args + "\n")

        def do_HEAD(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            request_path = urllib.parse.unquote(parsed.path)
            if request_path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            super().do_HEAD()

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            request_path = urllib.parse.unquote(parsed.path)
            query = urllib.parse.parse_qs(parsed.query)

            if request_path in ("", "/"):
                target = "/index.html?manifest=/session/manifest.json"
                self.send_response(302)
                self.send_header("Location", target)
                self.end_headers()
                return

            if request_path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return

            if request_path == "/api/orbital":
                try:
                    send_json(self, request_orbital(session_dir, query))
                except Exception as exc:
                    send_json(self, {"ok": False, "message": str(exc)}, status=500)
                return

            if request_path == "/api/bond":
                try:
                    send_json(self, request_bond(session_dir, query))
                except Exception as exc:
                    send_json(self, {"ok": False, "message": str(exc)}, status=500)
                return

            if request_path == "/api/esp":
                try:
                    send_json(self, request_esp(session_dir, query))
                except Exception as exc:
                    send_json(self, {"ok": False, "message": str(exc)}, status=500)
                return

            if request_path == "/api/return":
                (session_dir / "gui_stop.flag").write_text("return\n", encoding="utf-8")
                send_json(self, {"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
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
    parser.add_argument("--no-open", action="store_true", help="Do not try to open a browser")
    parser.add_argument("--once", action="store_true", help="Exit after a key press instead of serving forever")
    args = parser.parse_args()

    frontend_dir = Path(args.frontend).expanduser().resolve()
    session_dir = Path(args.session).expanduser().resolve()
    manifest = Path(args.manifest).expanduser().resolve() if args.manifest else session_dir / "manifest.json"
    cleanup_session_files(session_dir, startup=True)

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
    if args.open and not args.no_open:
        def open_or_report() -> None:
            if not try_open_url(url):
                print("No browser opener was found. Open this URL manually:")
                print(url)

        threading.Timer(0.35, open_or_report).start()

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
