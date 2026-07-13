import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apply_representation_preset,
  detect_representation_preset,
} from '../src/representation.ts'

test('maps all original GUI representation presets atomically', () => {
  const base = { atom_radius: 1.2, bond_thickness: 0.3, same_size_atoms: true }
  assert.deepEqual(
    apply_representation_preset(base, 'ballstick'),
    {
      ...base,
      representation_preset: 'ballstick',
      show_atoms: true,
      show_bonds: 'always',
      atom_radius: 1.2,
      same_size_atoms: false,
      bond_thickness: 0.3,
    },
  )
  assert.deepEqual(
    apply_representation_preset(base, 'spacefill'),
    {
      ...base,
      representation_preset: 'spacefill',
      show_atoms: true,
      show_bonds: 'never',
      atom_radius: 2.22,
      same_size_atoms: false,
      bond_thickness: 0.3,
    },
  )
  assert.deepEqual(
    apply_representation_preset(base, 'stick'),
    {
      ...base,
      representation_preset: 'stick',
      show_atoms: false,
      show_bonds: 'always',
      atom_radius: 1.2,
      same_size_atoms: false,
      bond_thickness: 0.354,
    },
  )
  assert.deepEqual(
    apply_representation_preset(base, 'wire'),
    {
      ...base,
      representation_preset: 'wire',
      show_atoms: false,
      show_bonds: 'always',
      atom_radius: 1.2,
      same_size_atoms: false,
      bond_thickness: 0.084,
    },
  )
})

test('switching repeatedly does not compound preset ratios', () => {
  let scene = { atom_radius: 1.1, bond_thickness: 0.2 }
  scene = apply_representation_preset(scene, 'spacefill')
  scene = apply_representation_preset(scene, 'ballstick')
  scene = apply_representation_preset(scene, 'spacefill')
  scene = apply_representation_preset(scene, 'ballstick')
  assert.equal(scene.atom_radius, 1.1)
  assert.equal(scene.bond_thickness, 0.2)

  scene = apply_representation_preset(scene, 'wire')
  scene = apply_representation_preset(scene, 'stick')
  scene = apply_representation_preset(scene, 'wire')
  assert.equal(scene.bond_thickness, 0.2 * 0.28)
})

test('manual transformed refinements become the next preset base', () => {
  let scene = apply_representation_preset({ atom_radius: 0.8, bond_thickness: 0.1 }, 'spacefill')
  scene = { ...scene, atom_radius: 2.4 }
  scene = apply_representation_preset(scene, 'ballstick')
  assert.equal(scene.atom_radius, 2.4 / 1.85)

  scene = apply_representation_preset(scene, 'stick')
  scene = { ...scene, bond_thickness: 0.5 }
  scene = apply_representation_preset(scene, 'ballstick')
  assert.equal(scene.bond_thickness, 0.5 / 1.18)
})

test('normalizes non-finite and out-of-range dimensions', () => {
  const scene = apply_representation_preset({ atom_radius: Number.NaN, bond_thickness: 40 }, 'spacefill')
  assert.equal(scene.atom_radius, 1.295)
  assert.equal(scene.bond_thickness, 1)
  assert.equal(detect_representation_preset({ show_atoms: true, show_bonds: 'never' }), 'spacefill')
})
