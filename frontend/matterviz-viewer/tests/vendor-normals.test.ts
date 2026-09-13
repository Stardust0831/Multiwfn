import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { createServer } from 'vite'

// The optional directory also lets package maintenance validate the staging
// files before packing. CI always exercises the installed production package.
const installedDist = new URL('../node_modules/matterviz/dist/', import.meta.url)
const dist = process.env.MATTERVIZ_VENDOR_DIST
  ? pathToFileURL(`${resolve(process.env.MATTERVIZ_VENDOR_DIST)}/`)
  : installedDist
const require = createRequire(realpathSync(new URL('marching-cubes.js', installedDist)))
const three = require('three')
type Vec3 = [number, number, number]
type Lattice = [Vec3, Vec3, Vec3]

const latticeMatrix = (lattice: Lattice) => new three.Matrix4().set(
  lattice[0][0], lattice[1][0], lattice[2][0], 0,
  lattice[0][1], lattice[1][1], lattice[2][1], 0,
  lattice[0][2], lattice[1][2], lattice[2][2], 0,
  0, 0, 0, 1,
)

const makeGrid = (dimensions: Vec3, sample: (point: Vec3) => number) => {
  const [nx, ny, nz] = dimensions
  const data = new Float64Array(nx * ny * nz)
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    data[z + nz * (y + ny * x)] = sample([x / (nx - 1) - 0.5, y / (ny - 1) - 0.5, z / (nz - 1) - 0.5])
  }
  return { data, dimensions, order: 'z-fastest' }
}

test('production isosurface geometry derives Cartesian normals from its final triangle winding', async (t) => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    resolve: { alias: { three: resolve(dirname(require.resolve('three')), 'three.module.js') } },
  })
  const load = (path: string) => vite.ssrLoadModule(`/@fs/${fileURLToPath(new URL(path, dist))}`)
  try {
    const { marching_cubes_typed } = await load('marching-cubes.js')
    const { build_typed_geometry } = await load('isosurface/mesh-geometry.js')
    const source = await readFile(new URL('isosurface/Isosurface.svelte', dist), 'utf8')
    assert.match(source, /import \{ build_typed_geometry \} from ['"]\.\/mesh-geometry['"]/)
    assert.match(source, /const geometry = build_typed_geometry\(result\)/)
    assert.doesNotMatch(source, /function build_typed_geometry\(/, 'the component must use the tested production helper')
    const options = { periodic: false, centered: true, interpolate: true, normals: true }
    const planeGradient = new three.Vector3(1.1, 0.6, -0.4)
    const plane = makeGrid([11, 14, 17], ([x, y, z]) => 0.5 + 1.1 * x + 0.6 * y - 0.4 * z)
    const lattices: Record<string, Lattice> = {
      orthogonal: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      rotated: [[0, 4, 0], [-4, 0, 0], [0, 0, 4]],
      anisotropic: [[2, 0, 0], [0, 8, 0], [0, 0, 3]],
      skewed: [[4, 0.5, -0.2], [1.5, 3, 0.4], [-0.7, 0.8, 5]],
      reflected: [[-4, 0, 0], [0, 4, 0], [0, 0, 4]],
    }
    for (const [name, lattice] of Object.entries(lattices)) {
      await t.test(`${name} lattice matches an analytic plane and preserves face orientation`, () => {
        const result = marching_cubes_typed(plane, 0.43, lattice, options)
        const positions = result.positions.slice()
        const indices = result.indices.slice()
        const geometry = build_typed_geometry(result)
        assert.ok(geometry)
        try {
          const normal = geometry.getAttribute('normal')
          assert.ok(normal.count > 100, 'exercise the real marching-cubes mesh')
          assert.equal(normal.array, result.normals, 'reuse the worker normal allocation within its memory budget')
          assert.equal(geometry.getAttribute('position').array, result.positions)
          assert.deepEqual(result.positions, positions, 'lighting must not move the scientific surface')
          assert.deepEqual(geometry.index.array, indices, 'lighting must not change culling or transparent pass order')
          const transform = latticeMatrix(lattice)
          // A reflected lattice reverses the existing triangle winding. Match
          // that orientation, as the legacy geometry-normal path already does.
          const expected = planeGradient.clone().negate()
            .applyMatrix3(new three.Matrix3().getNormalMatrix(transform))
            .multiplyScalar(Math.sign(transform.determinant())).normalize()
          for (let vertex = 0; vertex < normal.count; vertex++) {
            const actual = new three.Vector3().fromBufferAttribute(normal, vertex)
            assert.ok(Math.abs(actual.length() - 1) < 1e-6, `${name}: normal must be finite and unit length`)
            assert.ok(actual.dot(expected) > 1 - 1e-6, `${name}: vertex ${vertex} must point along the physical plane normal`)
          }
        } finally {
          geometry.dispose()
        }
      })
    }

    await t.test('smooth closed density surface remains smooth and rotates with its geometry', () => {
      const grid = makeGrid([25, 25, 25], ([x, y, z]) => Math.exp(-18 * (x * x + y * y + z * z)))
      const baselineResult = marching_cubes_typed(grid, 0.3, lattices.orthogonal, options)
      const endpointNormals = baselineResult.normals.slice()
      const baseline = build_typed_geometry(baselineResult)
      assert.ok(baseline)
      try {
        const baseNormal = baseline.getAttribute('normal')
        const basePosition = baseline.getAttribute('position')
        const errors = []
        const endpointErrors = []
        for (let vertex = 0; vertex < baseNormal.count; vertex++) {
          const actual = new three.Vector3().fromBufferAttribute(baseNormal, vertex)
          const radial = new three.Vector3().fromBufferAttribute(basePosition, vertex).normalize()
          errors.push(Math.acos(Math.min(1, actual.dot(radial))) * 180 / Math.PI)
          const endpointNormal = new three.Vector3().fromArray(endpointNormals, vertex * 3)
          endpointErrors.push(Math.acos(Math.min(1, endpointNormal.dot(radial))) * 180 / Math.PI)
        }
        errors.sort((left, right) => left - right)
        endpointErrors.sort((left, right) => left - right)
        assert.ok(errors.at(-1)! < 6, 'the coarse 25³ sphere must retain smooth, outward-facing normals')
        for (const percentile of [0.5, 0.95]) {
          const index = Math.floor(errors.length * percentile)
          assert.ok(errors[index] < endpointErrors[index] * 0.85, 'smooth vertex normals must improve on grid-endpoint normals, not add faceting')
        }

        for (const [name, lattice] of Object.entries(lattices)) {
          if (name === 'orthogonal') continue
          const result = marching_cubes_typed(grid, 0.3, lattice, options)
          const geometry = build_typed_geometry(result)
          assert.ok(geometry)
          try {
            const normal = geometry.getAttribute('normal')
            assert.equal(normal.count, baseNormal.count)
            assert.deepEqual(geometry.index.array, baseline.index.array)
            const transform = latticeMatrix(lattice)
            const normalMatrix = new three.Matrix3().getNormalMatrix(transform)
            for (let vertex = 0; vertex < normal.count; vertex++) {
              const expected = new three.Vector3().fromBufferAttribute(baseNormal, vertex)
                .applyMatrix3(normalMatrix).multiplyScalar(Math.sign(transform.determinant())).normalize()
              const actual = new three.Vector3().fromBufferAttribute(normal, vertex)
              assert.ok(actual.dot(expected) > 1 - 1e-6, `${name}: smooth normal ${vertex} must follow the affine geometry transform`)
            }
          } finally {
            geometry.dispose()
          }
        }
      } finally {
        baseline.dispose()
      }
    })

    await t.test('reversed winding, missing gradient buffers, and empty meshes remain well-defined', () => {
      for (const [indices, expectedZ] of [[new Uint32Array([0, 1, 2]), 1], [new Uint32Array([0, 2, 1]), -1]] as const) {
        const geometry = build_typed_geometry({
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array(0),
          indices,
        })
        assert.ok(geometry)
        try {
          assert.deepEqual(Array.from(geometry.getAttribute('normal').array), [0, 0, expectedZ, 0, 0, expectedZ, 0, 0, expectedZ])
          assert.ok(Number.isFinite(geometry.boundingSphere.radius))
        } finally {
          geometry.dispose()
        }
      }
      assert.equal(build_typed_geometry({ positions: new Float32Array(0), indices: new Uint32Array(0) }), null)
      assert.equal(build_typed_geometry({ positions: new Float32Array(9), indices: new Uint32Array(0) }), null)
    })
  } finally {
    await vite.close()
  }
})
