# MatterViz maintenance audit — September 2026

Audited on 2026-09-11 against Multiwfn main `0662e4e` and MatterViz upstream
`9e4c3b8a` (2026-09-10, version 0.7.0). The maintenance changes stay in the
Rust host, frontend, vendored rendering adapter, tests and documentation.

## Rendering and state repairs

- ESP density surfaces used an automatically selected palette while the legend
  always showed pink/white/blue. Explicit ESP layers now default to the same
  palette, with white at physical zero even for asymmetric ranges. The legend
  follows subsequent user palette changes. Direct ESP surfaces use the same
  positive/negative colors; orbital colors retain their existing meaning.
- PR #54's material hook targeted a fragment-shader line that is absent before
  Three r185 expands includes. The repaired hook uses `opaque_fragment`, declares
  its uniforms, and uses the view direction supplied by Three. Rim contrast and
  angle-dependent opacity now affect the lit materials. These are local shading
  effects, not ambient occlusion or a new scientific surface calculation.
- The existing Surfaces inspector offers four finishes and bounded refinements.
  Presets preserve layer colors, isovalues, visibility and volume references.
  Periodic boundary padding belongs in Cell; it is not a lighting control.
- Native in-memory sessions previously lost their display-state query parameter
  when redirected from `/`. Rust now constructs the entry URL once after
  bootstrap and reuses it for startup and redirects.
- Arcball state restoration could update camera position/up without updating its
  actual orientation, leaving the molecule outside the view. External pose
  application now reconciles the quaternion as well as the numeric fields.
  Interactive rotation remains owned by the existing Arcball controls.

## Vendor lineage and upstream compatibility

The retained package lineage is `r24 → r25 → r25.material1`. Main's r25 includes
ordered measurements and bond context menus. PR #54's r26 derives from r24, so
replacing main with that archive would regress those features. The new package
replays a reviewable patch on main's r25; its lockfile pins the archive integrity.
The old archives remain available as replay bases. See the frontend README for
the reproduction command.

Upstream 0.7 is a migration project, not an interchangeable dependency update:

| Upstream change | Implication for this integration |
| --- | --- |
| Flat grids, PR #414 (`17266343`, July 17); multi-volume, PR #376 (July 13) | Already upstream. Reconcile representations before proposing duplicate work. |
| WebGPU/TSL renderer (`7bb3f286`, July 26) | Existing WebGL material hooks and native WebView support need a separate compatibility plan. |
| Viewer session/loader split (`a7c6fb68`, August 21) | Structure loading and reactive lifecycle have changed. |
| Stable volume IDs (`1c94584d`, September 9) | Map current `volume_idx`/`color_volume_idx` and grid fields to new ID/value/dimension APIs. |

The current upstream settings no longer expose this integration's material,
shininess and roughness API. Its source also lacks the local Arcball control
mode and the same explicit geometry-budget/release interface. An upgrade must
preserve pole-free rotation, bounded Worker meshing, prompt volume release,
periodic data, ordered measurement and in-memory host transport.

Useful fixes to evaluate individually in that migration include instance-buffer
reuse and hover lifecycle fixes (`dda2bd25`, #419), orthographic resize and PBC
measurement fixes (`a398507d`, #420), cylinder transform handedness (`cad120aa`,
#434), and stable camera fit extents (`4944cf88`, #460). These have not been
silently imported into the older renderer.

## Branch cleanup

Ten remote development branches were removed only after preserving a local Git
bundle and recording their exact heads. Eight heads were ancestors of main:

| Branch | Retained head |
| --- | --- |
| `agent/matterviz-exclusive-port` | `9b1b5d5` |
| `chore/project-attribution` | `400ecc7` |
| `codex/dynamic-release-version` | `cbda0b7` |
| `codex/esp-analysis-extrema` | `6b83816` |
| `codex/fix-label-layer-performance` | `8e93e4a` |
| `codex/gui-linux-compat` | `c44b620` |
| `feature/matterviz-gui` | `cdfeaaf` |
| `governance/core-source-protection` | `8c3a6d3` |

The other two were squash merges with identical complete trees:

- `feature/matterviz-native-plots` (`2c4980f`) equals PR #49's `5c653a9` in main.
- `codex/quantitative-surface-results` (`4f4e82b`) equals PR #57's `0cdb1a4` in
  the retained PR #56 branch. This work is still outside main.

Deletion used atomic pushes with each audited SHA as a lease. Historical
backups, `official-build`, `upstream-tracking`, PR #51/#54/#56 and branches with
independent commits remain. Local worktrees were preserved.

## Open issue follow-up

| Issue | Remaining work |
| --- | --- |
| [#53](https://github.com/Stardust0831/Multiwfn/issues/53) | Main still requires historical Qt/noGUI checks rather than a stable MatterViz gate. Introduce and validate an always-present aggregate check before migrating the ruleset. |
| [#15](https://github.com/Stardust0831/Multiwfn/issues/15) | CMake stages resources but does not install the full MatterViz host/frontend into a relocatable prefix. Test launch from an unrelated directory. |
| [#12](https://github.com/Stardust0831/Multiwfn/issues/12) | Versioned display state and `--state` exist; a complete headless visualization CLI and image-reproducibility suite do not. |
| [#10](https://github.com/Stardust0831/Multiwfn/issues/10) | Frontend operation logs exist; full Rust/runtime log capture and export remain incomplete. |
| [#11](https://github.com/Stardust0831/Multiwfn/issues/11) | MatterViz is selected. Periodic/nonorthogonal acceptance and upstream compatibility still need evidence. |
| [#58](https://github.com/Stardust0831/Multiwfn/issues/58) | Useful reference for external stdin/PTY orchestration. Keep scientific parsing and calculations in Multiwfn; process orchestration belongs outside the core. |
| [#50](https://github.com/Stardust0831/Multiwfn/issues/50) | The ORCA ECP fix branch has independent changes to protected computational source. It remains outside this frontend/host maintenance scope. |

No issue was closed by this audit. Code scan issues and settings were excluded.
PR #56 remains separate: its imported spectrum/broadening work needs its own
architecture review against the project's scientific-ownership principles.

## Validation

- Node 24.14 / pnpm 11.5: 181 frontend tests, 180 passed and one existing skip;
  Svelte check reports zero errors/warnings; Vite production build passes.
- Rust 1.88: 114 tests in the existing C/Rust integration crate pass; Clippy
  passes with warnings denied. This crate imports the actual desktop host modules.
- GUI path/build/adapter contracts: 37 tests, 36 passed and one existing skip.
  Tauri configuration and diff whitespace validation pass.
- The vendor patch replays to 766 byte-identical files. Final package SHA-256:
  `ceab506ef0cf5f8685049e75fb114db34f8ee9502d6d42090981d5e4d39d7a0a`.
- Chromium/SwiftShader rendered the existing real density/ESP Cube pair. Initial
  palette agreement, all four materials, rim controls and angle opacity were
  checked in the actual canvas with no page or shader errors. The sole missing
  resource was the development favicon. At the same camera pose, Soft gloss,
  rim shading and angle opacity changed 3.53%, 6.97% and 26.55% of viewport pixels
  respectively (RGB difference greater than 2/255).
- Four successive Arcball vertical drags retained the canvas. After changing
  materials and view, restoring the saved state recovered identical material,
  layer and camera values, the same live orientation, and a pixel-identical
  scene image. Numeric control readouts updated with sliders. 480/320px layouts
  retained a visible canvas without document overflow; explicit saved zoom is
  retained on resize and can crop the structure at narrow widths.

The browser run uses diagnostic Cube inputs, not a live scientific calculation.
Windows/macOS/Linux native WebView interaction and a full local Tauri build were
not performed here; GTK/WebKit development dependencies were unavailable.
Cross-platform package CI remains necessary. Existing large-bundle/CSS warnings
remain outside this maintenance change.
