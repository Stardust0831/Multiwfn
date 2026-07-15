# MatterViz upstream issue and PR drafts

Status: local draft only. Do not publish an issue or open a PR until the
Multiwfn prerelease has passed manual acceptance and each change has been
rebased onto the then-current MatterViz upstream branch.

The current `matterviz-rendering` branch is a vendor integration branch, not a
ready upstream PR branch. It contains several dependent commits and local
Multiwfn validation work. Upstream submissions should be reconstructed as the
small, ordered changes below and must exclude Multiwfn HTTP/session protocols,
capability tokens, orbital endpoints and release packaging.

## Proposed PR series

### 1. Flat scalar grids

Title: `feat(isosurface): support flat typed scalar grids`

Summary:

- Add a generic `ScalarGrid3D` representation backed by `Float32Array` or
  `Float64Array`, with dimensions and explicit x-fastest/z-fastest ordering.
- Keep legacy nested arrays compatible through one shared accessor.
- Route parsing, sampling, slicing, periodic tiling, downsampling and marching
  cubes through the same index contract.
- Add numerical-parity tests for Cube/VASP-style layouts and a large-grid test
  proving preparation retains one flat buffer.

Rationale: this is useful for Cube, CHGCAR/LOCPOT, density, ELF, ESP, orbitals,
periodic fields and slices. It is not a Multiwfn transport type.

Keep out: SharedArrayBuffer negotiation, Multiwfn binary frame headers, HTTP
volume IDs and process memory budgets.

### 2. Worker meshing and explicit geometry lifecycle

Title: `feat(isosurface): move cancellable meshing off the main thread`

Summary:

- Run marching cubes in a Worker and transfer ordinary ArrayBuffers where
  ownership permits.
- Key requests by volume identity and generation so a newer isovalue cancels or
  supersedes stale work.
- Add explicit retain/release APIs for derived geometry and dispose unreferenced
  buffers immediately.
- Enforce one resident-geometry budget across surfaces and report allocation or
  Worker failures through `on_geometry_error`.

Tests: synchronous/Worker parity, request supersession, returned buffer
ownership, release during queued work, geometry budget rejection and error
relay through `StructureScene` and `StructureViewport`.

Dependency: submit after flat scalar grids. Keep Multiwfn cache policies and
backend recomputation behavior out of this PR.

### 3. Declarative structure-camera state

Title: `feat(structure): expose complete declarative camera pose`

Summary:

- Expose bindable camera position, target, up, orthographic zoom and projection.
- Preserve external commands across camera/control recreation.
- Capture a stable reset snapshot outside keyed control subtrees.
- Keep per-pane state isolated in multi-view layouts.
- Publish camera state at a bounded animation-frame rate and skip numerically
  identical updates.

Tests: up/zoom type surface, perspective vs orthographic behavior, reset after
rotation and roll, rekey behavior and multi-view ownership.

This PR should land before Arcball so the new control mode reuses one camera
state and reset contract.

### 4. Opt-in Arcball controls

Title: `feat(scene): add an opt-in pole-free Arcball camera mode`

Summary:

- Add `camera_control_mode: 'orbit' | 'arcball'`; retain Orbit as the default.
- Wrap Three.js `ArcballControls` for left rotate, right/Ctrl-left pan,
  middle/wheel zoom and edge circular roll.
- Disable inertia, focus gestures, FOV gestures and internal Arcball gizmos.
- Preserve the existing axis gizmo adapter, auto-rotate, reset and exported
  camera pose.
- Keep live Three camera motion inside the controls during a gesture and publish
  the final declarative pose on interaction end, avoiding reactive feedback.
- Hide Orbit-only damping and pan-sensitivity controls in Arcball mode.

Tests: repeated pole traversal, circular roll, no post-release inertia,
orthonormal reset, panned native `reset()`, gizmo compatibility, auto-rotate
pause and Orbit-default regression. Browser acceptance should cover desktop and
compact viewports with zero page errors.

Compatibility note: the wrapper currently reads Three r185's private
`_gizmos.position` because its public `target` is stale after pan. Pin the Three
minor version and retain a focused compatibility test until Three exposes a
public rotation-center accessor.

### 5. Native structure fidelity edge cases

Title: `fix(structure): preserve explicit bonds, periodic shifts and ghost sites`

Summary:

- Preserve explicit bond order and periodic cell-shift metadata from structured
  inputs instead of re-inferring connectivity.
- Keep raw periodic structure identity stable while constructing display images.
- Represent labeled zero-charge/ghost centers without coercing them to a real
  chemical element.

Before proposing this PR, split the changes by parser/model concern if the
upstream code has independent ownership boundaries. Fixtures must be generic
structured data, not Multiwfn session artifacts.

## Issue draft: rendering smoothness and mesh quality

Title: `Expose bounded isosurface mesh-quality controls without blocking camera interaction`

Body:

> Large scientific scalar fields need two independent controls: the sampling
> resolution used to compute a surface and the visual smoothness/normals used to
> inspect it. MatterViz currently has no small, generic API matching this use
> case. A useful design should keep camera interaction responsive, avoid silently
> changing scientific isovalues, and report the memory/triangle cost before
> allocation.
>
> Proposed investigation:
>
> - benchmark normal generation and optional bounded post-mesh smoothing;
> - distinguish display smoothing from scalar-field resampling;
> - keep exact marching-cubes output available as the default/reference;
> - expose cancellation and a geometry budget for every quality change;
> - test sharp features, periodic boundaries, degenerate cells and surfaces near
>   the maximum triangle budget.
>
> `solid+mesh` overlays and biomolecular Cartoon rendering are intentionally out
> of scope.

## Upstream acceptance checklist

- [ ] Rebase each proposal independently onto current MatterViz upstream.
- [ ] Confirm no Multiwfn-specific protocol, endpoint or product text remains.
- [ ] Run MatterViz focused tests, full check/build and publint/package checks.
- [ ] Add browser evidence for changes that affect WebGL interaction.
- [ ] Document new public types and compatibility defaults.
- [ ] Request upstream review one PR at a time; do not submit this combined draft.
