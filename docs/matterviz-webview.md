# MatterViz desktop WebView shell

`frontend/matterviz-desktop` is a small Tauri 2 application that opens the
existing MatterViz frontend in the operating system WebView. It does not start
Multiwfn, run the Python service, or copy the backend/session protocol into the
desktop process. The normal data path remains:

```text
Multiwfn -> multiwfn_3dmol_server.py -> HTTP(S) URL -> Tauri WebView
```

The shell uses this URL by default:

```text
http://127.0.0.1:8765/index.html?manifest=/session/manifest.json
```

The URL can be overridden with `--url <URL>`, `--url=<URL>`, or the
`MATTERVIZ_WEB_URL` environment variable. Command-line arguments take
precedence over the environment. Plain `http` URLs are restricted to
`localhost`, `127.0.0.1`, or `::1`; `https` URLs may use a remote host for
deployments where the visualization service is hosted elsewhere.

## Prerequisites

- Node.js 22.23 and pnpm 11 for the MatterViz frontend (see its README).
- Python 3.11 or newer for the existing local HTTP service.
- Rust 1.77 or newer and the Tauri CLI 2.x for desktop development/builds.
- Platform WebView dependencies:
  - Windows: WebView2 Evergreen Runtime (normally present on supported Windows).
  - macOS: Xcode Command Line Tools and the system WKWebView framework.
  - Linux: GTK/WebKitGTK development packages required by Tauri 2 (the exact
    package names depend on the distribution).

The shell does not require Qt. It also does not require a running Rust toolchain
for the static validation command below.

## Development

From the repository root (`matterviz-gui`), build the frontend and start the
existing service in one terminal:

```sh
pnpm --dir frontend/matterviz-viewer install
pnpm --dir frontend/matterviz-viewer build
python3 tools/multiwfn_3dmol_server.py \
  --frontend frontend/matterviz-viewer/dist \
  --session multiwfn_3dmol_session \
  --manifest multiwfn_3dmol_session/manifest.json
```

In a second terminal, run the shell:

```sh
cd frontend/matterviz-desktop
cargo tauri dev -- --url http://127.0.0.1:8765/index.html?manifest=/session/manifest.json
```

For a different local port or path, use `MATTERVIZ_WEB_URL` instead:

```sh
MATTERVIZ_WEB_URL=http://localhost:9000/ cargo tauri dev
```

An HTTPS visualization service can use any host:

```sh
MATTERVIZ_WEB_URL=https://viz.example.invalid/session cargo tauri dev
```

For standalone shell development, the server must be started separately and
must remain available while the window is open. In a Multiwfn build configured
with `MULTIWFN_3DMOL_DEFAULT_SHELL=webview`,
`tools/multiwfn_matterviz_webview.py` starts the session service, selects an
available port, passes the exact URL to this executable, and closes the service
when the window exits. Set `MULTIWFN_MATTERVIZ_WEBVIEW` to a development binary
when it is not installed next to the packaged launcher.

## Build and package

The Tauri config points `frontendDist` at `../matterviz-viewer/dist` so the
Tauri CLI can validate/package the frontend distribution. The Rust entry point
still creates an external WebView URL at runtime; the Python service and
session files are never bundled or launched by this shell.

```sh
cd frontend/matterviz-desktop
cargo tauri build
```

To exercise the integrated Multiwfn launch path from a source build:

```sh
cmake -S . -B build-matterviz-webview -G Ninja \
  -DMULTIWFN_GUI_BACKEND=3dmol \
  -DMULTIWFN_WEB_FRONTEND=matterviz \
  -DMULTIWFN_3DMOL_DEFAULT_SHELL=webview
cmake --build build-matterviz-webview
MULTIWFN_MATTERVIZ_WEBVIEW="$PWD/frontend/matterviz-desktop/target/release/matterviz-desktop" \
  build-matterviz-webview/Multiwfn_3DmolGUI
```

Start the packaged application while a local service is running. To select a
non-default local URL:

```sh
MATTERVIZ_WEB_URL=http://127.0.0.1:9010/ ./target/release/matterviz-desktop
```

The exact executable path and package format are platform-specific. Tauri
produces Windows (WebView2), macOS (WKWebView), and Linux (WebKitGTK) bundles
when the corresponding host prerequisites are installed.

## Static validation

This command parses `Cargo.toml`, `tauri.conf.json`, and the capability file
without Rust, Cargo, or Tauri installed:

```sh
python3 frontend/matterviz-desktop/scripts/validate-config.py
```

With the Rust toolchain available, the additional checks are:

```sh
cd frontend/matterviz-desktop
cargo check
cargo tauri info
```

The default capability file grants no filesystem, shell, process, or other
frontend IPC permissions. The current shell needs no Tauri command bridge; any
future bridge should add narrowly scoped permissions and document its threat
model here.
