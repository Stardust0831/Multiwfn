# MatterViz control protocol

Status: protocol v1 implementation in progress. This protocol replaces the
formal runtime's session directory, `gui_request.txt`, `response_<id>.json`,
`gui_stop.flag`, `manifest.json`, `structure.json` and `selected_file.txt`.
The explicit diagnostic Cube mode remains a separate file-backed launch path.

## Ownership and topology

- Fortran owns scientific-state extraction, request execution, structure and
  manifest serialization, and volume metadata. No calculation routine changes.
- The C adapter owns direct process launch, inherited pipe handles, deadlines,
  partial I/O, broken-pipe handling and endpoint closure on all three platforms.
- Rust owns request IDs, one serialized request writer, one response reader and
  demultiplexer, in-memory session state, HTTP projection and lifecycle.
- The frontend continues to use `/session/manifest.json`,
  `/session/structure.json`, `/api/orbital`, `/api/bond`, `/api/esp`,
  `/api/volume/<id>` and `/api/return`.

The formal native launch inherits four logical channels:

1. Rust writes control requests; Fortran reads them.
2. Fortran writes control responses/session bootstrap; Rust reads them.
3. Fortran writes binary volume frames; Rust reads them.
4. Rust writes volume readiness/ACK frames; Fortran reads them.

Control JSON and scalar-field bodies never share one pipe. This keeps the
existing major-2 volume backpressure and low-copy path independent from
request/response framing.

## Frame encoding

All integers are little-endian. Frames are concatenated without padding. The
header is exactly 48 bytes and uses CRC32C (Castagnoli).

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 8 | magic, ASCII `MWFNCTL\0` |
| 8 | 2 | major, `1` |
| 10 | 2 | minor, `0` |
| 12 | 2 | message type |
| 14 | 2 | flags |
| 16 | 4 | header bytes, `48` |
| 20 | 8 | request ID |
| 28 | 8 | body bytes |
| 36 | 4 | header CRC32C with bytes 36..39 zero |
| 40 | 4 | body CRC32C |
| 44 | 4 | reserved, zero |

Message types are `1=hello`, `2=session_init`, `3=request`, `4=response`,
`5=error`, and `6=shutdown`. Flag `0x0001` declares header CRC and `0x0002`
declares body CRC. Nonempty JSON frames require both flags; the header-only
hello requires only `0x0001`. Unknown flags, versions, types and reserved data
are rejected.

The maximum JSON body is 64 MiB. Length arithmetic is checked before
allocation. Decoders reject truncation, trailing bytes, bad CRC, invalid UTF-8,
non-object JSON and a body whose envelope disagrees with the header.

## JSON envelope

Every nonempty body is an object containing:

```json
{
  "format": "multiwfn-matterviz-control",
  "version": 1,
  "kind": "request"
}
```

The `kind` is `session_init`, `request`, `response`, `error`, or `shutdown`
and must match the message type. Requests, responses and errors require the
same nonzero request ID. Hello, session initialization and shutdown use ID 0.

`session_init` carries the complete manifest and optional structure/state JSON
objects in memory. Rust validates the objects before binding the HTTP service;
the browser is not opened until bootstrap succeeds. Manifest paths keep their
existing URL forms but may reference only in-memory session objects or
authenticated API routes in formal mode.

Requests carry a bounded canonical `command` generated only after Rust validates
the typed HTTP parameters (`orbital`, `bond`, `esp`, or an adapter-owned
initial-volume action). Fortran accepts only this closed command vocabulary;
arbitrary browser text is never forwarded. Rust emits request fields in the
order `format`, `version`, `kind`, `request_id`, `command`; the narrow Fortran
adapter accepts that canonical encoding only and compares its body request ID
with the validated header ID before dispatch. Responses preserve the JSON shapes
already returned by the HTTP API under a correlated `result` object. A control EOF, CRC/protocol failure, timeout,
or failed bootstrap invalidates the session, fails pending requests, clears
volume state and terminates the host without creating fallback artifacts.
The Fortran-side 250 ms idle poll occurs before any byte is consumed. After the
first byte becomes readable, one 30-second completion deadline covers the whole
frame; a partial-frame timeout is terminal and cannot be retried from the middle
of the stream. Rust likewise uses one endpoint deadline across header and body.

## Lifecycle

1. C creates the four pipe pairs, launches Rust with only the child ends and
   closes unused ends immediately.
2. Rust adopts all endpoints and sends a validated control hello plus the
   existing volume-ready frame.
3. Fortran sends `session_init`; Rust validates and stores manifest/structure
   in memory, then starts HTTP and the WebView.
4. HTTP analysis calls become correlated control requests. Fortran performs the
   same adapter calls as today and responds over the control pipe. Large scalar
   fields continue over the volume channel.
5. `/api/return`, window close, startup failure, or host shutdown sends one
   shutdown message. EOF is also terminal. Neither side polls the filesystem.

The native file picker uses a dedicated inherited result pipe and a bounded
versioned result message. Selected paths and cancellation never use a writable
output file.

`MWFNPICK` v1 uses a 32-byte little-endian header:

| Offset | Size | Field |
| --- | ---: | --- |
| 0 | 8 | ASCII `MWFNPICK` |
| 8 | 2 | major version (`1`) |
| 10 | 2 | minor version (`0`) |
| 12 | 2 | status: cancel `0`, selected `1`, error `2` |
| 14 | 2 | header/body CRC flags |
| 16 | 4 | header bytes (`32`) |
| 20 | 4 | UTF-8 body bytes |
| 24 | 4 | body CRC32C, or zero for an empty body |
| 28 | 4 | header CRC32C with this field zeroed |

The body is limited to 32 KiB and must not contain NUL. Cancel requires an
empty body; selected and error require nonempty UTF-8. The C adapter rejects
trailing data and results that exceed the caller's actual Fortran path buffer,
so a long path cannot be silently truncated into a different path. The launcher
waits without a deadline while the user interacts with the native dialog; its
15-second bound begins only when the result pipe becomes readable and covers
frame transfer and validation.

## Diagnostic mode

`MULTIWFN_MATTERVIZ_ALLOW_CUBE_FALLBACK=1` explicitly selects the isolated
file-backed diagnostic path. Formal pipe failure never switches modes
silently. Diagnostic files are not advertised as production behavior and are
covered by separate tests.

## Acceptance

- Windows, Linux and macOS pass codec, fragmented-I/O, timeout, broken-pipe,
  shutdown and concurrent-session tests.
- Linux and Windows extracted packages compute a real uncached orbital through
  the control and major-2 volume pipes with no runtime files.
- macOS hosted CI exercises the noninteractive packaged IPC path; interactive
  WKWebView and native picker checks remain manual on a real desktop.
- Controlled writable roots gain no session directory, manifest, structure,
  request/response/stop/selection file, Cube/CUB or staged volume file after a
  formal success or failure.
- Two concurrent sessions remain isolated by authority, capability, request ID
  and in-memory structure/volume state.
