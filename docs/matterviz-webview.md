# MatterViz desktop WebView host

`frontend/matterviz-desktop` is the native Rust/Tauri host for the MatterViz
frontend. It owns both the session HTTP service and the operating-system
WebView; no Python service, adapter, or runtime is bundled or launched.

In normal use, the C/Fortran adapter starts the host directly with inherited
control and volume pipes. Fortran sends a versioned `session_init` message;
Rust validates and retains the manifest, structure and optional display state
in memory before opening HTTP and the WebView. Binary scalar fields travel on
the separate volume channel. The stable `/session/manifest.json` and
`/session/structure.json` URLs project these in-memory objects, and
`/api/volume/<id>` serves the resident volume data.

`/api/return`, window close and host shutdown use the control channel to return
to Multiwfn. The formal runtime creates no session directory, request/response
files, stop flag or temporary Cube. A pipe failure ends that session; it does
not silently switch to files. See the [control protocol](matterviz-control-protocol.md)
and [volume protocol](matterviz-volume-protocol.md) for ownership and framing.

File-backed startup remains an explicit diagnostic compatibility mode:

```text
matterviz-desktop --frontend <dist> --session <session> --manifest <manifest>
```

Only this diagnostic mode serves session files and writes `gui_stop.flag` on
return. Its manifest and artifacts remain in the selected session directory.
Both modes serve the built frontend assets from the package resources.

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

Build the frontend, then use a small file-backed session to diagnose the host
without running Multiwfn. This example deliberately uses the compatibility
mode above:

```sh
pnpm --dir frontend/matterviz-viewer install --frozen-lockfile
pnpm --dir frontend/matterviz-viewer build
mkdir -p multiwfn_matterviz_session
printf '{"cubes":[]}' \
  > multiwfn_matterviz_session/manifest.json
cargo run --manifest-path frontend/matterviz-desktop/Cargo.toml -- \
  --frontend frontend/matterviz-viewer/dist \
  --session "$PWD/multiwfn_matterviz_session" \
  --manifest "$PWD/multiwfn_matterviz_session/manifest.json" \
  --port 18765
```

Use the launched WebView URL, which includes its generated `cap` parameter,
to verify the session. `GET /session/manifest.json` reads the manifest;
`/api/return?cap=<capability>` requests an authenticated clean shutdown.
`--state <path>` optionally exposes one selected display-state file at
`/session/workbench-state.json`. Returning to the host root URL preserves
that state reference in both diagnostic and native in-memory sessions.
`--host`, `--port`, and `--startup-timeout` are available for local
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

The extracted-package smoke checks exercise file-backed diagnostic startup
and shutdown, including `gui_stop.flag`; this is not evidence of native pipe
operation. The C/Rust integration harness and real-orbital tests cover the
inherited transport. Native visual acceptance must additionally verify the
WebView on each platform; WKWebView requires an interactive macOS desktop.

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

On a machine without the desktop WebView development libraries, the existing
integration crate compiles the actual Rust service/transport modules and the
C publisher without Tauri:

```sh
cargo test --manifest-path tests/matterviz-volume-e2e/Cargo.toml --locked
cargo clippy --manifest-path tests/matterviz-volume-e2e/Cargo.toml --locked --all-targets -- -D warnings
```

These checks cover HTTP and pipe behavior, not native window rendering.

The default capability file grants no filesystem, shell, process, or other
frontend IPC permissions. The current host needs no Tauri command bridge; any
future bridge should add narrowly scoped permissions and document its threat
model here.
