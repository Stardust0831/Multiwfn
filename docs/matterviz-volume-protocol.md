# MatterViz binary volume protocol

Status: version 1 codecs, bounded Rust store, authenticated HTTP route, and
frontend format dispatch are implemented. Production dynamic traffic still uses
request/response files and Cube artifacts until the bounded pipe transport
passes the tests in `matterviz-volume-test-plan.md`.

## Boundary

Multiwfn keeps ownership of `cubmat` and `cubmattmp` as Fortran
`real*8(:,:,:)` arrays. Only `noGUI/GUI_matterviz.f90` may publish calculated
GUI/session volumes. Calculation routines, `savecubmat`, and array ownership do
not change. Rust validates and caches bounded frames, then serves them to the
frontend. Cube remains an explicit compatibility and diagnostic fallback.

## Encoding rules

- All integer and floating-point fields are little-endian.
- Frames are concatenated without padding. `header_bytes + body_bytes` is the
  exact frame length.
- Version 1 volume frames contain a 304-byte header and an f64 sample body.
- All reserved fields must be zero. All geometry, statistics, and samples must
  be finite.
- Checked arithmetic is required before allocation. Version 1 limits are
  1,500,000 samples, 12,000,000 body bytes, and 12,000,304 frame bytes.

## Common prelude

Every frame starts with this exact 48-byte prelude:

| Offset | Size | Field | Value / meaning |
| ---: | ---: | --- | --- |
| 0 | 8 | `magic` | ASCII `MWFNVOL\0` |
| 8 | 2 | `major` | `1` |
| 10 | 2 | `minor` | `0`; the v1.0 codec rejects other values |
| 12 | 2 | `message_type` | enum below |
| 14 | 2 | `flags` | feature bits below |
| 16 | 4 | `header_bytes` | full header length |
| 20 | 8 | `request_id` | nonzero request correlation ID |
| 28 | 8 | `body_bytes` | exact body length |
| 36 | 4 | `header_crc32c` | CRC32C of the full header with bytes 36..39 zero |
| 40 | 4 | `body_crc32c` | CRC32C of the exact body |
| 44 | 4 | `reserved` | zero |

Message types are `1=hello`, `2=request`, `3=response`, `4=volume`, `5=error`,
`6=cancel`, `7=shutdown`, and `8=ack`. The first codec milestone accepts only
`volume` frames.

Flags `0x0001=header_crc32c` and `0x0002=body_crc32c` are required for a v1.0
volume. All other flag bits are rejected. The v1.0 producer writes exactly
`0x0003`; a future minor version must define extension compatibility before a
decoder accepts a different header length or additional flags.

The inherited-pipe transport additionally uses two header-only control frames:

- Ready hello: 48-byte header, `message_type=1`, `flags=0x0001`,
  `request_id=0`, `body_bytes=0`, header CRC32C present and body CRC zero.
- Volume ACK: 64-byte header, `message_type=8`, `flags=0x0001`, the matching
  nonzero `request_id`, `body_bytes=0`; bytes 48..55 contain `volume_id:u64`,
  bytes 56..59 contain `status:u32` (`0` means validated and inserted), and
  bytes 60..63 are zero. The header CRC covers all 64 bytes with its CRC field
  zeroed.

Fortran does not publish binary entry JSON until the matching zero-status ACK
arrives. Complete-frame write and ACK read share one absolute publish deadline;
a timeout, malformed/mismatched ACK, nonzero status, broken pipe, or write
failure disables native transport for that session and executes the existing
Cube fallback.

## Volume header

For `message_type=4`, bytes 48..303 have this layout:

| Offset | Size | Field |
| ---: | ---: | --- |
| 48 | 8 | `volume_id:u64`, nonzero and unique within the session |
| 56 | 4 each | `nx`, `ny`, `nz:u32`, each nonzero |
| 68 | 1 | `scalar_type`, `1=f64` |
| 69 | 1 | `scalar_endian`, `1=little` |
| 70 | 1 | `data_order`, `1=i_fastest_fortran`, `2=k_fastest_cube` |
| 71 | 1 | `periodic_axes`, bits 0/1/2 are i/j/k; other bits reject |
| 72 | 2 | `coordinate_unit`, `1=bohr`, `2=angstrom` |
| 74 | 2 | `quantity_kind`, enum below |
| 76 | 2 | `value_unit`, enum below |
| 78 | 2 | reserved, zero |
| 80 | 24 | `origin:f64[3]` |
| 104 | 72 | `voxel_axes:f64[3][3]`; `p=origin+i*a+j*b+k*c` |
| 176 | 72 | independent `lattice:f64[3][3]` |
| 248 | 8 | `sample_count:u64`, exactly `nx*ny*nz` |
| 256 | 8 | `sample_bytes:u64`, exactly `sample_count*8` |
| 264 | 8 each | `min`, `max`, `mean`, `abs_max:f64` |
| 296 | 8 | reserved, zero |

Quantity kinds are `1=orbital`, `2=electron_density`,
`3=electrostatic_potential`, and `4=generic_scalar`. Value units are
`1=bohr^-3/2`, `2=electron/bohr^3`, `3=hartree/e`, and `4=dimensionless`
respectively. Pair 4/4 carries an existing GUI scalar field whose physical
quantity is not one of the three specialized kinds; it is required to migrate
initial non-orbital visualization grids without relabeling them as density. The
quantity/value-unit pair must match. Coordinates and lattice are converted to
angstrom only in the frontend adapter.

The body is only the sample array. The initial producer writes raw Fortran
contiguous `cubmat` order (`i` fastest, then `j`, then `k`) and declares
`data_order=1`. `data_order=2` exists for numerical equivalence fixtures and a
deliberate Cube-order producer, not for relabeling raw Fortran memory.

Decoders recompute sample statistics. Stored statistics must agree within
`max(1e-12, 1e-12 * max(1, abs(stored)))`; this detects mismatched metadata
without rejecting ordinary floating-point accumulation differences.

## HTTP and fallback contract

Existing `/api/orbital` and `/api/esp` response object shapes remain unchanged.
Each returned `ManifestEntry` uses one of these forms:

```json
{ "path": "orbital_42.cube", "format": "cube", "role": "orbital" }
```

```json
{ "path": "/api/volume/184467", "format": "mwfn-volume-v1", "role": "orbital" }
```

`path` remains required for compatibility. The frontend resolves it exactly as
today and appends the session capability only for same-origin `/api/volume/`
URLs. Rust serves successful binary responses as
`application/vnd.multiwfn.volume` with `Cache-Control: no-store`.

The per-session store is bounded to 8 entries and 64 MiB of complete frame
bytes. Insert validates the frame before it becomes visible, rejects a duplicate
`volume_id`, and evicts least-recently-read entries until both bounds hold. A
successful GET updates recency and holds an immutable frame reference for the
duration of that response, so eviction cannot truncate an in-flight read.
Unknown or evicted IDs return 404. Return, host shutdown, or producer EOF clears
the store; volumes are never visible across service instances.

The frontend maps `voxel_axes * dimensions` to MatterViz's volume `lattice`,
because that field is the grid coordinate transform. The independent protocol
lattice remains decoded metadata, while the structure manifest remains the
unit-cell authority. MatterViz currently exposes one volume-wide periodic
boolean, so frontend adaptation rejects partially periodic grids rather than
silently treating them as periodic along all three axes.

If native transport is absent, fails negotiation, rejects a frame, exceeds a
bound, or loses the pipe, the formal session fails explicitly and closes. It
does not write or advertise a Cube artifact. File-backed Cube behavior is
available only when `MULTIWFN_MATTERVIZ_ALLOW_CUBE_FALLBACK=1` explicitly
selects the isolated development/diagnostic path before launch. A malformed
binary response is always reported as a binary-volume error.

## Transport staging

1. Rust and TypeScript codecs plus shared golden frames are complete.
2. The bounded Rust per-session volume store and authenticated binary route are
   complete for compatibility volumes.
3. Independent inherited volume and versioned bidirectional control pipes are
   complete; the formal path has no file request/response fallback.
4. Dynamic orbitals use direct major-2 streaming. Initial scalar fields and the
   correlated ESP density/potential pair use validated native volume IDs.
5. Dynamic Cube staging is removed from the formal path. Three-platform package
   CI and interactive prerelease validation remain release gates.

Rust owns pipe readers, cache lifetime, HTTP serving, and shutdown. The narrow
GUI/session C ABI owns inherited pipe ends and complete-frame writes. POSIX must
handle `CLOEXEC`, `EINTR`, partial I/O, and `SIGPIPE`; Windows must use explicit
handle-list inheritance, binary-safe writes, and immediate closure of unused
ends. Shared memory remains deferred until pipe benchmarks show it is needed.

The structured GUI/session C ABI is:

```c
int multiwfn_matterviz_spawn(
    const char *executable_utf8,
    const char *frontend_utf8,
    const char *session_utf8,
    const char *manifest_utf8,
    intptr_t *volume_write_out,
    intptr_t *ack_read_out,
    intptr_t *request_read_out,
    intptr_t *response_write_out,
    int *transport_error_out);

int multiwfn_matterviz_publish_volume(
    intptr_t volume_write, intptr_t ack_read,
    int64_t request_id, int64_t volume_id,
    int32_t nx, int32_t ny, int32_t nz,
    int32_t data_order, int32_t periodic_axes,
    int32_t coordinate_unit, int32_t quantity_kind, int32_t value_unit,
    const double origin[3], const double voxel_axes[9],
    const double lattice[9], const double *samples,
    int64_t sample_count, uint32_t publish_timeout_ms);

void multiwfn_matterviz_transport_close(
    intptr_t *volume_write_io, intptr_t *ack_read_io);
```

The launcher invokes `matterviz-desktop` directly with its managed arguments
plus volume read/ACK and control read/write endpoints; it does not use a shell
or mutate process-global environment. POSIX launch uses a CLOEXEC status pipe
so a child-side `execv` error is reported before launch can be accepted. On
transport setup/ready failure it terminates and reaps the attempted child,
closes all endpoints and returns an explicit error. Explicit diagnostic mode
starts file-only and never masquerades as a successful formal negotiation.
