import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright'

const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-frequency-browser'
await mkdir(artifacts, { recursive: true })
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
let browser
let page
const errors = []
const checks = []
const record = message => { checks.push(message); console.log('PASS', message) }
const fixture = name => fileURLToPath(new URL(`../fixtures/frequency/${name}.cjson`, import.meta.url))
try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  page.on('pageerror', error => errors.push(error.message))
  // Only the unrelated workflow catalog is stubbed. File input, mode adapter,
  // MatterViz component, WebGL renderer and interactions are the production build.
  await page.route('**/api/workflows/**', route => {
    assert.equal(route.request().method(), 'GET', 'viewing frequencies must not run a calculation')
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      format: 'multiwfn-workflows', version: 1, available: true, scripts: [],
      session: null, runner: 'unused-runner', library: '/unused-library', results: '/unused-results',
      wavefunction: null, multiwfn: 'unused-engine', catalogError: null, job: null,
    }) })
  })
  await page.goto(`http://127.0.0.1:${address.port}/?workbench=1&cap=test-capability`)
  const open = page.getByRole('button', { name: 'Vibrational modes', exact: true })
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Vibrational modes', exact: true })
  const file = dialog.getByLabel('Frequency file', { exact: true })
  await file.setInputFiles(fixture('gaussian16-water'))
  const canvas = dialog.locator('canvas')
  await canvas.waitFor()
  const step = dialog.getByRole('spinbutton', { name: 'Step input', exact: true })
  await page.waitForTimeout(1200)
  assert.equal(await step.inputValue(), '0')
  assert.equal(await dialog.getByRole('combobox', { name: 'Normal mode', exact: true }).locator('option').count(), 3)
  assert.match(await dialog.innerText(), /IR: 7.25 km\/mol/)
  assert.equal(await canvas.count(), 1)
  await page.evaluate(() => { window.frequencyCanvas = document.querySelector('dialog canvas') })
  // Read MatterViz's public scene registry from the shared production chunk.
  // Rollup renames exports; locate the registry by the canvas key, not its minified name.
  const chunks = (await readdir(new URL('../../dist/assets/', import.meta.url)))
    .filter(name => name.endsWith('.js') && name.startsWith('structure-'))
  assert.equal(chunks.length, 1)
  await page.evaluate(async chunk => {
    const module = await import(`/assets/${chunk}`)
    window.frequencyScenes = Object.values(module).find(value =>
      (value instanceof Map || value instanceof WeakMap) && value.get(window.frequencyCanvas)?.camera)
  }, chunks[0])
  const cameraPose = () => page.evaluate(() => {
    const camera = window.frequencyScenes.get(window.frequencyCanvas).camera
    return [...camera.position.toArray(), ...camera.quaternion.toArray(), camera.zoom]
  })
  const near = (left, right) => left.every((value, index) => Math.abs(value - right[index]) < 1e-7)
  const initialCamera = await cameraPose()
  await page.waitForTimeout(300)
  assert.ok(near(initialCamera, await cameraPose()), 'paused startup must also disable camera auto-rotation')
  const geometryPositions = () => page.evaluate(() => {
    const positions = []
    window.frequencyScenes.get(window.frequencyCanvas).scene.traverse(object => {
      if (object.isInstancedMesh) {
        for (let index = 0; index < object.count; index++) {
          positions.push(...object.instanceMatrix.array.slice(index * 16 + 12, index * 16 + 15))
        }
      } else if (object.isMesh) positions.push(...object.matrixWorld.elements.slice(12, 15))
    })
    return positions
  })
  record('Real Gaussian export: three modes, equilibrium frame and initially paused')

  const play = dialog.locator('.play-button')
  await play.click()
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Step input"]').value) > 0)
  await play.click()
  const paused = await step.inputValue()
  await page.waitForTimeout(250)
  assert.equal(await step.inputValue(), paused)
  await step.fill('0')
  await page.waitForTimeout(250)
  const equilibrium = await canvas.screenshot()
  const equilibriumPositions = await geometryPositions()
  await step.fill('12')
  await page.waitForTimeout(250)
  assert.notDeepEqual(await canvas.screenshot(), equilibrium, 'quarter-cycle must change rendered atoms')
  assert.notDeepEqual(await geometryPositions(), equilibriumPositions, 'the native scene must update geometry, not only pixel effects')
  record('Native playback, pause and frame scrubbing visibly move the molecule')

  const modes = dialog.getByRole('combobox', { name: 'Normal mode', exact: true })
  await modes.selectOption('1')
  await page.waitForTimeout(250)
  assert.equal(await step.inputValue(), '12', 'changing modes preserves the current visual phase')
  const amplitude = dialog.getByRole('spinbutton', { name: 'Visual amplitude (Å)', exact: true })
  for (const value of ['', '0', '-1', '10']) {
    await amplitude.fill(value)
    await amplitude.press('Tab')
    assert.equal(await amplitude.inputValue(), '0.3')
  }
  await amplitude.fill('0.5')
  await amplitude.press('Tab')
  assert.equal(await amplitude.inputValue(), '0.5')
  record('Mode selection and amplitude changes use the same canvas; invalid amplitude recovers')

  const bounds = await canvas.boundingBox()
  await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height * .7, { steps: 12 })
  await page.mouse.up()
  await page.mouse.wheel(0, -140)
  await page.mouse.move(5, 5)
  const settledCamera = async () => {
    let previous = await cameraPose()
    for (let attempt = 0; attempt < 30; attempt++) {
      await page.waitForTimeout(200)
      const current = await cameraPose()
      if (near(current, previous)) return current
      previous = current
    }
    throw new Error('The native camera did not settle after interaction')
  }
  const rotated = await settledCamera()
  await canvas.screenshot({ path: `${artifacts}/camera-before.png` })
  await modes.selectOption('2')
  await modes.selectOption('1')
  await page.mouse.move(5, 5)
  await page.waitForTimeout(250)
  const returned = await settledCamera()
  await canvas.screenshot({ path: `${artifacts}/camera-after.png` })
  assert.ok(near(returned, rotated), `switching modes must preserve the camera: ${JSON.stringify({ rotated, returned })}`)
  await play.click()
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Step input"]').value) !== 12)
  await play.click()
  assert.ok(near(await settledCamera(), rotated), 'playback must also preserve the native camera')
  await step.fill('12')
  await page.waitForTimeout(250)
  assert.equal(await page.evaluate(() => document.querySelector('dialog canvas') === window.frequencyCanvas), true)
  await dialog.getByRole('button', { name: 'Reset camera (or double-click)', exact: true }).click()
  assert.ok(near(await settledCamera(), initialCamera), 'native reset must retain the initial camera baseline across frames')
  record('Native rotate/zoom and mode switching preserve the camera and canvas')

  await file.setInputFiles({ name: 'broken.cjson', mimeType: 'application/json', buffer: Buffer.from('{"chemical json":0}') })
  await dialog.getByRole('alert').waitFor()
  assert.equal(await modes.locator('option').count(), 3)
  assert.match(await dialog.locator('.filename').innerText(), /gaussian16-water/)
  await play.click()
  await page.waitForFunction(() => document.querySelector('dialog .play-button')?.classList.contains('playing'))
  const imaginary = JSON.parse(await readFile(fixture('gaussian16-water'), 'utf8'))
  imaginary.vibrations.frequencies[0] = -2169.7613
  await file.setInputFiles({ name: 'imaginary.cjson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imaginary)) })
  await page.waitForFunction(() => document.querySelector('dialog .filename')?.textContent === 'imaginary.cjson')
  assert.match(await modes.locator('option').first().textContent(), /-2169.76 cm⁻¹ \(imaginary\)/)
  assert.equal(await step.inputValue(), '0')
  await page.waitForTimeout(250)
  assert.equal(await step.inputValue(), '0', 'a replacement file must stop existing playback')
  assert.equal(await dialog.getByRole('alert').count(), 0)
  record('Invalid file keeps valid data; replacement resets playback and preserves negative frequency')

  await file.setInputFiles(fixture('orca42-dvb'))
  await page.waitForFunction(() => document.querySelector('dialog .filename')?.textContent === 'orca42-dvb.cjson')
  await page.waitForTimeout(500)
  assert.equal(await modes.locator('option').count(), 54)
  assert.match(await modes.locator('option').first().textContent(), /45.75/)
  await modes.selectOption('53')
  await step.fill('12')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${artifacts}/orca-frequency.png` })
  await page.setViewportSize({ width: 600, height: 800 })
  await page.waitForTimeout(250)
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: `${artifacts}/narrow-frequency.png` })
  record('Real ORCA export: all 54 modes and responsive viewer')

  await page.evaluate(() => { window.frequencyClosingCanvas = document.querySelector('dialog canvas') })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await open.evaluate(element => document.activeElement === element), true)
  assert.equal(await page.locator('canvas').count(), 0)
  assert.equal(await page.evaluate(() => window.frequencyClosingCanvas.isConnected), false)
  // MatterViz's public registry is a WeakMap: our test reference keeps the old
  // canvas reachable. Drop it rather than requiring an eager WeakMap.delete.
  await page.evaluate(() => { delete window.frequencyClosingCanvas; delete window.frequencyCanvas })
  await open.click()
  await file.setInputFiles(fixture('gaussian16-water'))
  await canvas.waitFor()
  assert.equal(await step.inputValue(), '0')
  assert.equal(await canvas.count(), 1)
  await page.screenshot({ path: `${artifacts}/gaussian-frequency.png` })
  record('Closing restores workbench focus and releases the scene; reopening starts paused')
  assert.deepEqual(errors, [])
} catch (error) {
  await page?.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {})
  if (page) await writeFile(`${artifacts}/failure.txt`, await page.locator('body').ariaSnapshot().catch(() => ''))
  throw error
} finally {
  await writeFile(`${artifacts}/verification.json`, JSON.stringify({ checks, errors }, null, 2))
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
