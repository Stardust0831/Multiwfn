// Deterministic display-only field, encoded through both supported input routes.
export function quality_fixture(dimensions = [58, 102, 90]) {
  const [nx, ny, nz] = dimensions
  const data = new Float64Array(nx * ny * nz)
  let min = Infinity, max = -Infinity, sum = 0
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    const px = 6 * x / (nx - 1) - 3, py = 6 * y / (ny - 1) - 3, pz = 6 * z / (nz - 1) - 3
    const value = px * Math.exp(-(px ** 2 + py ** 2 + pz ** 2))
    data[z + nz * (y + ny * x)] = value
    min = Math.min(min, value); max = Math.max(max, value); sum += value
  }
  const origin = [1, -2, 0.5]
  const lattice = [[6, 0, 0], [1, 6, 0], [0, 1, 6]]
  const axes = lattice.map((row, axis) => row.map(value => value / (dimensions[axis] - 1)))
  const volume = { grid: { data, dimensions, order: 'z-fastest' }, grid_dims: dimensions,
    lattice, origin, origin_mode: 'absolute', periodic: false,
    data_range: { min, max, abs_max: Math.max(-min, max), mean: sum / data.length } }
  const cube = ['Synthetic signed field', 'Display regression fixture; Angstrom coordinates', `1 ${origin.join(' ')}`,
    ...axes.map((row, axis) => `${-dimensions[axis]} ${row.join(' ')}`), '1 1 4.5 1.5 3.5',
    Array.from(data, String).join(' '), ''].join('\n')
  const bytes = new Uint8Array(304 + data.byteLength), view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('MWFNVOL\0'))
  view.setUint16(8, 2, true); view.setUint16(12, 4, true); view.setUint16(14, 3, true)
  view.setUint32(16, 304, true); view.setBigUint64(20, 1n, true)
  view.setBigUint64(28, BigInt(data.byteLength), true); view.setBigUint64(48, 1n, true)
  dimensions.forEach((value, axis) => view.setUint32(56 + axis * 4, value, true))
  bytes.set([1, 1, 2, 0], 68)
  view.setUint16(72, 2, true); view.setUint16(74, 4, true); view.setUint16(76, 4, true)
  origin.forEach((value, axis) => view.setFloat64(80 + axis * 8, value, true))
  axes.flat().forEach((value, index) => view.setFloat64(104 + index * 8, value, true))
  lattice.flat().forEach((value, index) => view.setFloat64(176 + index * 8, value, true))
  view.setBigUint64(248, BigInt(data.length), true); view.setBigUint64(256, BigInt(data.byteLength), true)
  ;[min, max, sum / data.length, Math.max(-min, max)].forEach((value, index) => view.setFloat64(264 + index * 8, value, true))
  data.forEach((value, index) => view.setFloat64(304 + index * 8, value, true))
  const table = Uint32Array.from({ length: 256 }, (_, index) => {
    let crc = index
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0)
    return crc >>> 0
  })
  const crc = array => { let value = 0xffffffff; for (const byte of array) value = (value >>> 8) ^ table[(value ^ byte) & 255]; return (value ^ 0xffffffff) >>> 0 }
  view.setUint32(40, crc(bytes.subarray(304)), true); view.setUint32(36, crc(bytes.subarray(0, 304)), true)
  return { volume, cube, binary: bytes }
}
