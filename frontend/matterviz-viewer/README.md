# Multiwfn MatterViz frontend

This is an experimental frontend developed independently from the current 3Dmol implementation.
It consumes the same Multiwfn session manifest and serialized backend API, so the Fortran
calculation modules remain unchanged.

The prototype pins MatterViz pull request
[`janosh/matterviz#376`](https://github.com/janosh/matterviz/pull/376) at commit
`b9ec891d617f7885b5a688c92e78454b08572c29`. That revision includes the periodic coordinate
fix from [`janosh/matterviz#377`](https://github.com/janosh/matterviz/pull/377).

## Build

Node.js 24 and pnpm 11 are recommended.

```bash
pnpm install
pnpm check
pnpm build
```

Serve `dist/` with the existing Multiwfn GUI service:

```bash
python3 tools/multiwfn_3dmol_server.py \
  --frontend frontend/matterviz-viewer/dist \
  --session multiwfn_3dmol_session \
  --manifest multiwfn_3dmol_session/manifest.json \
  --open
```

## Desktop shell

The frontend is deliberately independent of its desktop window. It can run in a normal browser
or be wrapped by Tauri (WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux) without
changing the manifest or backend API. Qt is therefore optional rather than part of the MatterViz
frontend architecture.

Build a Multiwfn executable which selects this frontend with:

```bash
cmake -S ../.. -B ../../build-matterviz-gui -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMULTIWFN_GUI_BACKEND=3dmol \
  -DMULTIWFN_WEB_FRONTEND=matterviz \
  -DMULTIWFN_3DMOL_DEFAULT_SHELL=browser
cmake --build ../../build-matterviz-gui --parallel 2
```

The `3dmol` backend name currently denotes the shared HTTP/session adapter; selecting MatterViz
does not load or use the 3Dmol frontend. This temporary name avoids touching Multiwfn calculation
modules while the generic web adapter is being separated.

MatterViz is distributed under the MIT license. Multiwfn remains under its original license.
