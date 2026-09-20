// Real WebGL pixels: brightness gain, saturation, unchanged alpha and saved settings.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const preview = process.env.PREVIEW_URL || 'http://127.0.0.1:5297/?manifest=/session/surface-manifest.json'
const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-rep-color'
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US', acceptDownloads: true })
const errors = [], checks = [], results = {}
page.on('pageerror', error => errors.push(String(error)))
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
const button = name => page.getByRole('button', { name, exact: true })
const input = name => page.getByRole('spinbutton', { name, exact: true })
const tab = name => page.getByRole('tab', { name, exact: true })
const select = name => page.getByRole('combobox', { name, exact: true })
const record = message => { checks.push(message); console.log('PASS', message) }
const sample = async name => {
  await page.waitForTimeout(250)
  const result = await page.evaluate(() => {
    const { scene, camera } = window.colorScene, renderer = window.colorRenderer
    renderer.render(scene, camera)
    const canvas = document.createElement('canvas'), source = renderer.domElement
    canvas.width = source.width; canvas.height = source.height
    const context = canvas.getContext('2d'); context.drawImage(source, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let weight = 0, chroma = 0, brightness = 0, alphaHash = 2166136261, colorHash = 2166136261
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = data.subarray(i, i + 4)
      alphaHash = Math.imul(alphaHash ^ a, 16777619)
      for (let c = 0; c < 4; c++) colorHash = Math.imul(colorHash ^ data[i + c], 16777619)
      if (a < 16) continue
      weight += a; chroma += (Math.max(r, g, b) - Math.min(r, g, b)) * a
      brightness += (0.2126 * r + 0.7152 * g + 0.0722 * b) * a
    }
    return { chroma: chroma / weight, brightness: brightness / weight, weight, alphaHash, colorHash,
      camera: [camera.position.toArray(), camera.quaternion.toArray(), camera.zoom], png: canvas.toDataURL('image/png') }
  })
  if (name) await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(result.png.split(',')[1], 'base64'))
  delete result.png
  assert.ok(result.weight > 100000, 'capture contains visible geometry')
  return result
}
const colors = async name => {
  await input('Saturation').fill('1'); const normal = await sample(`${name}-1`)
  await input('Saturation').fill('0'); const gray = await sample()
  await input('Saturation').fill('3'); const vivid = await sample(`${name}-3`)
  assert.ok(gray.chroma < 1, `${name}: saturation 0 must be grayscale (${gray.chroma})`)
  assert.ok(vivid.chroma > normal.chroma * 1.05, `${name}: 3 must be more saturated than 1 (${vivid.chroma} vs ${normal.chroma})`)
  assert.equal(gray.alphaHash, normal.alphaHash); assert.equal(vivid.alphaHash, normal.alphaHash)
  assert.deepEqual(vivid.camera, normal.camera)
  await input('Saturation').fill('1')
  assert.equal((await sample()).colorHash, normal.colorHash, 'returning to 1 exactly restores the original pixels')
  results[name] = { normal, gray, vivid }
}
try {
  await page.goto(preview, { waitUntil: 'networkidle', timeout: 180000 })
  await page.locator('.rep-row').first().waitFor()
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(url => /\/matterviz\.js/.test(url))
    const mv = await import(url), canvas = document.querySelector('.structure canvas')
    window.colorScene = mv.scene_registry.get(canvas); window.colorRenderer = mv.renderer_registry.get(canvas)
  })
  await page.waitForFunction(() => window.colorScene.scene.getObjectByName('rep-copies-volume-1')?.children[0]?.children.length > 0)
  await button('Scene').click(); await page.getByRole('checkbox', { name: 'Axes', exact: true }).uncheck()
  await button('Representations').click()
  await page.locator('.rep-visibility').nth(1).click()
  await tab('Appearance').click()
  assert.equal(await input('Diffuse reflection').getAttribute('max'), '3')
  assert.equal(await input('Saturation').getAttribute('max'), '3')
  for (const model of ['matte', 'glossy', 'pbr', 'unlit']) {
    await select('Shading model').selectOption(model)
    await colors(`molecule-${model}`)
    if (model === 'unlit') assert.equal(await input('Diffuse reflection').count(), 0)
    else {
      await input('Diffuse reflection').fill('3'); const bright = await sample()
      assert.ok(bright.brightness > results[`molecule-${model}`].normal.brightness + 3, `${model}: diffuse gain must brighten the model`)
      await input('Diffuse reflection').fill('1')
    }
  }
  record('All four material models: grayscale at 0, stronger color at 3, exact reset at 1; diffuse 3 brightens lit materials')
  await tab('Data & drawing').click(); await button('Stick').click(); await tab('Appearance').click()
  await colors('bonds')
  record('Bond gradients support saturation without changing alpha or camera')
  await select('Shading model').selectOption('glossy')
  await input('Diffuse reflection').fill('2.4'); await input('Saturation').fill('1.6')
  await page.locator('.rep-visibility').first().click(); await page.locator('.rep-visibility').nth(1).click()
  await page.locator('.rep-select').nth(1).click()
  await page.waitForFunction(() => window.colorScene.scene.getObjectByName('rep-copies-volume-1')?.children[0]?.children.length > 0)
  await input('Opacity').fill('0.65')
  await colors('surface')
  await tab('Data & drawing').click(); await select('Drawing method').selectOption('wire'); await tab('Appearance').click()
  await colors('wireframe')
  await tab('Data & drawing').click(); await select('Drawing method').selectOption('surface'); await tab('Appearance').click()
  record('Mapped surface and wireframe saturation works, including unchanged translucent alpha')
  await input('Diffuse reflection').fill('2.3'); await input('Saturation').fill('2.6')
  assert.equal(await select('Material preset').inputValue(), 'custom')
  await button('Save').click()
  const download = page.waitForEvent('download'); await button('Save display settings').click()
  const file = path.join(artifacts, 'colors.json'); await (await download).saveAs(file)
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.representations.items[0].material.saturation, 1.6)
  assert.equal(saved.representations.items[0].material.diffuse, 2.4)
  assert.equal(saved.representations.items[1].material.saturation, 2.6)
  assert.equal(saved.representations.items[1].material.diffuse, 2.3)
  await input('Saturation').fill('0.2'); await input('Diffuse reflection').fill('0.2')
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(file)
  await page.waitForFunction(() => [...document.querySelectorAll('.rep-scalar')].find(row => row.firstElementChild?.textContent === 'Saturation')?.querySelector('input[type=number]')?.value === '2.6')
  assert.equal(await input('Diffuse reflection').inputValue(), '2.3')
  await button('切换到中文').click()
  assert.equal(await input('饱和度').inputValue(), '2.6'); assert.equal(await input('漫反射').inputValue(), '2.3')
  await page.screenshot({ path: path.join(artifacts, 'controls-zh.png'), animations: 'disabled' })
  record('Independent values above 1 round-trip through settings; bilingual labels and custom preset detection work')
  assert.deepEqual(errors, [])
  await writeFile(path.join(artifacts, 'verification.json'), JSON.stringify({ preview, checks, results, errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png'), animations: 'disabled' }).catch(() => {})
  console.error({ checks, results, errors }); throw error
} finally { await browser.close() }
