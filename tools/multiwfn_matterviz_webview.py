#!/usr/bin/env python3
"""Run the Multiwfn session service and open it in the MatterViz WebView shell."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys
import threading

import multiwfn_3dmol_server as web


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
    args = parser.parse_args()

    frontend = Path(args.frontend).expanduser().resolve()
    session = Path(args.session).expanduser().resolve()
    manifest = Path(args.manifest).expanduser().resolve()
    state = Path(args.state).expanduser().resolve() if args.state else None

    def failure(message: str) -> int:
        print(message, file=sys.stderr)
        signal_return(session)
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

    server = None
    process = None
    try:
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
        try:
            process = subprocess.Popen([str(shell), "--url", url])
        except OSError as exc:
            return failure(f"Could not launch MatterViz WebView: {exc}")

        def window_waiter() -> None:
            try:
                process.wait()
            except OSError as exc:
                print(f"MatterViz WebView process wait failed: {exc}", file=sys.stderr)
            finally:
                signal_return(session)
                server.shutdown()

        threading.Thread(target=window_waiter, daemon=True).start()
        print(f"Multiwfn MatterViz WebView service: {url}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("MatterViz WebView interrupted.", file=sys.stderr)
            return 2
        except OSError as exc:
            return failure(f"MatterViz WebView service failed: {exc}")
        return 0
    except OSError as exc:
        return failure(f"MatterViz WebView startup failed: {exc}")
    except KeyboardInterrupt:
        print("MatterViz WebView interrupted.", file=sys.stderr)
        return 2
    finally:
        signal_return(session)
        if server is not None:
            server.server_close()
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
