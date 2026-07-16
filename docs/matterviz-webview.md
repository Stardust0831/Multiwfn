# MatterViz desktop WebView host

`frontend/matterviz-desktop` is the native Rust/Tauri host for the MatterViz
frontend. It owns both the session HTTP service and the operating-system
WebView; no Python service, adapter, or runtime is bundled or launched.

The Multiwfn backend creates a fresh `multiwfn_matterviz_session_*` directory
for each GUI launch. It then starts the host directly:

```text
matterviz-desktop --frontend <dist> --session <session> --manifest <manifest>
```

The host serves the frontend and session files from loopback, including the
existing `/api/return` endpoint. A return request writes `gui_stop.flag`, stops
the service, and closes the host process. The manifest and artifacts remain in
the session directory for the lifetime of the GUI.

Each managed launch creates a random API capability in the WebView URL. The
frontend propagates it to orbital, bond, ESP and Return requests. The service
also requires a single `Host` header matching its actual loopback authority,
including the selected fallback port; this prevents unrelated web origins and
DNS rebinding from reading a session or triggering calculations.

## Prerequisites

- Node.js 24.11 or newer and pnpm 11 for the MatterViz frontend.
- Rust 1.88 or newer for the desktop host.
- Platform WebView dependencies:
  - Windows: Microsoft Edge WebView2 Evergreen Runtime.
  - macOS: Xcode Command Line Tools and the system WKWebView framework.
  - Linux: GTK/WebKitGTK development packages required by Tauri 2 (package
    names depend on the distribution); the native file picker uses the XDG
    desktop portal when invoked.

Python is not required by the MatterViz runtime. Python-based repository tools
and tests remain development-only and are not copied into a package.

## Development

Build the frontend, then start the native host with a session manifest:

```sh
pnpm --dir frontend/matterviz-viewer install --frozen-lockfile
pnpm --dir frontend/matterviz-viewer build
mkdir -p multiwfn_matterviz_session
printf '{"structure":{"path":"structure.json","format":"json"},"cubes":[]}' \
  > multiwfn_matterviz_session/manifest.json
cargo run --manifest-path frontend/matterviz-desktop/Cargo.toml -- \
  --frontend frontend/matterviz-viewer/dist \
  --session "$PWD/multiwfn_matterviz_session" \
  --manifest "$PWD/multiwfn_matterviz_session/manifest.json" \
  --port 18765
```

Use `GET http://127.0.0.1:18765/session/manifest.json` to verify that the
service has started. `GET http://127.0.0.1:18765/api/return` requests a clean
shutdown. `--host`, `--port`, and `--startup-timeout` are available for local
development and CI; managed launches may set `MULTIWFN_MATTERVIZ_HOST` and
`MULTIWFN_MATTERVIZ_PORT` when a fixed test endpoint is required.

For a remote visualization service, the standalone URL mode remains available:

```sh
cargo run --manifest-path frontend/matterviz-desktop/Cargo.toml -- \
  --url https://viz.example.invalid/session
```

Plain HTTP URLs are restricted to `localhost`, `127.0.0.1`, or `::1`; HTTPS may
use a remote host.

## Build and package

The Tauri config points `frontendDist` at `../matterviz-viewer/dist`, allowing
the Tauri CLI to validate/package the built frontend:

```sh
pnpm --dir frontend/matterviz-viewer build
cargo build --manifest-path frontend/matterviz-desktop/Cargo.toml --release --locked
cmake -S . -B build-matterviz-webview \
  -DCMAKE_BUILD_TYPE=Release \
  -DMULTIWFN_GUI_BACKEND=matterviz
cmake --build build-matterviz-webview --parallel
```

The resulting package contains `Multiwfn_MatterVizGUI` (or `.exe`),
`resources/tools/matterviz-desktop` (or `.exe`), and
`resources/frontend/matterviz-viewer/dist`. It does not contain the historical
`multiwfn_matterviz_server.py`, `multiwfn_matterviz_webview.py`, or
`multiwfn_matterviz_file_dialog.py` launchers and has no Python runtime
requirement.

Linux and Windows extracted-package checks start the Rust host directly, poll
the session manifest route, call `/api/return`, and require a clean process exit
with `gui_stop.flag`. macOS extracted checks remain limited to non-interactive
binary/resource validation because WKWebView needs an interactive desktop.

## Static validation

Without a full toolchain, validate the Tauri configuration with:

```sh
python3 frontend/matterviz-desktop/scripts/validate-config.py
```

With Rust available:

```sh
cargo test --manifest-path frontend/matterviz-desktop/Cargo.toml --locked
cargo check --manifest-path frontend/matterviz-desktop/Cargo.toml --locked
```

The default capability file grants no filesystem, shell, process, or other
frontend IPC permissions. The current host needs no Tauri command bridge; any
future bridge should add narrowly scoped permissions and document its threat
model here.
