import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  adapt_matterviz_volume,
  apply_structure_volume_frame_translation,
  decode_matterviz_volume,
  translate_point_volume_frame,
  translate_structure_volume_frame,
} from '../src/volume.ts'
import type { Crystal, Molecule } from 'matterviz/structure'

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
  assert.deepEqual(adapted.grid, [
    [[1, 5, 9], [3, 7, 11]],
    [[2, 6, 10], [4, 8, 12]],
  ])
  assert.deepEqual(adapted.origin, [bohr, 2 * bohr, 3 * bohr])
  assert.equal(adapted.data_order, 'x_fastest')
  assert.equal(adapted.periodic, true)
  assert.deepEqual(adapted.lattice, [
    [0.1 * (2 * bohr), 0, 0],
    [0.01 * (2 * bohr), 0.2 * (2 * bohr), 0],
    [0, 0.02 * (3 * bohr), 0.3 * (3 * bohr)],
  ])
  assert.equal(adapted.data_range.mean, 6.5)
})

test('maps k-fastest Cube order into grid[x][y][z]', async () => {
  const frame = await golden_frame()
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  view.setUint8(70, 2)
  repair_header_crc(frame)
  const adapted = adapt_matterviz_volume({
    ...decode_matterviz_volume(frame),
    periodic_axes: [false, false, false],
  })
  assert.deepEqual(adapted.grid, [
    [[1, 2, 3], [4, 5, 6]],
    [[7, 8, 9], [10, 11, 12]],
  ])
  assert.equal(adapted.data_order, 'z_fastest')
})

test('aligns native structure JSON to the first volume origin without cumulative drift', () => {
  const molecule: Molecule = {
    sites: [{
      species: [{ element: 'C', occu: 1, oxidation_state: 0 }],
      abc: [0, 0, 0],
      xyz: [0, 0, -1.139253271649],
      label: 'C1',
      properties: { keep: true },
    }],
  }
  const frame_origin: [number, number, number] = [
    -4.070446475567824,
    -3.6920131041043858,
    -4.660528644485103,
  ]
  const aligned = translate_structure_volume_frame(molecule, [0, 0, 0], frame_origin)
  const expected = [
    4.070446475567824,
    3.6920131041043858,
    3.521275372836103,
  ]
  aligned.sites[0].xyz.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= 1e-12)
  })
  assert.deepEqual(aligned.sites[0].abc, aligned.sites[0].xyz)
  assert.deepEqual(molecule.sites[0].xyz, [0, 0, -1.139253271649])

  const unchanged = translate_structure_volume_frame(aligned, frame_origin, frame_origin)
  assert.strictEqual(unchanged, aligned)
  const restored = translate_structure_volume_frame(aligned, frame_origin, [0, 0, 0])
  restored.sites[0].xyz.forEach((value, index) => {
    assert.ok(Math.abs(value - molecule.sites[0].xyz[index]) <= 1e-12)
  })
})

test('recomputes periodic fractional coordinates when the volume frame changes', () => {
  const crystal: Crystal = {
    sites: [{
      species: [{ element: 'H', occu: 1, oxidation_state: 0 }],
      abc: [0.5, 0.5, 0.5],
      xyz: [1, 1.5, 2],
      label: 'H1',
      properties: {},
    }],
    lattice: {
      matrix: [[2, 0, 0], [0, 3, 0], [0, 0, 4]],
      pbc: [true, true, true],
      a: 2,
      b: 3,
      c: 4,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 24,
    },
  }
  const aligned = translate_structure_volume_frame(crystal, [0, 0, 0], [0.5, 0.75, 1])
  assert.deepEqual(aligned.sites[0].xyz, [0.5, 0.75, 1])
  assert.deepEqual(aligned.sites[0].abc, [0.25, 0.25, 0.25])
  assert.deepEqual(crystal.sites[0].abc, [0.5, 0.5, 0.5])
})

test('moves camera points by the same delta as the structure volume frame', () => {
  const previous: [number, number, number] = [0, 0, 0]
  const next: [number, number, number] = [-4, -3, -2]
  assert.deepEqual(translate_point_volume_frame([1, 2, 3], previous, next), [5, 5, 5])
  assert.deepEqual(translate_point_volume_frame([0, 0, 0], previous, next), [4, 3, 2])
  assert.deepEqual(translate_point_volume_frame([5, 5, 5], next, previous), [1, 2, 3])
  assert.throws(
    () => translate_point_volume_frame([Number.NaN, 0, 0], previous, next),
    /finite 3-vectors/,
  )
})

test('round-trips repeated periodic volume-frame transitions without drift', () => {
  const crystal: Crystal = {
    lattice: { matrix: [[2, 0, 0], [0, 4, 0], [0, 0, 8]], a: 2, b: 4, c: 8, alpha: 90, beta: 90, gamma: 90, volume: 64, pbc: [true, true, true] },
    sites: [{
      species: [{ element: 'O', occu: 1, oxidation_state: 0 }],
      abc: [0.5, 0.5, 0.5],
      xyz: [1, 2, 4],
      label: 'O1',
      properties: {},
    }],
  }
  const shifted = translate_structure_volume_frame(crystal, [0, 0, 0], [-1, -2, -4])
  const replaced = translate_structure_volume_frame(shifted, [-1, -2, -4], [2, 1, 0])
  const restored = translate_structure_volume_frame(replaced, [2, 1, 0], [0, 0, 0])
  assert.notStrictEqual(shifted, crystal)
  assert.notStrictEqual(shifted.sites[0], crystal.sites[0])
  assert.deepEqual(shifted.sites[0].xyz, [2, 4, 8])
  assert.deepEqual(shifted.sites[0].abc, [1, 1, 1])
  assert.deepEqual(restored.sites[0].xyz, crystal.sites[0].xyz)
  assert.deepEqual(restored.sites[0].abc, crystal.sites[0].abc)
})

test('applies a managed frame translation without changing interaction identity', () => {
  const molecule: Molecule = {
    sites: [{
      species: [{ element: 'O', occu: 1, oxidation_state: 0 }],
      abc: [0, 0, 0],
      xyz: [1, 2, 3],
      label: 'O1',
      properties: {},
    }],
  }
  const site = molecule.sites[0]
  const result = apply_structure_volume_frame_translation(molecule, [0, 0, 0], [-4, -3, -2])
  assert.strictEqual(result, molecule)
  assert.strictEqual(result.sites[0], site)
  assert.deepEqual(result.sites[0].xyz, [5, 5, 5])
  assert.deepEqual(result.sites[0].abc, [5, 5, 5])
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
})

test('rejects malformed frame structure and metadata', async () => {
  const original = await golden_frame()
  const cases: Array<[string, RegExp, (frame: Uint8Array) => void]> = [
    ['bad magic', /bad magic/, (frame) => { frame[0] = 0 }],
    ['bad major version', /unsupported major/, (frame) => { frame[8] = 2 }],
    ['bad minor version', /unsupported minor/, (frame) => { frame[10] = 1 }],
    ['extended header', /header length is not v1\.0/, (frame) => {
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
  assert.throws(() => decode_matterviz_volume(original.subarray(0, 303)), /Invalid MatterViz volume v1 frame/)

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
  decoded.voxel_axes[0][0] = Number.MAX_VALUE
  decoded.periodic_axes = [false, false, false]
  assert.throws(() => adapt_matterviz_volume(decoded), /grid lattice must be finite/)
})
