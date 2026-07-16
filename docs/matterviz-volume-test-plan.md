# MatterViz binary volume test plan

Updated: 2026-07-14

## Codec gates

- Rust and TypeScript decode the same checked-in golden hex frames.
- Use asymmetric dimensions and sentinel samples to prove
  `i_fastest_fortran` and `k_fastest_cube` mapping.
- Cover oblique voxel axes, an independent lattice, signed orbital values, and
  all three quantity/value-unit pairs.
- Prove that MatterViz grid geometry comes from `voxel_axes * dimensions` for
  periodic axes and `voxel_axes * (dimensions - 1)` for finite axes, not the
  independent unit-cell lattice; reject partially periodic adaptation until
  MatterViz exposes per-axis volumetric boundary conditions. Reject singleton
  finite axes because their zero physical span cannot define an invertible 3D
  rendering lattice.
- Reject truncation, trailing bytes, bad magic, unsupported major/message type,
  invalid flags/enums, nonzero reserved fields, bad CRC32C, zero dimensions or
  IDs, overflow, inconsistent byte counts/statistics, nonfinite metadata or
  samples, and all configured size-limit violations.
- Compare a small Cube fixture and binary fixture numerically after frontend
  adaptation, including coordinates, lattice, grid values, and data range.

## HTTP/store gates

- `/api/volume/<id>` requires the current session capability and loopback Host,
  returns the exact bytes and binary MIME type, and rejects unknown/evicted IDs.
- Bound entry count and total bytes; test deterministic LRU eviction, concurrent
  reads, shutdown, Return, and no cross-session visibility.
- Binary entries dispatch by `format`; Cube entries and legacy entries without a
  binary format retain their existing parser path.

## Pipe and lifecycle gates

- Fake producers cover fragmented headers/bodies, partial writes, slow reader,
  broken pipe, producer exit mid-frame, duplicate IDs, cancellation, shutdown,
  and fallback after failed negotiation.
- Ready/ACK tests require ACK-after-store-insert ordering, exact request/volume
  correlation, nonzero rejection status, timeout, malformed ACK and fallback
  child relaunch without inherited transport handles.
- Linux/macOS verify `CLOEXEC`, `EINTR`, SIGPIPE handling, EOF cleanup, and no fd
  leak. Windows verifies explicit handle-list inheritance, unused-end closure,
  unrelated-handle noninheritance, parent/WebView shutdown, and no handle leak.
- A packaged nonzero uncached orbital must be requested while the WebView is
  open, rendered nonblank, and compared numerically with the Cube fallback.
  Index 0 control-flow coverage does not satisfy this gate.

## Platform and release matrix

| Gate | Linux | Windows | macOS |
| --- | --- | --- | --- |
| Rust codec/store tests | CI | CI | CI |
| TypeScript codec/frontend tests | CI | CI | CI |
| Fake-producer pipe lifecycle | CI | CI | CI |
| Extracted package smoke | CI | CI | CI |
| Real uncached orbital while open | packaged test | packaged test | packaged/manual if runner lacks UI |
| Desktop and 800px Playwright | CI/Linux | manual prerelease | manual prerelease |

## Current automated evidence

- The isolated C-to-Rust crate covers request-file creation, READY/ACK,
  authenticated binary retrieval, duplicate rejection, Cube fallback, a
  maximum-size stalled writer deadline, and missing-host launch failure.
- Rust transport fragmentation, concatenation, duplicate, partial EOF and idle
  shutdown tests now compile on both Unix and Windows; the package matrix runs
  the isolated transport crate on Linux, Windows and macOS.
- The generic C-to-Rust transport and package matrix pass on Linux, Windows and
  macOS. Extracted Windows and Linux packages both compute the real uncached
  `(CO)5Cr` orbital 43, return `mwfn-volume-v1`, stage no dynamic Cube, process
  Return and close their observed host/output-handle lifetimes.
- The extracted Linux package also passes forced negotiation failure, stale
  stop-flag cleanup, file-only relaunch and generated-Cube serving.
- Preview 7 completed final package-content/checksum audit and independent
  release review. Interactive macOS real-orbital and final desktop
  browser-rendering checks remain manual preview-acceptance gates.

## Manual macOS WKWebView gate

Hosted macOS runners build, link, relocate and test the package but have no
interactive WindowServer. Before prerelease approval, run this gate on a real
macOS desktop:

1. Extract the CI-built archive under a path containing spaces and confirm the
   archive contains no `.py`, `.pyc`, `__pycache__` or Python requirement.
2. Decompress `tests/fixtures/matterviz-real-orbital-Co5Cr.fch.gz`, launch the
   packaged `Multiwfn_MatterVizGUI` with it, enter menu 0 and leave the terminal
   open while the WKWebView is visible.
3. Select orbital 43 at 25k points and isovalue 0.05. Require a nonblank signed
   orbital surface and responsive structure/camera controls; the session must
   contain no `orbital_43_25000.cube` on the successful native path.
4. Use Return in the WebView. Require the window and host helpers to exit, the
   terminal to return cleanly to Multiwfn control, and no stale host to retain
   the session port or terminal output handles.

Before release run frontend `npm test`, `npm run check`, `npm run build`; Rust
`cargo test`, `cargo check --locked`, and `cargo clippy --locked -- -D warnings`;
source guards; all three package jobs; then an independent high-level read-only
review.
