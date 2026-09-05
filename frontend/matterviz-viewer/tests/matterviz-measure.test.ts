import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

const close_to = (actual: number | null, expected: number, tolerance = 1e-10): void => {
  assert.notEqual(actual, null)
  assert.ok(
    Math.abs((actual as number) - expected) <= tolerance,
    `expected ${String(actual)} to be within ${tolerance} of ${expected}`,
  )
}

test('vendored measurement helpers implement ordered Multiwfn interactions', async (context) => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })

  try {
    const measure = await vite.ssrLoadModule('/node_modules/matterviz/dist/structure/measure.js')

    await context.test('distance restarts after two sites and selecting a chosen site cancels it', () => {
      const distanceRule = measure.resolve_measure_selection_rule({
        distance: { max_sites: 2, overflow: 'restart' },
        angle: { max_sites: 4, overflow: 'reject' },
      }, 'distance')

      assert.deepEqual(distanceRule, { max_sites: 2, overflow: 'restart' })
      assert.deepEqual(measure.next_measured_sites([], 4, distanceRule), {
        sites: [4],
        limit_reached: false,
      })
      assert.deepEqual(measure.next_measured_sites([4], 7, distanceRule), {
        sites: [4, 7],
        limit_reached: false,
      })
      assert.deepEqual(measure.next_measured_sites([4, 7], 9, distanceRule), {
        sites: [9],
        limit_reached: false,
      })
      assert.deepEqual(measure.next_measured_sites([4, 7], 4, distanceRule), {
        sites: [7],
        limit_reached: false,
      })
    })

    await context.test('angle keeps four ordered sites and rejects a fifth', () => {
      const policy = {
        distance: { max_sites: 2, overflow: 'restart' },
        angle: { max_sites: 4, overflow: 'reject' },
      }
      const angleRule = measure.resolve_measure_selection_rule(policy, 'angle')
      const distanceRule = measure.resolve_measure_selection_rule(policy, 'distance')

      assert.deepEqual(angleRule, { max_sites: 4, overflow: 'reject' })
      assert.notDeepEqual(angleRule, distanceRule)
      assert.deepEqual(measure.next_measured_sites([0, 1, 2], 3, angleRule), {
        sites: [0, 1, 2, 3],
        limit_reached: false,
      })
      const fullSelection = [0, 1, 2, 3]
      const rejected = measure.next_measured_sites(fullSelection, 4, angleRule)
      assert.deepEqual(rejected, {
        sites: [0, 1, 2, 3],
        limit_reached: true,
      })
      assert.deepEqual(fullSelection, [0, 1, 2, 3])
      assert.notStrictEqual(rejected.sites, fullSelection)
    })

    await context.test('displayed PBC endpoints only match within a finite position tolerance', () => {
      assert.equal(measure.positions_match([0, 0, 0], [0, 0, 0]), true)
      assert.equal(measure.positions_match([0, 0, 0], [5e-7, 0, 0]), true)
      assert.equal(measure.positions_match([0, 0, 0], [2e-6, 0, 0]), false)
      assert.equal(measure.positions_match([0, 0, 0], [10, 0, 0]), false)
      assert.equal(measure.positions_match([0, 0, 0], [Number.NaN, 0, 0]), false)
    })

    await context.test('ordered bond angles use the middle site and minimum-image vectors', () => {
      close_to(
        measure.bond_angle([1, 0, 0], [0, 0, 0], [0, 1, 0]),
        90,
      )

      const lattice = [[10, 0, 0], [0, 10, 0], [0, 0, 10]]
      close_to(
        measure.bond_angle([9.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], lattice),
        90,
      )
    })

    await context.test('signed dihedrals cover both orientations and the 180-degree boundary', () => {
      const a = [0, 1, 0]
      const b = [0, 0, 0]
      const c = [1, 0, 0]

      close_to(measure.dihedral_angle(a, b, c, [1, 0, -1]), -90)
      close_to(measure.dihedral_angle(a, b, c, [1, 0, 1]), 90)
      close_to(Math.abs(measure.dihedral_angle(a, b, c, [1, -1, 0])), 180)
    })

    await context.test('dihedral geometry follows the minimum-image chain under PBC', () => {
      const lattice = [[10, 0, 0], [0, 10, 0], [0, 0, 10]]
      const angle = measure.dihedral_angle(
        [9.5, 1, 0],
        [9.5, 0, 0],
        [0.5, 0, 0],
        [0.5, 0, 1],
        lattice,
      )
      close_to(angle, 90)
    })

    await context.test('degenerate angles return null instead of a non-finite value', () => {
      assert.equal(
        measure.bond_angle([0, 0, 0], [0, 0, 0], [0, 1, 0]),
        null,
      )
      assert.equal(
        measure.dihedral_angle([0, 0, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]),
        null,
      )
      assert.equal(
        measure.dihedral_angle([0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0]),
        null,
      )
    })
  } finally {
    await vite.close()
  }
})
