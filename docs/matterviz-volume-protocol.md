# MatterViz binary volume transport draft

Status: design draft for the post-Rust-host milestone. Production traffic still
uses the existing request files and Cube artifacts.

## Boundary

Multiwfn keeps ownership of `cubmat` and `cubmattmp` as native Fortran
`real*8(:,:,:)` arrays. A small GUI/session C ABI moves bytes between Fortran
and the Rust host; no calculation routine or array ownership changes. The Rust
host validates and caches bounded frames, then exposes them to the existing
frontend over loopback HTTP. Cube remains an explicit debug and compatibility
fallback during migration.

## Frame prelude

All integers and floating-point samples are little-endian. Every message starts
with this fixed 32-byte prelude:

| Field | Type | Meaning |
| --- | --- | --- |
| `magic` | `u8[8]` | `MWFNVOL\0` |
| `major` | `u16` | incompatible protocol version |
| `minor` | `u16` | append-only compatible version |
| `message_type` | `u16` | hello, request, response, volume, error, cancel, shutdown or ack |
| `flags` | `u16` | required/optional feature bits |
| `header_bytes` | `u32` | complete header length, including future appended fields |
| `request_id` | `u64` | correlation with one GUI calculation request |
| `body_bytes` | `u64` | bounded payload length |

Unknown major versions and required flags are rejected. A newer minor version
is accepted only when the known fixed fields and `header_bytes` allow unknown
appended header bytes to be skipped safely.

## Volume header

Version 1 volume metadata contains:

- `volume_id:u64` and `nx,ny,nz:u32`;
- optional `atom_count:u32`;
- `scalar_type:u8` (`f64` first, optional `f32` only after numerical review);
- `scalar_endian:u8` and `data_order:u8`;
- periodic-axis flags, coordinate unit, quantity kind and value unit;
- `origin:f64[3]`;
- `voxel_axes:f64[3][3]`, defining `p = origin + i*a + j*b + k*c`;
- an independent `lattice:f64[3][3]`;
- sample and optional atom byte counts;
- optional finite `min`, `max`, `mean` and `abs_max` values;
- header and body CRC32C values.

The initial producer declares Fortran-native `x_fastest` ordering, avoiding the
transpose currently performed while writing Cube text. Signed values are normal
IEEE values and are never clamped by quantity type. Dimensions, checked point
count, sample width, byte count, finite geometry, CRC and request ID are
validated before allocation. The existing 1.5-million-point dynamic limit is
retained, with an additional negotiated frame-byte ceiling.

## Transport

The first native transport uses two inherited anonymous pipes:

- Rust to Fortran: request, cancel and shutdown frames;
- Fortran to Rust: response, error and volume frames.

The existing `matterviz_spawn.c` handle-list boundary is extended to create the
pipes, make only the intended child ends inheritable, and close unused ends
immediately. POSIX uses `pipe2(O_CLOEXEC)` or `pipe` plus `FD_CLOEXEC`; Windows
uses `CreatePipe` and `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`. The C ABI handles
partial I/O, interruption, broken pipes and SIGPIPE behavior. Standard Fortran
uses `ISO_C_BINDING`; Rust uses a dedicated reader thread so pipe backpressure
cannot deadlock an HTTP handler.

Named shared memory is deferred until measurements show that pipe throughput is
the limiting cost. It has substantially different naming, ACL, handle-transfer
and cleanup behavior across Windows, Linux and macOS. A future inherited shared
memory ring can reuse the same frame format without changing the frontend
contract.

## Frontend contract

Rust keeps a bounded per-session LRU keyed by opaque `volume_id` and serves
`application/vnd.multiwfn.volume` from a capability-scoped loopback URL.
Orbital and ESP JSON responses keep their current shape but identify
`format: "mwfn-volume-v1"` and a binary URL instead of a Cube path.

The frontend validates the frame again from `arrayBuffer()`, creates an
endian-correct typed view, and adapts it to MatterViz's current nested grid API.
Direct Tauri command transport is avoided because large IPC values can add
serialization/base64 copies. True end-to-end zero-copy requires a later
MatterViz flat typed-grid API.

## Delivery and acceptance

1. Add Rust and TypeScript codecs with cross-language golden frames while Cube
   remains the production path.
2. Add inherited control pipes with file request/response fallback.
3. Move dynamic orbitals, then paired ESP volumes, to pipe frames and binary
   HTTP responses.
4. Move startup volumes only after dynamic traffic is proven.
5. Benchmark 25k through 1.5M points and representative larger grids before
   deciding whether to add inherited shared memory.

Tests cover corrupt/truncated/oversized frames, multiplication overflow,
unknown flags, signed extrema, oblique axes and lattice, both scalar widths and
data orders, process exit during transfer, slow-reader backpressure, cache
eviction, handle leaks, cancellation and Cube/binary numerical equivalence.
