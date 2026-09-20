// Editable scales against real density/ESP geometry, pixels and saved scenes.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const preview = process.env.PREVIEW_URL || 'http://127.0.0.1:5297/?manifest=/session/surface-manifest.json'
const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-color-scale'
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US', acceptDownloads: true })
page.setDefaultTimeout(30000)
const errors = [], checks = []
page.on('pageerror', error => errors.push(String(error)))
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
const button = name => page.getByRole('button', { name, exact: true })
const input = name => page.getByRole('spinbutton', { name, exact: true })
const select = name => page.getByRole('combobox', { name, exact: true })
const position = index => input(`Position of color stop ${index} (%)`)
const hex = index => page.getByRole('textbox', { name: `Hex color of stop ${index}`, exact: true })
const edit = async (locator, value) => { await locator.fill(String(value)); await locator.press('Tab') }
const record = message => { checks.push(message); console.log('PASS', message) }
const capture = async name => {
  await page.waitForTimeout(200)
  const result = await page.evaluate(() => {
    const { scene, camera } = window.scaleScene, renderer = window.scaleRenderer
    let colorHash = 2166136261, vertices = 0
    const geometry = new Set()
    scene.getObjectByName('rep-copies-volume-1').traverse(mesh => {
      if (!mesh.isMesh || geometry.has(mesh.geometry.uuid)) return
      geometry.add(mesh.geometry.uuid)
      const color = mesh.geometry.getAttribute('color')
      vertices += color.count
      for (const byte of new Uint8Array(color.array.buffer, color.array.byteOffset, color.array.byteLength)) colorHash = Math.imul(colorHash ^ byte, 16777619)
    })
    renderer.render(scene, camera)
    const canvas = document.createElement('canvas'), source = renderer.domElement
    canvas.width = source.width; canvas.height = source.height
    const context = canvas.getContext('2d'); context.drawImage(source, 0, 0)
    let pixelHash = 2166136261
    for (const byte of context.getImageData(0, 0, canvas.width, canvas.height).data) pixelHash = Math.imul(pixelHash ^ byte, 16777619)
    return { geometry: [...geometry], colorHash, pixelHash, vertices,
      camera: [camera.position.toArray(), camera.quaternion.toArray(), camera.zoom], png: canvas.toDataURL('image/png') }
  })
  if (name) await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(result.png.split(',')[1], 'base64'))
  delete result.png
  assert.ok(result.vertices > 100, 'real mapped surface is present')
  return result
}
const save = async name => {
  await button('Save').click()
  const download = page.waitForEvent('download'); await button('Save display settings').click()
  const file = path.join(artifacts, `${name}.json`); await (await download).saveAs(file)
  return JSON.parse(await readFile(file, 'utf8'))
}
try {
  await page.goto(preview, { waitUntil: 'networkidle', timeout: 180000 })
  await page.locator('.rep-row').first().waitFor()
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(url => /\/matterviz\.js/.test(url))
    const mv = window.scaleMatterviz = await import(url), canvas = document.querySelector('.structure canvas')
    window.scaleScene = mv.scene_registry.get(canvas); window.scaleRenderer = mv.renderer_registry.get(canvas)
  })
  await page.waitForFunction(() => window.scaleScene.scene.getObjectByName('rep-copies-volume-1')?.children[0]?.children.length > 0)
  await page.locator('.rep-select').nth(1).click()
  await select('Color scale').selectOption('interpolateViridis')
  assert.equal(await page.locator('.scale-stop').count(), 0)
  assert.equal(await button('Add color stop').count(), 0)
  assert.equal(await select('Load preset').count(), 0)
  const viridis = await capture()
  await select('Color scale').selectOption('custom')
  assert.equal(await page.locator('.scale-stop').count(), 9)
  assert.equal(await hex(1).inputValue(), '#440154')
  assert.equal((await capture()).colorHash, viridis.colorHash, 'entering custom mode retains the selected preset colors')
  await select('Load preset').selectOption('interpolateTransFlag')
  assert.equal(await select('Color scale').inputValue(), 'custom')
  assert.equal(await page.locator('.scale-stop').count(), 3)
  await select('Load preset').selectOption('interpolateViridis')
  assert.equal(await page.locator('.scale-stop').count(), 9)
  await select('Color scale').selectOption('interpolateTransFlag')
  assert.equal(await page.locator('.scale-stop').count(), 0)
  assert.equal(await select('Load preset').count(), 0)
  await page.locator('.color-scale-editor').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(artifacts, 'color-scale-preset.png'), animations: 'disabled' })
  await select('Color scale').selectOption('custom')
  assert.equal(await page.locator('.scale-stop').count(), 3)
  record('Named presets hide editing controls; Custom keeps current colors and can load another preset while staying editable')
  const before = await capture('preset')
  await edit(position(2), 20)
  assert.equal(await select('Color scale').inputValue(), 'custom')
  await edit(hex(1), '#ff0000'); await edit(hex(2), '#00ff00'); await edit(hex(3), '#0000ff')
  const changed = await capture('custom')
  assert.deepEqual(changed.geometry, before.geometry, 'color edits retain the extracted mesh')
  assert.deepEqual(changed.camera, before.camera)
  assert.notEqual(changed.colorHash, before.colorHash)
  assert.notEqual(changed.pixelHash, before.pixelHash)
  record('Preset control points are editable; uneven positions and hex colors recolor actual surface pixels without rebuilding geometry')

  await button('Add color stop').click()
  assert.equal(await page.locator('.scale-stop').count(), 4)
  assert.equal(await position(3).inputValue(), '60')
  await button('Remove color stop 3').click()
  assert.equal((await capture()).colorHash, changed.colorHash)
  await edit(position(2), 0)
  assert.match(await page.getByRole('alert').innerText(), /distinct/)
  assert.equal(await position(2).inputValue(), '20')
  assert.equal((await capture()).colorHash, changed.colorHash)
  await edit(hex(2), '#zzzzzz')
  assert.match(await page.getByRole('alert').innerText(), /six-digit/)
  assert.equal(await hex(2).inputValue(), '#00ff00')
  await edit(position(1), 70)
  assert.equal(await position(1).inputValue(), '20')
  assert.equal(await hex(1).inputValue(), '#00ff00', 'sorting keeps each position paired with its own color')
  await edit(position(2), 0)
  record('Add/remove, automatic sorting and invalid/duplicate position or color feedback preserve valid state')

  if (!(await page.locator('.esp-legend').isVisible())) {
    await button('Tools').click(); await button('ESP legend').click(); await button('Tools').click()
  }
  const legendGradient = await page.locator('.legend-gradient').evaluate(el => el.style.backgroundImage)
  assert.match(legendGradient, /rgb\(0, 255, 0\) 20%/)
  assert.equal(legendGradient, (await page.locator('.scale-preview').evaluate(el => el.style.backgroundImage)).replace('to right', 'to top'))
  await page.getByRole('checkbox', { name: 'Manual color range', exact: true }).uncheck()
  // Independently sample the real ESP cube at the extracted surface vertices.
  const actualRange = await page.evaluate(async () => {
    const mv = window.scaleMatterviz, manifestUrl = new URL(new URL(location.href).searchParams.get('manifest'), location.href)
    const manifest = await (await fetch(manifestUrl)).json()
    const volumes = await Promise.all(manifest.cubes.map(async entry => mv.parse_cube(await (await fetch(new URL(entry.path, manifestUrl))).text()).volumes[0]))
    const sample = mv.create_volume_sampler(volumes[1], { out_of_bounds: 'fallback' }), arrays = [], seen = new Set()
    const origin = manifest.structure?.path ? [0, 0, 0] : volumes[0].origin
    window.scaleScene.scene.getObjectByName('rep-copies-volume-1').traverse(mesh => {
      if (!mesh.isMesh || seen.has(mesh.geometry.uuid)) return
      seen.add(mesh.geometry.uuid)
      const positions = mesh.geometry.getAttribute('position'), values = new Float32Array(positions.count)
      for (let i = 0; i < positions.count; i++) values[i] = sample([positions.getX(i) + origin[0], positions.getY(i) + origin[1], positions.getZ(i) + origin[2]])
      arrays.push(values)
    })
    return mv.compute_scalar_range(arrays, { symmetric: mv.is_signed_range(volumes[1].data_range) })
  })
  await page.waitForFunction(expected => document.querySelector('.esp-legend footer')?.textContent.includes(expected), Number(actualRange[0]).toPrecision(5))
  assert.ok((await page.locator('.esp-legend footer').innerText()).includes(Number(actualRange[1]).toPrecision(5)))
  record('Legend uses the same stop positions and actual surface-fitted range, verified from ESP samples')

  const original = await save('single-scale')
  const originalScale = original.representations.items.find(rep => rep.id === 'volume-1').volume.colorScale
  await button('Duplicate Rep').click()
  await edit(hex(2), '#ff00ff')
  await page.locator('.rep-select').nth(1).click()
  assert.equal(await hex(2).inputValue(), '#00ff00')
  const saved = await save('custom-scales')
  assert.deepEqual(saved.representations.items.find(rep => rep.id === 'volume-1').volume.colorScale, originalScale)
  assert.equal(saved.representations.items.at(-1).volume.colorScale.stops[1].color, '#ff00ff')
  await select('Color scale').selectOption('interpolatePlasma')
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(path.join(artifacts, 'custom-scales.json'))
  await page.waitForFunction(() => document.querySelectorAll('.scale-stop').length === 3)
  assert.equal(await select('Color scale').inputValue(), 'custom')
  assert.equal(await position(2).inputValue(), '20')
  assert.equal(await hex(2).inputValue(), '#00ff00')
  const restored = await save('restored-scales')
  assert.deepEqual(restored.representations, saved.representations)
  record('Duplicated Reps own independent color scales; save/import preserves all stops, ranges and selection')

  for (let count = 3; count < 32; count++) await button('Add color stop').click()
  assert.equal(await button('Add color stop').isDisabled(), true)
  for (let count = 32; count > 2; count--) await button(`Remove color stop ${count}`).click()
  assert.equal(await button('Remove color stop 1').isDisabled(), true)
  assert.equal(await button('Remove color stop 2').isDisabled(), true)
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(path.join(artifacts, 'custom-scales.json'))
  await page.waitForFunction(() => document.querySelectorAll('.scale-stop').length === 3)
  await button('切换到中文').click()
  assert.equal(await select('色彩轴').inputValue(), 'custom')
  assert.equal(await input('色标点 2 的位置（%）').inputValue(), '20')
  await page.locator('.color-scale-editor').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(artifacts, 'color-scale-zh.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 600, height: 850 })
  await page.waitForFunction(() => !document.querySelector('.rep-inspector'))
  await button('打开表示层').click()
  await page.locator('.color-scale-editor').scrollIntoViewIfNeeded()
  assert.equal(await page.locator('.color-scale-editor').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
  await page.screenshot({ path: path.join(artifacts, 'color-scale-narrow.png'), animations: 'disabled' })
  record('2–32 stop bounds, Chinese/English controls and the 600 px layout work')
  assert.deepEqual(errors, [])
  await writeFile(path.join(artifacts, 'verification.json'), JSON.stringify({ preview, checks, before, changed, actualRange, errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png'), animations: 'disabled' }).catch(() => {})
  console.error({ checks, errors }); throw error
} finally { await browser.close() }
