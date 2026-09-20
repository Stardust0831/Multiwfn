# MatterViz correctness backports, 2026-09-20

The retained workbench2 renderer accepts interleaved multi-field Cubes as one
field and zero-pads truncated volume data. Its block-averaged display grid also
assigns averages to different physical sample positions. Backport the relevant
upstream fixes without replacing the renderer, volume/session schema or native
host protocol.

## Sources and retained package

- [MatterViz #461](https://github.com/janosh/matterviz/pull/461),
  `5da7dcd80f85d33a06bda753b09b65f2672c58a4`: volume input/allocation guards,
  endpoint-aligned geometry preparation, CRLF detection and bounded inflation.
- Current parser/error behavior checked against [#471](https://github.com/janosh/matterviz/pull/471),
  `9837812e9f8cfbe22bb66fb67a746b27745a4277`.
- Base: `matterviz-0.4.2-multiwfn.d8719d12.r25.workbench2.tgz`.
- Result: `matterviz-0.4.2-multiwfn.d8719d12.r25.upstream1.tgz`.
- SHA-256: `4accf3cfc782ae8e260047eed225e8a431a38a218caa273652c36fb2ba2487d2`.

`frontend/matterviz-viewer/vendor/patches/` contains the reviewable upstream1
patch. Apply it with `patch -p1` inside workbench2's extracted `package/`.
The replay test compares every packaged file and permits changes only to the
eight files listed below. The lockfile pins the new archive's integrity.

## Included behavior

| Area | Result |
| --- | --- |
| Cube multi-field headers | NVAL and orbital counts other than one fail explicitly, with instructions to split the file. A single orbital header remains supported. |
| Truncated volume data | Cube and the CHGCAR charge block fail before publishing a partially zero-filled volume. If only CHGCAR magnetization is truncated, retain the complete charge block and omit the incomplete second field. |
| Header/number validation | Validate grid dimensions before allocation, reject implausibly large declarations, detect missing atom/header data and singular Cube axes, support Fortran D exponents, and reject invalid/non-finite values. |
| Parser errors | Recognized formats throw local errors with filename context. Unknown content still returns null. Both `.cub` and `.cube`, including compression suffixes, are recognized. |
| Finite Cube geometry | N sample points span N−1 voxel intervals; periodic grids still span N intervals. |
| Display sampling | Prepare bounded geometry by interpolation at its actual fractional endpoints instead of block averaging, including integer tiling and halo/range windows. |
| Managed memory path | Preserve the original typed grid and its buffer; use the correct periodic marching-cubes mode to close the last voxel without copying an N+1 grid. Cache identities distinguish preparation modes. |
| Text/decompression | Count CRLF and tabs as text; stop decompression while inflated output exceeds 2 GiB, before buffering the whole result. |

Changed package files: `dist/isosurface/parse.js`,
`dist/isosurface/sampling.{js,d.ts}`, `dist/isosurface/Isosurface.svelte`,
`dist/io/is-binary.js`, `dist/io/decompress.{js,d.ts}`, and `package.json`.

These changes adapt upstream behavior to the existing typed-grid and memory
ownership APIs. They are not a wholesale cherry-pick of the upstream commits.
Topology/surface picking, materials, Arcball, binned-value coloring, bilingual
controls and native transport remain in the retained package lineage.

## Validation

- Twelve executable upstream regression cases exercise the installed package:
  valid/invalid Cube and CHGCAR data, physical finite-grid coordinates, allocation
  guards, Fortran exponents, CRLF, inflated-stream boundaries, analytic planes in
  orthogonal/skew cells, retained buffers, periodic spacing and tiled/ranged grids.
- Full frontend suite: 262 pass, one existing skip. Svelte check: no errors or
  warnings. Production build passes with the existing large-bundle warning.
- Seven vendor replay/composition tests pass, including byte-identical replay
  from workbench2 to upstream1 and preservation of the previous extensions.
- The installed package passes the real Chromium/SwiftShader topology, picking
  and volume-visibility browser regression, including restoration of hidden
  volume geometry after switching analysis views.

Native platform packaging is validated by the PR's MatterViz CI. Local browser
acceptance and final CI results are recorded in the PR description.

## Deferred migration

WebGPU/TSL materials, stable volume-ID/schema migration, the new export context,
camera flights, thermal analysis and the broad #468/#469 renderer refactors need
a separate integration. Updating the dependency to published v0.7.0 would not
include these September fixes. The current local pan-button direction issue is
also separate from this backport.
