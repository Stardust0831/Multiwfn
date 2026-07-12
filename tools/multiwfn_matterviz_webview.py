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
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    frontend = Path(args.frontend).expanduser().resolve()
    session = Path(args.session).expanduser().resolve()
    manifest = Path(args.manifest).expanduser().resolve()
    shell = resolve_shell()
    if shell is None:
        print(
            "MatterViz WebView executable not found; set MULTIWFN_MATTERVIZ_WEBVIEW to its path.",
            file=sys.stderr,
        )
        return 2
    if not frontend.is_dir() or not manifest.is_file():
        print("MatterViz frontend or session manifest was not found.", file=sys.stderr)
        return 2

    web.cleanup_session_files(session, startup=True)
    handler = web.make_handler(frontend, session, manifest)
    try:
        server = web.ThreadingHTTPServer((args.host, args.port), handler)
    except OSError:
        server = web.ThreadingHTTPServer((args.host, 0), handler)
    port = int(server.server_address[1])
    url_host = f"[{args.host}]" if ":" in args.host and not args.host.startswith("[") else args.host
    url = f"http://{url_host}:{port}/index.html?manifest=/session/manifest.json"
    process = subprocess.Popen([str(shell), "--url", url])

    def window_waiter() -> None:
        process.wait()
        if not (session / "gui_stop.flag").exists():
            (session / "gui_stop.flag").write_text("return\n", encoding="utf-8")
        server.shutdown()

    threading.Thread(target=window_waiter, daemon=True).start()
    print(f"Multiwfn MatterViz WebView service: {url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        (session / "gui_stop.flag").write_text("return\n", encoding="utf-8")
    finally:
        server.server_close()
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
