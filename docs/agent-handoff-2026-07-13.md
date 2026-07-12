# Agent handoff: Multiwfn GUI and build work

Date: 2026-07-13

This note records the current repository state and the active work streams so a
new agent can continue without reconstructing context from the chat history.

## Repositories and local worktrees

Main Multiwfn repository:

- Local worktree: `/mnt/g/work/multiwfn/Multiwfn_2026.6.2_src_Linux`
- Remote: `git@github.com:Stardust0831/Multiwfn.git`
- Current local branch in that worktree: `main`
- Important state: local `main` is old and should not be used for new commits
  without switching to `origin/main`. `origin/main` is at
  `d204ae429752617b6fce82ee45012bbe07ddb64c`.
- Local untracked runtime/build outputs in that worktree:
  `build-gui-local/` and `multiwfn_3dmol_session/`. They are not source changes.

Multiwfn MatterViz GUI integration worktree:

- Local worktree: `/mnt/g/work/multiwfn/matterviz-gui`
- Branch: `feature/matterviz-gui`
- Base at the time of this note: `origin/main`
- Purpose: keep the existing Multiwfn 3Dmol HTTP/session adapter, but allow a
  MatterViz frontend to be staged and served instead of the 3Dmol frontend.
- Current source changes are intentionally limited to CMake, the GUI adapter,
  the shared Python server naming, and `frontend/matterviz-viewer/`.

MatterViz rendering experiment:

- Local worktree: `/mnt/g/work/multiwfn/matterviz-rendering`
- Remote: `https://github.com/Stardust0831/matterviz.git`
- Branch: `feature/rendering-quality`
- Purpose: improve MatterViz molecular rendering quality for the Multiwfn GUI
  use case, including element colors, atom/bond materials, outline controls,
  light controls, and isosurface material controls.
- Based on the upstream multi-volume isosurface branch that is expected to
  support density/ESP paired volume visualization.

Other relevant local worktrees:

- `/mnt/g/work/multiwfn/pr22-resolution`: old detached PR #22 review worktree.
- `/mnt/g/work/multiwfn/matterviz-pr376-windows`: Windows preview/deployment
  worktree for the MatterViz multi-volume branch; it contains local build output
  and should not be used as the authoritative source branch.

## Current GitHub PR state

Open Multiwfn PR:

- `#25 Add analysis output plots and live ESP progress`
- Branch: `codex/analysis-output-plots`
- Latest commit: `d41de39f9e8c379403a672e587be87150d6b4ab7`
- Status when checked: blocked because `Protect Multiwfn core source / Core
  source guard` failed.
- Other checks were passing: noGUI Linux/macOS/Windows builds, GUI Linux/macOS/
  Windows packages, GUI Linux glibc 2.28 compatibility, and CodeRabbit.
- CodeRabbit left actionable comments around analysis endpoint error handling,
  gamma label normalization, and large text input limits. Those need review
  before merge.
- The source guard failure is expected to need a conscious decision because the
  PR modifies Fortran core-related files such as `define.f90`, `grid.f90`, and
  `noGUI/GUI_3dmol.f90` to support live ESP progress and analysis manifests.

Recently closed/merged context:

- PRs #21, #22, and #23 were deleted from remote tracking after fetch, indicating
  they were already merged or closed before this handoff.
- The 3Dmol ESP/density work from #22 is now part of `origin/main`.

## Current design decisions

- Keep Multiwfn calculation modules as stable as possible. Normal GUI work
  should touch CMake, GUI adapter code, frontend code, and packaging only.
- Use a front-end/back-end split. The Fortran side writes a session manifest and
  exposes a local HTTP API; a web frontend renders the session.
- The existing `3dmol` backend name currently means "shared HTTP/session GUI
  adapter", not necessarily the 3Dmol renderer. The MatterViz branch adds
  `MULTIWFN_WEB_FRONTEND=matterviz` while reusing this adapter.
- Qt is no longer required as the long-term desktop shell. A native WebView
  wrapper is acceptable and probably preferable if it can package cleanly across
  Windows, macOS, and Linux while reusing exactly the same web frontend as
  `--web`.
- Browser/WebView mode should remain capable of remote server-side visualization
  so large cube files can stay on the server.
- VMD integration is abandoned for this project direction.

## Multiwfn MatterViz GUI branch details

The current `feature/matterviz-gui` changes:

- Add `MULTIWFN_WEB_FRONTEND` CMake option with values `3dmol` and `matterviz`.
- Stage `frontend/matterviz-viewer/dist` into runtime resources when
  `MULTIWFN_WEB_FRONTEND=matterviz`.
- Define `MULTIWFN_WEB_FRONTEND_MATTERVIZ` so `noGUI/GUI_3dmol.f90` resolves the
  frontend path to `frontend/matterviz-viewer/dist`.
- Generalize `tools/multiwfn_3dmol_server.py` messages from hard-coded 3Dmol to
  "3Dmol" or "MatterViz" based on the served frontend path.
- Add `frontend/matterviz-viewer/`, a minimal Svelte/Vite frontend that consumes
  the same Multiwfn manifest/backend API. Its README explains that Tauri/WebView
  can be used later as a desktop shell without changing the backend protocol.
- Add `.github/workflows/matterviz-gui.yml` to check and build the frontend and
  then compile Multiwfn with `MULTIWFN_WEB_FRONTEND=matterviz`.

Do not commit `frontend/matterviz-viewer/node_modules/` or `dist/`; they are
ignored by the nested `.gitignore`. CI builds the frontend before CMake
configuration.

Suggested next checks for this branch:

```bash
cd /mnt/g/work/multiwfn/matterviz-gui/frontend/matterviz-viewer
pnpm install --frozen-lockfile
pnpm check
pnpm build

cd /mnt/g/work/multiwfn/matterviz-gui
cmake -S . -B build-matterviz-gui -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMULTIWFN_GUI_BACKEND=3dmol \
  -DMULTIWFN_WEB_FRONTEND=matterviz \
  -DMULTIWFN_3DMOL_DEFAULT_SHELL=browser
cmake --build build-matterviz-gui --parallel 2
```

## MatterViz rendering branch details

The current `feature/rendering-quality` changes are an experimental visual
quality pass:

- Adds a molecular element color scheme and makes it the default.
- Adds material style controls for atoms and isosurfaces.
- Adds atom/bond outline options.
- Improves bond shader lighting and color handling.
- Adds light controls in the structure scene.
- Keeps the work focused on rendering controls and visual defaults.

Important issue found during earlier testing:

- Some cube material changes previously made the whole isosurface white. This
  branch attempts to avoid that by recreating materials when the vertex-color
  path changes and by exposing explicit material modes, but it still needs
  browser validation on representative ESP examples.

Suggested next checks for this branch:

```bash
cd /mnt/g/work/multiwfn/matterviz-rendering
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm dev --host 127.0.0.1 --port 3760
```

Then open:

```text
http://127.0.0.1:3760/structure/multi-volume?scenario=glycine-esp
```

Also test the COF periodic ESP screenshot case if the required input files are
available; the reference image in the shared workspace is
`/mnt/g/work/multiwfn/cof12000n2_esp_vdw_surface_vesta_zoom_bonds.png`.

## User priorities

- GUI should feel closer to VESTA than the old DISLIN GUI for camera rotation,
  zoom, selection, bond/angle/dihedral measurement, lighting, and materials.
- Must support periodic systems, including non-integer expansion factors.
- Structure and cube layers should be independent. A cube can be periodic even
  when the structure layer does not have explicit periodic topology.
- Must support multiple cube layers.
- Must support coloring one cube isosurface by another cube. The simplest first
  target is strict grid matching: same origin, axis vectors, step counts, and
  voxel ordering.
- Must support 2D slices and analysis plots eventually.
- GUI logs should live inside the GUI with a button to view them, not spam the
  terminal by default.
- A matching CLI/export path is desired so rendered states can be recreated from
  scripts using camera, material, color scale, and layer settings.
- Release artifacts must include all runtime dependencies and official Multiwfn
  license/settings files.

## WebView direction

The latest product decision is that the Qt shell can be replaced by a WebView
shell. The likely approach is:

- Keep the local HTTP/session backend.
- Keep the same frontend for browser, remote `--web`, and desktop.
- Add a thin desktop shell later, probably Tauri or another WebView wrapper:
  WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux.
- Do not start by rewriting the calculation backend or the GUI protocol.
- Evaluate packaging size and runtime dependencies before committing to a shell.

## Immediate next actions

1. Push the saved branches so future agents can start from GitHub rather than
   local-only work.
2. Review PR #25 before merge. It is large and currently blocked by the source
   guard, so decide whether those Fortran edits are acceptable for that PR.
3. Continue the MatterViz GUI experiment on `feature/matterviz-gui`.
4. Continue the MatterViz visual quality pass on `feature/rendering-quality`.
5. When merging any GUI branch into main, verify all required GitHub Actions:
   noGUI all platforms, GUI all platforms, old Linux GUI compatibility, and the
   core source guard.

