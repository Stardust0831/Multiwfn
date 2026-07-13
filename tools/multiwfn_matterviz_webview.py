#!/usr/bin/env python3
"""Run the Multiwfn session service and open it in the MatterViz WebView shell."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time

import multiwfn_3dmol_server as web


STARTUP_STATUS_NAME = "gui_startup.status"
STARTUP_STATUS_ENV = "MULTIWFN_MATTERVIZ_STARTUP_STATUS"
STARTUP_TOKEN_ENV = "MULTIWFN_MATTERVIZ_STARTUP_TOKEN"
STOP_FILE_ENV = "MULTIWFN_MATTERVIZ_STOP_FILE"
STARTUP_TIMEOUT_ENV = "MULTIWFN_MATTERVIZ_STARTUP_TIMEOUT"
DEFAULT_STARTUP_TIMEOUT = 15.0
STARTUP_POLL_INTERVAL = 0.02
SHELL_STOP_GRACE_SECONDS = 2.0


def signal_return(session: Path) -> None:
    """Signal the Multiwfn caller that the WebView session has ended."""
    try:
        flag = session / "gui_stop.flag"
        if not flag.exists():
            flag.write_text("return\n", encoding="utf-8")
    except OSError:
        # The caller is already handling a launch/exit failure. There is no
        # useful recovery if the session directory cannot be written.
        pass


def cleanup_startup_status(session: Path) -> None:
    """Remove status files left by a previous shell process.

    The fixed status filename keeps the environment contract simple. The
    globbed names cover status files from older development builds and make a
    repeated launch deterministic even when a previous process was interrupted.
    """
    candidates = {session / STARTUP_STATUS_NAME, session / "gui_webview_startup.status"}
    candidates.update(session.glob("gui_*startup*.status"))
    candidates.update(session.glob("gui_*startup*.status.tmp"))
    for path in candidates:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            # The launch will report an unreadable status path if it cannot be
            # replaced; do not turn cleanup into a traceback-producing failure.
            pass


def startup_timeout(value: float | None = None) -> float:
    """Resolve a finite, positive startup timeout from CLI or environment."""
    raw = value
    if raw is None:
        configured = os.environ.get(STARTUP_TIMEOUT_ENV)
        raw = float(configured) if configured is not None else DEFAULT_STARTUP_TIMEOUT
    timeout = float(raw)
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("startup timeout must be a finite positive number")
    return timeout


def _status_record(text: str) -> tuple[str, str | None, str | None] | None:
    """Parse a shell status line, accepting JSON and the compact line format."""
    text = text.strip()
    if not text:
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None
    if isinstance(payload, dict):
        state = payload.get("status") or payload.get("state")
        token = payload.get("token")
        if isinstance(state, str):
            message = payload.get("message")
            return state.lower(), token if isinstance(token, str) else None, message if isinstance(message, str) else None
        return None

    fields = text.split(maxsplit=2)
    state = fields[0].rstrip(":").lower()
    if state not in {"ready", "error", "failed"}:
        return None
    if fields[0].endswith(":"):
        return state, None, text[len(fields[0]) :].strip() or None
    token = fields[1] if len(fields) >= 2 and not fields[1].startswith("-") else None
    message = fields[2] if len(fields) >= 3 else None
    return state, token, message


def read_startup_status(path: Path, token: str) -> tuple[str, str | None] | None:
    """Read a status only when it belongs to this adapter process."""
    try:
        record = _status_record(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeDecodeError):
        return None
    if record is None:
        return None
    state, status_token, message = record
    if status_token != token:
        return None
    return state, message


def wait_for_startup(
    process,
    status_path: Path,
    token: str,
    timeout: float,
    service_errors: list[BaseException] | None = None,
) -> tuple[str, str | None]:
    """Wait until the shell reports ready/error or exits/times out."""
    deadline = time.monotonic() + timeout
    while True:
        status = read_startup_status(status_path, token)
        if status is not None:
            return status
        if service_errors:
            error = service_errors[0]
            if isinstance(error, KeyboardInterrupt):
                return "service_interrupted", None
            return "service_error", str(error)
        returncode = process.poll()
        if returncode is not None:
            return "early_exit", str(returncode)
        if time.monotonic() >= deadline:
            return "timeout", None
        time.sleep(STARTUP_POLL_INTERVAL)


def resolve_shell() -> Path | None:
    configured = os.environ.get("MULTIWFN_MATTERVIZ_WEBVIEW")
    if configured:
        candidate = Path(configured).expanduser().resolve()
        return candidate if candidate.is_file() else None

    suffix = ".exe" if os.name == "nt" else ""
    here = Path(__file__).resolve()
    candidates = (
        here.parent / f"matterviz-desktop{suffix}",
        here.parents[1] / "frontend" / "matterviz-desktop" / "target" / "release" / f"matterviz-desktop{suffix}",
    )
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def main() -> int:
    parser = argparse.ArgumentParser(description="Launch the Multiwfn MatterViz WebView")
    parser.add_argument("--frontend", required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--state", default=None, help="Optional path to a workbench state JSON file")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--startup-timeout",
        type=float,
        default=None,
        help=f"Seconds to wait for the desktop shell (default: ${STARTUP_TIMEOUT_ENV} or {DEFAULT_STARTUP_TIMEOUT:g})",
    )
    args = parser.parse_args()

    frontend = Path(args.frontend).expanduser().resolve()
    session = Path(args.session).expanduser().resolve()
    manifest = Path(args.manifest).expanduser().resolve()
    state = Path(args.state).expanduser().resolve() if args.state else None

    server = None
    process = None
    status_path = session / STARTUP_STATUS_NAME
    service_thread = None
    service_thread_started = False
    service_errors: list[BaseException] = []
    service_started = threading.Event()
    window_closed = threading.Event()

    def failure(message: str) -> int:
        print(message, file=sys.stderr)
        signal_return(session)
        if server is not None and service_thread_started:
            try:
                server.shutdown()
            except (OSError, RuntimeError):
                pass
        return 2

    shell = resolve_shell()
    if shell is None:
        return failure(
            "MatterViz WebView executable not found; set MULTIWFN_MATTERVIZ_WEBVIEW to its path."
        )
    if not frontend.is_dir() or not manifest.is_file():
        return failure("MatterViz frontend or session manifest was not found.")
    if state is not None and not state.is_file():
        return failure(f"Workbench state not found: {state}")
    try:
        timeout = startup_timeout(args.startup_timeout)
    except ValueError as exc:
        return failure(f"MatterViz WebView startup failed: {exc}")

    token = secrets.token_hex(16)
    try:
        cleanup_startup_status(session)
        web.cleanup_session_files(session, startup=True)
        handler = web.make_handler(frontend, session, manifest, state)
        try:
            server = web.ThreadingHTTPServer((args.host, args.port), handler)
        except OSError:
            try:
                server = web.ThreadingHTTPServer((args.host, 0), handler)
            except OSError as second_error:
                return failure(f"Could not bind MatterViz WebView service: {second_error}")

        port = int(server.server_address[1])
        url = web.build_workbench_url(args.host, port, state=state)

        def service_runner() -> None:
            service_started.set()
            try:
                server.serve_forever()
            except BaseException as exc:
                service_errors.append(exc)

        service_thread = threading.Thread(target=service_runner, daemon=True)
        service_thread.start()
        service_thread_started = True
        # Let the service enter serve_forever before launching the shell. The
        # socket is already bound, but this removes a race for immediate page
        # requests and makes startup failure cleanup deterministic.
        service_started.wait(timeout=1.0)
        env = os.environ.copy()
        env[STARTUP_STATUS_ENV] = str(status_path)
        env[STARTUP_TOKEN_ENV] = token
        # Let the packaged shell observe the same session lifecycle flag as
        # the service/frontend, without deriving the path inside the shell.
        env[STOP_FILE_ENV] = str(session / "gui_stop.flag")
        try:
            process = subprocess.Popen([str(shell), "--url", url], env=env)
        except OSError as exc:
            return failure(f"Could not launch MatterViz WebView: {exc}")

        state, detail = wait_for_startup(process, status_path, token, timeout, service_errors)
        if state == "error" or state == "failed":
            message = detail or "desktop shell reported an error"
            return failure(f"MatterViz WebView startup error: {message}")
        if state == "early_exit":
            try:
                process.wait()
            except (OSError, subprocess.TimeoutExpired):
                pass
            return failure(f"MatterViz WebView exited before startup readiness (status {detail}).")
        if state == "timeout":
            return failure(f"MatterViz WebView startup timed out after {timeout:g} seconds.")
        if state == "service_interrupted":
            return failure("MatterViz WebView interrupted.")
        if state == "service_error":
            return failure(f"MatterViz WebView service failed: {detail or 'unknown error'}")
        if state != "ready":
            return failure("MatterViz WebView reported an invalid startup status.")

        def window_waiter() -> None:
            try:
                process.wait()
            except OSError:
                # The main path already owns concise startup/service failures;
                # a wait race during normal shutdown has no useful diagnostic.
                pass
            finally:
                window_closed.set()
                signal_return(session)
                try:
                    server.shutdown()
                except (OSError, RuntimeError):
                    pass

        threading.Thread(target=window_waiter, daemon=True).start()
        print(f"Multiwfn MatterViz WebView service: {url}")
        if service_thread is not None:
            join = getattr(service_thread, "join", None)
            if join is not None:
                join()
        if (session / "gui_stop.flag").is_file() and process.poll() is None:
            window_closed.wait(SHELL_STOP_GRACE_SECONDS)
        if service_errors:
            error = service_errors[0]
            if isinstance(error, KeyboardInterrupt):
                print("MatterViz WebView interrupted.", file=sys.stderr)
                return 2
            if isinstance(error, OSError):
                return failure(f"MatterViz WebView service failed: {error}")
            return failure(f"MatterViz WebView service failed: {error}")
        return 0
    except (OSError, RuntimeError) as exc:
        return failure(f"MatterViz WebView startup failed: {exc}")
    except KeyboardInterrupt:
        return failure("MatterViz WebView interrupted.")
    finally:
        signal_return(session)
        if service_thread is not None and getattr(service_thread, "is_alive", lambda: False)():
            try:
                service_thread.join(timeout=5)
            except RuntimeError:
                pass
        if server is not None:
            try:
                server.server_close()
            except OSError:
                pass
        if process is not None and process.poll() is None:
            try:
                process.terminate()
            except OSError:
                process = None
            if process is not None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        process.kill()
                    except OSError:
                        process = None
                    if process is not None:
                        try:
                            process.wait()
                        except OSError:
                            pass
                except OSError:
                    pass


if __name__ == "__main__":
    raise SystemExit(main())
