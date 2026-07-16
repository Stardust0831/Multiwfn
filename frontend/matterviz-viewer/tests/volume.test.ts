import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  adapt_matterviz_volume,
  decode_matterviz_volume,
  read_matterviz_volume_response,
} from '../src/volume.ts'

const fixture_hex = new URL('../../../tests/fixtures/matterviz-volume-v1-orbital.hex', import.meta.url)
const HEADER_BYTES = 304

function parse_hex(text: string): Uint8Array {
  const clean = text.replace(/#[^\n]*|\s+/g, '')
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) throw new Error('invalid hex fixture')
  const bytes = new Uint8Array(clean.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function repair_header_crc(frame: Uint8Array): void {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  view.setUint32(36, 0, true)
  view.setUint32(36, crc32c(frame.subarray(0, view.getUint32(16, true))), true)
}

function repair_body_crc(frame: Uint8Array): void {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  view.setUint32(40, crc32c(frame.subarray(view.getUint32(16, true))), true)
  repair_header_crc(frame)
}

async function golden_frame(): Promise<Uint8Array> {
  return parse_hex(await readFile(fixture_hex, 'utf8'))
}

test('decodes the shared orbital golden frame and adapts geometry', async () => {
  const decoded = decode_matterviz_volume(await golden_frame())
  assert.equal(decoded.protocol_major, 1)
  assert.equal(decoded.request_id, 42n)
  assert.equal(decoded.volume_id, 1001n)
  assert.deepEqual(decoded.dimensions, [2, 2, 3])
  assert.equal(decoded.data_order, 'i_fastest_fortran')
  assert.deepEqual(decoded.periodic_axes, [true, false, true])
  assert.deepEqual(decoded.origin, [1, 2, 3])
  assert.deepEqual(Array.from(decoded.samples), Array.from({ length: 12 }, (_, index) => index + 1))

  assert.throws(
    () => adapt_matterviz_volume(decoded),
    /does not support partially periodic volumetric grids/,
  )
  const adapted = adapt_matterviz_volume({
    ...decoded,
    periodic_axes: [true, true, true],
  })
  const bohr = 0.529177249
  assert.deepEqual(adapted.grid, {
    data: decoded.samples,
    dimensions: [2, 2, 3],
    order: 'x-fastest',
  })
  assert.deepEqual(adapted.origin, [bohr, 2 * bohr, 3 * bohr])
  assert.equal(adapted.origin_mode, 'absolute')
  assert.equal(adapted.data_order, 'x_fastest')
  assert.equal(adapted.periodic, true)
  assert.deepEqual(adapted.lattice, [
    [0.1 * (2 * bohr), 0, 0],
    [0.01 * (2 * bohr), 0.2 * (2 * bohr), 0],
    [0, 0.02 * (3 * bohr), 0.3 * (3 * bohr)],
  ])
  assert.equal(adapted.data_range.mean, 6.5)
})

test('preserves k-fastest Cube order in the flat scalar grid', async () => {
  const frame = await golden_frame()
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  view.setUint8(70, 2)
  repair_header_crc(frame)
  const adapted = adapt_matterviz_volume({
    ...decode_matterviz_volume(frame),
    periodic_axes: [false, false, false],
  })
  assert.deepEqual(adapted.grid, {
    data: decode_matterviz_volume(frame).samples,
    dimensions: [2, 2, 3],
    order: 'z-fastest',
  })
  assert.equal(adapted.data_order, 'z_fastest')
})

test('decodes signed samples and every quantity-unit pair', async () => {
  const signed = await golden_frame()
  const view = new DataView(signed.buffer, signed.byteOffset, signed.byteLength)
  for (let index = 0; index < 12; index += 1) {
    view.setFloat64(HEADER_BYTES + index * 8, -(index + 1), true)
  }
  view.setFloat64(264, -12, true)
  view.setFloat64(272, -1, true)
  view.setFloat64(280, -6.5, true)
  view.setFloat64(288, 12, true)
  repair_body_crc(signed)
  repair_header_crc(signed)
  const decoded_signed = decode_matterviz_volume(signed)
  assert.equal(decoded_signed.samples[0], -1)
  assert.equal(decoded_signed.samples[11], -12)
  assert.equal(decoded_signed.statistics.abs_max, 12)

  const pairs = [
    [1, 1, 'orbital', 'bohr^-3/2'],
    [2, 2, 'electron_density', 'electron/bohr^3'],
    [3, 3, 'electrostatic_potential', 'hartree/e'],
    [4, 4, 'generic_scalar', 'dimensionless'],
  ] as const
  for (const [quantity, unit, expected_quantity, expected_unit] of pairs) {
    const frame = await golden_frame()
    const pair_view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    pair_view.setUint16(74, quantity, true)
    pair_view.setUint16(76, unit, true)
    repair_header_crc(frame)
    const decoded = decode_matterviz_volume(frame)
    assert.equal(decoded.quantity_kind, expected_quantity)
    assert.equal(decoded.value_unit, expected_unit)
  }

  for (const [quantity, unit] of [[4, 1], [1, 4], [4, 3], [3, 4]] as const) {
    const frame = await golden_frame()
    const pair_view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    pair_view.setUint16(74, quantity, true)
    pair_view.setUint16(76, unit, true)
    repair_header_crc(frame)
    assert.throws(() => decode_matterviz_volume(frame), /quantity kind and value unit/)
  }

  for (const [quantity, unit] of [[0, 0], [5, 5], [4, 5], [5, 4]] as const) {
    const frame = await golden_frame()
    const pair_view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    pair_view.setUint16(74, quantity, true)
    pair_view.setUint16(76, unit, true)
    repair_header_crc(frame)
    assert.throws(() => decode_matterviz_volume(frame), /quantity kind and value unit/)
  }
})

test('rejects malformed frame structure and metadata', async () => {
  const original = await golden_frame()
  const cases: Array<[string, RegExp, (frame: Uint8Array) => void]> = [
    ['bad magic', /bad magic/, (frame) => { frame[0] = 0 }],
    ['bad major version', /unsupported major/, (frame) => { frame[8] = 3 }],
    ['bad minor version', /unsupported minor/, (frame) => { frame[10] = 1 }],
    ['extended header', /unsupported header length/, (frame) => {
      new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(16, 312, true)
    }],
    ['missing required flag', /requires exactly the CRC32C flags/, (frame) => { frame[14] = 1 }],
    ['unknown required flag', /requires exactly the CRC32C flags/, (frame) => { frame[14] |= 4 }],
    ['unknown optional flag', /requires exactly the CRC32C flags/, (frame) => { frame[15] = 1 }],
    ['prelude reserved', /prelude reserved/, (frame) => { frame[44] = 1; repair_header_crc(frame) }],
    ['header reserved', /volume header reserved/, (frame) => { frame[78] = 1; repair_header_crc(frame) }],
    ['bad coordinate enum', /unsupported coordinate unit/, (frame) => { frame[72] = 9; repair_header_crc(frame) }],
    ['bad quantity/value pair', /quantity kind and value unit/, (frame) => { frame[76] = 2; repair_header_crc(frame) }],
    ['nonfinite sample', /sample\[0\] must be finite/, (frame) => {
      new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setBigUint64(HEADER_BYTES, 0x7ff8000000000000n, true)
      repair_body_crc(frame)
    }],
    ['statistics mismatch', /stored statistics/, (frame) => {
      new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setFloat64(264, 2, true)
      repair_header_crc(frame)
    }],
    ['zero dimension', /dimensions must be nonzero/, (frame) => {
      new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(56, 0, true)
      repair_header_crc(frame)
    }],
    ['too many points', /sample count exceeds/, (frame) => {
      new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(56, 0xffffffff, true)
      repair_header_crc(frame)
    }],
  ]
  for (const [name, reason, mutate] of cases) {
    const frame = original.slice()
    mutate(frame)
    assert.throws(() => decode_matterviz_volume(frame), reason, name)
  }
  const trailing = new Uint8Array(original.length + 1)
  trailing.set(original)
  assert.throws(() => decode_matterviz_volume(trailing), /frame length/)
})

test('rejects truncated, bad-CRC, and inconsistent byte-count frames', async () => {
  const original = await golden_frame()
  assert.throws(() => decode_matterviz_volume(original.subarray(0, 303)), /Invalid MatterViz volume frame/)

  const bad_header_crc = original.slice()
  bad_header_crc[36] ^= 0xff
  assert.throws(() => decode_matterviz_volume(bad_header_crc), /CRC32C/)

  const bad_body_crc = original.slice()
  bad_body_crc[40] ^= 0xff
  assert.throws(() => decode_matterviz_volume(bad_body_crc), /CRC32C/)

  const bad_body_bytes = original.slice()
  new DataView(bad_body_bytes.buffer, bad_body_bytes.byteOffset, bad_body_bytes.byteLength).setBigUint64(28, 95n, true)
  assert.throws(() => decode_matterviz_volume(bad_body_bytes), /frame length/)

  const extra_body = new Uint8Array(original.length + 8)
  extra_body.set(original)
  const extra_view = new DataView(extra_body.buffer)
  extra_view.setBigUint64(28, 104n, true)
  repair_body_crc(extra_body)
  repair_header_crc(extra_body)
  assert.throws(() => decode_matterviz_volume(extra_body), /body_bytes does not match sample_bytes/)
})

test('rejects derived nonfinite grid geometry before nested-grid allocation', async () => {
  const decoded = decode_matterviz_volume(await golden_frame())
  decoded.voxel_axes[2][2] = Number.MAX_VALUE
  decoded.periodic_axes = [false, false, false]
  assert.throws(() => adapt_matterviz_volume(decoded), /grid lattice must be finite/)
})

test('rejects singleton finite axes instead of inventing a physical span', async () => {
  const decoded = decode_matterviz_volume(await golden_frame())
  decoded.dimensions = [1, 2, 3]
  decoded.periodic_axes = [false, false, false]
  assert.throws(() => adapt_matterviz_volume(decoded), /at least two points per axis/)
})

test('decodes a major-2 frame beyond the v1 point limit without copying samples', async () => {
  const sampleCount = 1_500_001
  const source = await golden_frame()
  const frame = new Uint8Array(HEADER_BYTES + sampleCount * 8)
  frame.set(source.subarray(0, HEADER_BYTES))
  const view = new DataView(frame.buffer)
  view.setUint16(8, 2, true)
  view.setBigUint64(28, BigInt(sampleCount * 8), true)
  view.setUint32(56, sampleCount, true)
  view.setUint32(60, 1, true)
  view.setUint32(64, 1, true)
  view.setBigUint64(248, BigInt(sampleCount), true)
  view.setBigUint64(256, BigInt(sampleCount * 8), true)
  view.setFloat64(264, 0, true)
  view.setFloat64(272, 0, true)
  view.setFloat64(280, 0, true)
  view.setFloat64(288, 0, true)
  repair_body_crc(frame)

  const decoded = decode_matterviz_volume(frame.buffer)
  assert.equal(decoded.protocol_major, 2)
  assert.equal(decoded.samples.length, sampleCount)
  assert.equal(decoded.samples.buffer, frame.buffer)
  assert.equal(decoded.samples.byteOffset, HEADER_BYTES)
})

test('decodes a major-2 SharedArrayBuffer without passing it to TextDecoder', async (t) => {
  if (typeof SharedArrayBuffer === 'undefined') {
    t.skip('SharedArrayBuffer is unavailable')
    return
  }
  const source = await golden_frame()
  new DataView(source.buffer, source.byteOffset, source.byteLength).setUint16(8, 2, true)
  repair_header_crc(source)
  const shared = new SharedArrayBuffer(source.byteLength)
  new Uint8Array(shared).set(source)

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'TextDecoder')
  class StrictTextDecoder extends TextDecoder {
    override decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions): string {
      if (ArrayBuffer.isView(input) && input.buffer instanceof SharedArrayBuffer) {
        throw new TypeError('The provided ArrayBufferView value must not be shared')
      }
      return super.decode(input, options)
    }
  }
  Object.defineProperty(globalThis, 'TextDecoder', {
    configurable: true,
    writable: true,
    value: StrictTextDecoder,
  })
  try {
    const decoded = decode_matterviz_volume(shared)
    assert.equal(decoded.protocol_major, 2)
    assert.equal(decoded.samples.buffer, shared)
    assert.equal(decoded.samples.byteOffset, HEADER_BYTES)

    const bad_magic = shared.slice(0)
    new Uint8Array(bad_magic)[0] = 0
    assert.throws(() => decode_matterviz_volume(bad_magic), /bad magic/)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'TextDecoder', descriptor)
    else Reflect.deleteProperty(globalThis, 'TextDecoder')
  }
})

test('fills one preallocated response buffer from fragmented stream chunks', async () => {
  const frame = await golden_frame()
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(frame.subarray(0, 37))
      controller.enqueue(frame.subarray(37, 311))
      controller.enqueue(frame.subarray(311))
      controller.close()
    },
  }), {
    headers: { 'content-length': String(frame.byteLength) },
  })
  const buffer = await read_matterviz_volume_response(response)
  assert.deepEqual(new Uint8Array(buffer), frame)

  const truncated = new Response(frame.subarray(0, frame.length - 1), {
    headers: { 'content-length': String(frame.length) },
  })
  await assert.rejects(read_matterviz_volume_response(truncated), /truncated/)
})
