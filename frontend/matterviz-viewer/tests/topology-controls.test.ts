import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileModule } from 'svelte/compiler'
import { Sprite, SpriteMaterial } from 'three'
import ts from 'typescript'
import { create_topology_labels, topology_label_targets, TOPOLOGY_LABEL_LIMIT } from '../src/topology-labels.ts'
import { AIM_NUMBER_FIELDS, valid_aim_number } from '../src/topology-options.ts'

const data = (count: number) => ({
  points: Array.from({ length: count }, (_, index) => ({ id: index + 1, type: 1, position: [index, 0, 0] })),
  paths: Array.from({ length: count / 10 }, (_, index) => ({ id: index + 1, type: 1, points: [[index, 0, 0], [index, 1, 0]] })),
})
const display = () => ({ labels: true, cpTypes: [true, true, true, true, true], pathTypes: [true, true, true, true], radius: .09, width: 2 })

test('topology labels remain bounded at parser limits and give both object types room', () => {
  const scene = data(100000)
  const targets = topology_label_targets(scene, display())
  assert.equal(targets.length, TOPOLOGY_LABEL_LIMIT)
  assert.equal(targets.filter((target) => target.key.startsWith('cp:')).length, TOPOLOGY_LABEL_LIMIT / 2)
  assert.equal(targets.filter((target) => target.key.startsWith('path:')).length, TOPOLOGY_LABEL_LIMIT / 2)
  const pathsOnly = topology_label_targets(scene, { ...display(), cpTypes: [false, false, false, false, false] })
  assert.equal(pathsOnly.length, TOPOLOGY_LABEL_LIMIT)
  assert.ok(pathsOnly.every((target) => target.key.startsWith('path:')))
  assert.deepEqual(topology_label_targets(scene, { ...display(), labels: false }), [])
  const periodic = data(1)
  periodic.points.push({ ...periodic.points[0], position: [10, 0, 0] })
  const images = topology_label_targets(periodic, display())
  assert.equal(new Set(images.map((target) => target.key)).size, images.length)
})

test('label changes reuse retained sprites and release removed resources before replacement', () => {
  const scene = data(1000)
  let created = 0
  let disposed = 0
  let peak = 0
  const live = new Set<Sprite>()
  const labels = create_topology_labels(() => {
    const sprite = new Sprite(new SpriteMaterial())
    sprite.material.addEventListener('dispose', () => disposed++)
    live.add(sprite); created++; peak = Math.max(peak, live.size)
    return sprite
  }, (sprite) => { sprite.material.dispose(); live.delete(sprite) })
  const initial = topology_label_targets(scene, display())
  labels.sync(initial)
  const original = new Set(live)
  labels.sync(initial)
  assert.equal(created, TOPOLOGY_LABEL_LIMIT)
  assert.deepEqual(live, original)
  labels.sync(topology_label_targets(scene, { ...display(), cpTypes: [false, false, false, false, false] }))
  assert.equal([...live].filter((sprite) => original.has(sprite)).length, 100)
  assert.equal(peak, TOPOLOGY_LABEL_LIMIT)
  labels.clear()
  labels.clear()
  assert.equal(live.size, 0)
  assert.equal(disposed, created)
})

test('the actual label effect ignores dimensions and selection, but reacts to visibility and data', async () => {
  const overlay = await readFile(new URL('../src/TopologyOverlay.svelte', import.meta.url), 'utf8')
  const start = overlay.indexOf('  $effect(() => {\n    // Label resources')
  const end = overlay.indexOf('\n  onMount(', start)
  assert.ok(start > 0 && end > start)
  const fixture = `
    import assert from 'node:assert/strict'
    import { flushSync } from 'svelte'
    import { topology_label_targets } from './src/topology-labels.ts'
    let sceneData = $state.raw(${JSON.stringify(data(20))})
    let display = $state(${JSON.stringify(display())})
    let selection = $state(undefined)
    let updates = 0
    const labels = { sync: () => updates++ }
    const invalidate = () => {}
    const cleanup = $effect.root(() => { ${overlay.slice(start, end)} })
    flushSync()
    assert.equal(updates, 1)
    display.radius = .2
    display.width = 5
    selection = { kind: 'cp', id: 1 }
    flushSync()
    assert.equal(updates, 1)
    display.cpTypes[1] = false
    flushSync()
    assert.equal(updates, 2)
    display.labels = false
    flushSync()
    assert.equal(updates, 3)
    sceneData = { points: [], paths: [] }
    flushSync()
    assert.equal(updates, 4)
    cleanup()
    display.labels = true
    flushSync()
    assert.equal(updates, 4)
  `
  const compiled = compileModule(fixture, { filename: 'topology-labels.svelte.js', generate: 'client' })
  execFileSync(process.execPath, ['--conditions=browser', '--experimental-strip-types', '--input-type=module', '-e', compiled.js.code], {
    cwd: new URL('..', import.meta.url), timeout: 15000, stdio: 'pipe',
  })
})

test('search controls reject cleared, nonfinite, out-of-range and fractional count values', async () => {
  for (const field of AIM_NUMBER_FIELDS) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, field.min / 2, field.max * 2]) {
      assert.equal(valid_aim_number(field, value), false, `${field.key}: ${value}`)
    }
    assert.equal(valid_aim_number(field, field.min), true)
    assert.equal(valid_aim_number(field, field.max), true)
  }
  for (const field of AIM_NUMBER_FIELDS.filter((field) => field.step === 1)) assert.equal(valid_aim_number(field, 4.5), false)

  // Exercise the component's actual input handler: invalid edits must never
  // replace the last valid scientific parameters, and correcting a field clears its error.
  const panel = await readFile(new URL('../src/TopologyPanel.svelte', import.meta.url), 'utf8')
  const start = panel.indexOf('  const setNumber =')
  const end = panel.indexOf('\n</script>', start)
  const handler = ts.transpileModule(panel.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  const create = new Function('valid_aim_number', `
    let options = { cycles: 120 }; const invalidFields = {};
    ${handler}
    return { setNumber, state: () => ({ options, invalidFields }) };
  `)
  const controls = create(valid_aim_number)
  const cycles = AIM_NUMBER_FIELDS.find((field) => field.key === 'cycles')!
  controls.setNumber(cycles, { currentTarget: { valueAsNumber: Number.NaN } })
  assert.equal(controls.state().options.cycles, 120)
  assert.equal(controls.state().invalidFields.cycles, true)
  controls.setNumber(cycles, { currentTarget: { valueAsNumber: 240 } })
  assert.equal(controls.state().options.cycles, 240)
  assert.equal(controls.state().invalidFields.cycles, false)
})
