// Real WebGL acceptance. Run against the molecule/density/ESP preview (README).
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const preview = process.env.PREVIEW_URL || 'http://127.0.0.1:5297/?manifest=/session/surface-manifest.json'
const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-representations'
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'en-US', acceptDownloads: true })
const errors = [], checks = []
page.on('pageerror', error => errors.push(String(error)))
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
page.setDefaultTimeout(20000)
const record = message => { checks.push(message); console.log('PASS', message) }
const button = name => page.getByRole('button', { name, exact: true })
const tab = name => page.getByRole('tab', { name, exact: true })
const input = name => page.getByRole('spinbutton', { name, exact: true })
const select = name => page.getByRole('combobox', { name, exact: true })
const settle = () => page.waitForTimeout(300)
const rename = async name => { await page.getByRole('textbox', { name: 'Rep name', exact: true }).fill(name); await tab('Data & drawing').click() }
const save = async (name, zh = false) => {
  await button(zh ? '保存' : 'Save').click()
  const event = page.waitForEvent('download')
  await button(zh ? '保存显示设置' : 'Save display settings').click()
  const file = path.join(artifacts, `${name}.json`)
  await (await event).saveAs(file)
  await page.getByRole('dialog', { name: zh ? '保存选项' : 'Save controls', exact: true }).waitFor({ state: 'hidden' })
  return JSON.parse(await readFile(file, 'utf8'))
}
const scene = async () => page.evaluate(() => {
  const { scene, camera } = window.repTestScene
  const reps = []
  let cameras = 0, lights = 0
  scene.traverse(object => {
    cameras += Boolean(object.isCamera); lights += Boolean(object.isLight)
    if (!object.name.startsWith('representation-')) return
    const meshes = []
    object.traverseVisible(mesh => {
      if (!mesh.isMesh || (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every(m => !m.visible)) return
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      meshes.push({ geometry: mesh.geometry.uuid, material: material.uuid, type: material.type, opacity: material.opacity,
        roughness: material.roughness, metalness: material.metalness, planes: material.clippingPlanes?.length ?? 0,
        shape: mesh.geometry.type, count: mesh.count, position: mesh.position.toArray() })
    })
    const copies = object.getObjectByName(object.name.replace('representation-', 'rep-copies-'))
    reps.push({ id: object.name.replace('representation-', ''), meshes, order: object.renderOrder,
      copies: copies?.children.map(copy => copy.position.toArray()) })
  })
  return { reps, cameras, lights, position: camera.position.toArray(), canvasCount: document.querySelectorAll('canvas').length }
})
try {
  await page.goto(preview, { waitUntil: 'networkidle', timeout: 180000 })
  await page.locator('.rep-row').first().waitFor()
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(url => /\/matterviz\.js/.test(url))
    const mv = await import(url)
    window.repTestScene = mv.scene_registry.get(document.querySelector('canvas'))
    window.repTestCanvas = document.querySelector('canvas')
  })
  await page.waitForFunction(() => {
    const group = window.repTestScene.scene.getObjectByName('rep-copies-volume-1')
    return group?.children.length > 0 && group.children[0].children.length > 0
  })
  let initial = await scene()
  assert.equal(initial.canvasCount, 1); assert.equal(initial.cameras, 1); assert.equal(initial.lights, 4)
  assert.equal(initial.reps.length, 2)
  assert.ok(initial.reps.find(rep => rep.id === 'volume-1').meshes.length)
  await page.screenshot({ path: path.join(artifacts, 'reps-initial.png') })
  record('Structure and real density volume overlay in one canvas with one camera and four lights')

  await button('Add Rep').click()
  await select('Source type').selectOption('volume'); await select('Dataset').selectOption('0')
  await input('Isovalue').fill('0.002'); await settle()
  assert.equal(await page.locator('.rep-row').count(), 4)
  assert.equal((await scene()).reps.length, 3)
  await button('Delete Rep').click(); await page.locator('.rep-select').first().click()
  record('Create a Rep, choose its data type/dataset/drawing value, then delete it without changing existing Reps')

  await button('Duplicate Rep').click(); await rename('Independent molecule')
  await button('Spacefill').click()
  await tab('Appearance').click()
  assert.equal(await page.locator('[role=tabpanel]:visible').count(), 1)
  await input('Opacity').fill('0.4')
  await input('Diffuse reflection').fill('0.25')
  await input('Highlight strength').fill('0.7')
  await select('Shading model').selectOption('pbr')
  await input('Roughness').fill('0.2'); await input('Metalness').fill('0.8')
  await settle()
  let current = await scene()
  assert.deepEqual(current.position, initial.position)
  assert.equal(current.cameras, 1); assert.equal(current.lights, 4)
  const duplicate = current.reps.find(rep => !['structure-1', 'volume-1'].includes(rep.id))
  assert.ok(duplicate.meshes.some(mesh => mesh.type === 'MeshStandardMaterial' && mesh.opacity === .4 && mesh.roughness === .2 && mesh.metalness === .8))
  assert.ok(current.reps.find(rep => rep.id === 'structure-1').meshes.some(mesh => mesh.type === 'MeshPhongMaterial' && mesh.opacity === 1))
  await tab('Data & drawing').click(); await button('Ball+Stick').click(); await settle()
  current = await scene()
  assert.ok(current.reps.find(rep => rep.id === duplicate.id).meshes.some(mesh => mesh.shape === 'CylinderGeometry' && mesh.type === 'MeshStandardMaterial' && mesh.metalness === .8), 'bonds use the same PBR model')
  await tab('Appearance').click(); await select('Material preset').selectOption('glass1'); await settle()
  assert.equal(await input('Opacity').inputValue(), '0.35')
  await button('Move Rep up').click(); await button('Move Rep down').click()
  await button('Hide Independent molecule').click(); await settle()
  assert.equal((await scene()).reps.length, 2)
  record('Independent drawing/materials, real PBR atoms and bonds, glass opacity, ordering and visibility')

  await page.locator('.rep-select').nth(1).click()
  await tab('Data & drawing').click()
  await select('Color by').selectOption('1')
  await page.getByRole('checkbox', { name: 'Manual color range', exact: true }).check()
  await input('Minimum').fill('-0.04'); await input('Maximum').fill('0.06')
  await tab('PBC').click()
  await page.getByRole('checkbox', { name: 'Repeat this Rep periodically', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Use custom lattice vectors', exact: true }).check()
  const cell = [[14, 2, 0], [0, 14, 0], [0, 0, 14]]
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) await input(`Lattice ${'abc'[row]} ${'xyz'[col]}`).fill(String(cell[row][col]))
  await page.getByRole('checkbox', { name: 'Repeat along b', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Repeat along c', exact: true }).uncheck()
  await input('a lower bound').fill('-0.5'); await input('a upper bound').fill('1.5')
  await button('Apply periodic display').click(); await settle()
  let volume = (await scene()).reps.find(rep => rep.id === 'volume-1')
  assert.deepEqual(volume.copies, [[-14, -2, 0], [0, 0, 0], [14, 2, 0]])
  assert.ok(volume.meshes.every(mesh => mesh.planes === 2))
  assert.ok(new Set(volume.meshes.map(mesh => mesh.geometry)).size < volume.meshes.length, 'volume copies share extracted geometry')
  assert.ok(new Set(volume.meshes.map(mesh => mesh.material)).size < volume.meshes.length, 'volume copies share materials')
  await input('Lattice a x').fill('0'); await input('Lattice a y').fill('0')
  await button('Apply periodic display').click()
  assert.match(await page.getByRole('alert').innerText(), /nonsingular/)
  assert.deepEqual((await scene()).reps.find(rep => rep.id === 'volume-1').copies, volume.copies)
  await input('Lattice a x').fill('14'); await input('Lattice a y').fill('2'); await button('Apply periodic display').click()
  record('Fractional negative PBC with custom skew vectors, actual clipping, shared geometry, invalid-cell rejection')

  await page.locator('.rep-select').last().click()
  await page.getByRole('checkbox', { name: 'Repeat this Rep periodically', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Use custom lattice vectors', exact: true }).check()
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) await input(`Lattice ${'abc'[row]} ${'xyz'[col]}`).fill(String(cell[row][col]))
  await page.getByRole('checkbox', { name: 'Repeat along b', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Repeat along c', exact: true }).uncheck()
  await input('a lower bound').fill('-0.25'); await input('a upper bound').fill('1.25')
  await button('Apply periodic display').click(); await button('Show Independent molecule').click(); await settle()
  const repeated = (await scene()).reps.find(rep => rep.id === duplicate.id)
  assert.ok(repeated.meshes.some(mesh => mesh.shape === 'SphereGeometry' && mesh.count > 32 && mesh.planes === 2))
  assert.ok((await scene()).reps.find(rep => rep.id === 'structure-1').meshes.every(mesh => mesh.planes === 0))
  assert.deepEqual((await scene()).reps.find(rep => rep.id === 'volume-1').copies, volume.copies)
  await button('Hide Independent molecule').click()
  await page.locator('.rep-select').nth(1).click()
  record('Structure PBC independently replicates and clips atoms/bonds alongside the volume Rep')

  const saved = await save('representations')
  assert.equal(saved.representations.items.length, 4)
  const storedVolume = saved.representations.items.find(rep => rep.id === 'volume-1')
  assert.deepEqual(storedVolume.periodic.cell, cell); assert.equal(storedVolume.volume.color_volume_idx, 1)
  await button('Delete Rep').click()
  assert.equal(await page.locator('.rep-row').count(), 3)
  await page.locator('input[accept="application/json,.json"]').setInputFiles(path.join(artifacts, 'representations.json'))
  await page.waitForFunction(() => document.querySelectorAll('.rep-row').length === 4)
  const restored = await save('restored')
  assert.deepEqual(restored.representations, saved.representations)
  await button('切换到中文').click()
  await page.getByRole('complementary', { name: '表示层编辑器', exact: true }).waitFor()
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN')
  const chinese = await save('chinese', true)
  assert.deepEqual(chinese, restored, 'language switch preserves camera, data and all display settings')
  assert.equal(await page.evaluate(() => document.querySelector('canvas') === window.repTestCanvas), true)
  await page.screenshot({ path: path.join(artifacts, 'reps-chinese.png') })
  await button('Switch to English').click()
  record('Save/restore all independent Reps and color sources; bilingual switch preserves complete state and canvas')

  // Use source atom coordinates from the real cube and the existing scene camera.
  await button('Hide Density').click()
  await page.locator('.rep-select').first().click(); await tab('Data & drawing').click()
  await page.getByRole('textbox', { name: 'Atom selection', exact: true }).fill('index 1-2')
  await page.getByRole('textbox', { name: 'Rep name', exact: true }).click()
  await button('Scene').click(); await button('Fit all visible Reps').click(); await settle()
  const points = await page.evaluate(() => {
    const { scene, camera } = window.repTestScene, group = scene.getObjectByName('representation-structure-1')
    const points = []
    group.traverseVisible(mesh => {
      if (!mesh.isInstancedMesh || mesh.geometry.type !== 'SphereGeometry' || mesh.material.opacity === 0 || !mesh.material.visible) return
      for (let index = 0; index < mesh.count; index++) {
        const matrix = mesh.matrix.clone(); mesh.getMatrixAt(index, matrix)
        const world = mesh.position.clone().setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld)
        const p = world.clone().project(camera)
        const bounds = document.querySelector('canvas').getBoundingClientRect()
        points.push({ world: world.toArray(), x: bounds.x + (p.x + 1) * bounds.width / 2, y: bounds.y + (1 - p.y) * bounds.height / 2 })
      }
    })
    return points
  })
  assert.equal(points.length, 2)
  await page.mouse.click(points[0].x, points[0].y); await page.locator('.measurement-result').waitFor()
  await page.mouse.click(points[1].x, points[1].y)
  await page.waitForFunction(() => document.querySelector('.measurement-result strong')?.textContent.includes('Å'))
  assert.match(await page.locator('.measurement-result').innerText(), /1.*2|2.*1/)
  await button('Clear measurement').click()
  await page.locator('.measurement-result').waitFor({ state: 'hidden' })
  await page.mouse.click(points[0].x, points[0].y); await page.locator('.measurement-result').waitFor()
  await page.mouse.click(points[0].x, points[0].y); await page.locator('.measurement-result').waitFor({ state: 'hidden' })
  record('Real atom clicks measure source identities; clear and deselect-last remove measurement readout')

  for (const name of ['View', 'Tools', 'Save']) {
    await button(name).focus(); await page.keyboard.press('Enter')
    await page.getByRole('dialog', { name: `${name} controls`, exact: true }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await button(name).evaluate(e => e === document.activeElement), true)
  }
  await button('Tools').click()
  for (const name of ['ESP surface', 'AIM critical points and paths...', 'Quantitative surface results...']) assert.equal(await button(name).count(), 1)
  await page.keyboard.press('Escape')
  await button('View').click(); await button('2D Slice').click()
  await page.getByRole('complementary', { name: '2D volume slice', exact: true }).waitFor()
  await button('Close slice panel').click()
  await button('Tools').click(); await button('Edit atoms and bonds...').click()
  await page.locator('.rep-edit-banner').waitFor()
  await button('Measure / Edit').click(); await button('Edit Bonds').click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await settle()
  const nativePoint = await page.evaluate(points => {
    const { camera } = window.repTestScene, bounds = document.querySelector('canvas').getBoundingClientRect()
    const world = camera.position.clone().fromArray(points[0].world).add(camera.position.clone().fromArray(points[1].world)).multiplyScalar(.5).project(camera)
    return { x: bounds.x + (world.x + 1) * bounds.width / 2, y: bounds.y + (1 - world.y) * bounds.height / 2 }
  }, points)
  await page.mouse.click(nativePoint.x, nativePoint.y)
  await page.waitForFunction(() => !document.querySelector('[aria-label="Undo bond edit (Cmd/Ctrl+Z)"]').disabled)
  await button('Back to Reps').click(); await settle()
  let edited = (await scene()).reps.find(rep => rep.id === 'structure-1')
  assert.equal(edited.meshes.filter(mesh => mesh.shape === 'CylinderGeometry' && mesh.opacity > 0).length, 0,
    'deleting the source bond removes it from a Rep')
  await button('Tools').click(); await button('Edit atoms and bonds...').click()
  await button('Measure / Edit').click(); await button('Edit Bonds').click()
  await button('Undo bond edit (Cmd/Ctrl+Z)').click()
  await button('Back to Reps').click(); await settle()
  edited = (await scene()).reps.find(rep => rep.id === 'structure-1')
  assert.ok(edited.meshes.some(mesh => mesh.shape === 'CylinderGeometry' && mesh.opacity > 0), 'undo restores the bond in Reps')
  record('Native bond deletion and undo propagate back to the independently selected structure Rep')
  await tab('Data & drawing').focus(); await page.keyboard.press('ArrowRight')
  assert.equal(await tab('Appearance').getAttribute('aria-selected'), 'true')
  await input('Opacity').fill('0.9')
  await page.setViewportSize({ width: 600, height: 820 }); await settle()
  await button('Open representations').click()
  await page.waitForFunction(() => Math.abs(document.querySelector('canvas').getBoundingClientRect().height - document.querySelector('.scene-viewport').getBoundingClientRect().height) < 1)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const pane = await page.locator('.rep-editor').boundingBox(), canvas = await page.locator('canvas').boundingBox()
  assert.ok(pane.height >= 100, `editor must remain usable, height ${pane.height}`)
  assert.ok(canvas.height >= 180, `canvas must remain usable, height ${canvas.height}`)
  await page.screenshot({ path: path.join(artifacts, 'reps-narrow.png') })
  await page.locator('.rep-inspector').getByRole('button', { name: 'Close inspector', exact: true }).click(); await settle()
  await page.waitForFunction(height => document.querySelector('canvas').getBoundingClientRect().height > height, canvas.height)
  record('Keyboard tabs/menus, analysis/slice/editing entry points, usable collapsible 600 px layout')
  assert.deepEqual(errors, [])
  await writeFile(path.join(artifacts, 'verification.json'), JSON.stringify({ preview, checks, errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  console.error({ checks, errors }); throw error
} finally { await browser.close() }
