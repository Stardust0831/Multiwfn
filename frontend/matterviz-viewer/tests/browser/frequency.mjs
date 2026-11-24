import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright'
import { chromiumOptions } from './chromium-options.mjs'

const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-frequency-browser'
await mkdir(artifacts, { recursive: true })
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
let browser
let page
const errors = []
const checks = []
const cameraSettling = []
const record = message => { checks.push(message); console.log('PASS', message) }
const fixture = name => fileURLToPath(new URL(`../fixtures/frequency/${name}.cjson`, import.meta.url))
try {
  browser = await chromium.launch(chromiumOptions)
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  page.on('pageerror', error => errors.push(error.message))
  // Only the unrelated workflow catalog is stubbed. File input, mode adapter,
  // MatterViz component, renderer and interactions are the production build.
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
  const step = dialog.getByRole('spinbutton', { name: 'step input', exact: true })
  await page.waitForTimeout(1200)
  assert.equal(await step.inputValue(), '1')
  assert.equal(await dialog.getByRole('combobox', { name: 'Normal mode', exact: true }).locator('option').count(), 3)
  assert.match(await dialog.innerText(), /IR: 7.25 km\/mol/)
  assert.equal(await canvas.count(), 1)
  await page.evaluate(() => { window.frequencyCanvas = document.querySelector('dialog canvas') })
  // Read MatterViz's public scene registry from the shared production chunk.
  // Rollup renames exports; locate the registry by the canvas key, not its minified name.
  const assets = new URL('../../dist/assets/', import.meta.url)
  const chunks = []
  for (const map of (await readdir(assets)).filter(name => name.endsWith('.js.map'))) {
    const { sources } = JSON.parse(await readFile(new URL(map, assets), 'utf8'))
    if (sources.some(path => path.endsWith('/matterviz/dist/io/export.js'))) chunks.push(map.slice(0, -4))
  }
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
      const atoms = object.geometry?.getAttribute('atomPositionRadius')
      if (atoms) for (let i = 0; i < object.count; i++) positions.push(atoms.getX(i), atoms.getY(i), atoms.getZ(i))
    })
    return positions
  })
  const waitForGeometryChange = async (previous, message) => {
    const deadline = performance.now() + 10_000
    let current
    do {
      await page.waitForTimeout(100)
      current = await geometryPositions()
      if (current.length > 0 && (current.length !== previous.length ||
          current.some((value, index) => Math.abs(value - previous[index]) > 1e-6))) return
    } while (performance.now() < deadline)
    assert.fail(`${message}: ${JSON.stringify({ previous, current })}`)
  }
  record('Real Gaussian export: three modes, equilibrium frame and initially paused')

  const play = dialog.locator('.play-button')
  await play.click()
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="step input"]').value) > 1)
  await play.click()
  const paused = await step.inputValue()
  await page.waitForTimeout(250)
  assert.equal(await step.inputValue(), paused)
  await step.fill('1')
  await page.waitForTimeout(250)
  const equilibrium = await canvas.screenshot()
  const equilibriumPositions = await geometryPositions()
  await step.fill('13')
  await page.waitForTimeout(250)
  assert.notDeepEqual(await canvas.screenshot(), equilibrium, 'quarter-cycle must change rendered atoms')
  assert.notDeepEqual(await geometryPositions(), equilibriumPositions, 'the native scene must update geometry, not only pixel effects')
  record('Native playback, pause and frame scrubbing visibly move the molecule')

  const modes = dialog.getByRole('combobox', { name: 'Normal mode', exact: true })
  const modePositions = await geometryPositions()
  await modes.selectOption('1')
  await waitForGeometryChange(modePositions, 'changing modes must update rendered geometry')
  assert.equal(await step.inputValue(), '13', 'changing modes preserves the current visual phase')
  const amplitude = dialog.getByRole('spinbutton', { name: 'Visual amplitude (Å)', exact: true })
  for (const value of ['', '0', '-1', '10']) {
    await amplitude.fill(value)
    await amplitude.press('Tab')
    assert.equal(await amplitude.inputValue(), '0.3')
  }
  const amplitudePositions = await geometryPositions()
  await amplitude.fill('0.5')
  await amplitude.press('Tab')
  assert.equal(await amplitude.inputValue(), '0.5')
  await waitForGeometryChange(amplitudePositions, 'changing amplitude must update rendered geometry')
  record('Mode selection and amplitude changes use the same canvas; invalid amplitude recovers')

  // Capture upstream's reset pose for this mode and phase.
  await canvas.dblclick({ position: { x: 15, y: 15 } })
  await page.waitForTimeout(300)
  const homeCamera = await cameraPose()
  const bounds = await canvas.boundingBox()
  await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height * .7, { steps: 12 })
  await page.mouse.up()
  await page.mouse.wheel(0, -140)
  await page.mouse.move(5, 5)
  const settledCamera = async () => {
    // OrbitControls damping decays per rendered frame. Software WebGL on CI
    // can need more wall time than a local browser; retain the pose assertions
    // below and wait for tighter convergence rather than loosening them.
    const started = performance.now()
    const samples = []
    cameraSettling.push(samples)
    let previous = await cameraPose()
    let stableSamples = 0
    do {
      await page.waitForTimeout(200)
      const current = await cameraPose()
      const delta = Math.max(...current.map((value, index) => Math.abs(value - previous[index])))
      samples.push({ elapsedMs: Math.round(performance.now() - started), delta, pose: current })
      stableSamples = delta < 1e-10 ? stableSamples + 1 : 0
      if (stableSamples >= 3) return current
      previous = current
    } while (performance.now() - started < 30_000)
    throw new Error(`The native camera did not settle after interaction: ${JSON.stringify(samples.slice(-5))}`)
  }
  const rotated = await settledCamera()
  assert.ok(!near(rotated, initialCamera), 'native camera interaction must change the pose')
  await canvas.screenshot({ path: `${artifacts}/camera-before.png` })
  await modes.selectOption('2')
  await modes.selectOption('1')
  await page.mouse.move(5, 5)
  await page.waitForTimeout(250)
  const returned = await settledCamera()
  await canvas.screenshot({ path: `${artifacts}/camera-after.png` })
  assert.ok(near(returned, rotated), `switching modes must preserve the camera: ${JSON.stringify({ rotated, returned })}`)
  await play.click()
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="step input"]').value) !== 13)
  await play.click()
  // Upstream follows the frame center during playback. Rotation and zoom stay fixed.
  assert.ok(near((await settledCamera()).slice(3), rotated.slice(3)), 'playback preserves camera orientation and zoom')
  await step.fill('13')
  await page.waitForTimeout(250)
  assert.equal(await page.evaluate(() => document.querySelector('dialog canvas') === window.frequencyCanvas), true)
  await canvas.dblclick({ position: { x: 15, y: 15 } })
  const reset = await settledCamera()
  assert.ok(near(reset.slice(3, 7), homeCamera.slice(3, 7)) && !near(reset, rotated),
    `native reset restores the home orientation: ${JSON.stringify({ homeCamera, reset, rotated })}`)
  record('Native rotate/zoom and mode switching preserve the camera and canvas')

  await file.setInputFiles({ name: 'broken.cjson', mimeType: 'application/json', buffer: Buffer.from('{"chemical json":0}') })
  await dialog.locator('.error[role="alert"]').waitFor()
  assert.equal(await modes.locator('option').count(), 3)
  assert.match(await dialog.locator('.filename').innerText(), /gaussian16-water/)
  await play.click()
  await page.waitForFunction(() => document.querySelector('dialog .play-button')?.classList.contains('playing'))
  const imaginary = JSON.parse(await readFile(fixture('gaussian16-water'), 'utf8'))
  imaginary.vibrations.frequencies[0] = -2169.7613
  await file.setInputFiles({ name: 'imaginary.cjson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imaginary)) })
  await page.waitForFunction(() => document.querySelector('dialog .filename')?.textContent === 'imaginary.cjson')
  assert.match(await modes.locator('option').first().textContent(), /-2169.76 cm⁻¹ \(imaginary\)/)
  assert.equal(await step.inputValue(), '1')
  await page.waitForTimeout(250)
  assert.equal(await step.inputValue(), '1', 'a replacement file must stop existing playback')
  assert.equal(await dialog.locator('.error').count(), 0)
  record('Invalid file keeps valid data; replacement resets playback and preserves negative frequency')

  await file.setInputFiles(fixture('orca42-dvb'))
  await page.waitForFunction(() => document.querySelector('dialog .filename')?.textContent === 'orca42-dvb.cjson')
  await page.waitForTimeout(500)
  assert.equal(await modes.locator('option').count(), 54)
  assert.match(await modes.locator('option').first().textContent(), /45.75/)
  await modes.selectOption('53')
  await step.fill('13')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${artifacts}/orca-frequency.png` })
  await page.setViewportSize({ width: 600, height: 800 })
  await page.waitForTimeout(250)
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: `${artifacts}/narrow-frequency.png` })
  record('Real ORCA export: all 54 modes and responsive viewer')

  await page.evaluate(() => { window.frequencyClosingCanvas = document.querySelector('dialog canvas') })
  await dialog.getByRole('button', { name: 'Close vibration viewer', exact: true }).click()
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
  assert.equal(await step.inputValue(), '1')
  assert.equal(await canvas.count(), 1)
  await page.screenshot({ path: `${artifacts}/gaussian-frequency.png` })
  record('Closing restores workbench focus and releases the scene; reopening starts paused')
  assert.deepEqual(errors, [])
} catch (error) {
  await page?.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {})
  if (page) await writeFile(`${artifacts}/failure.txt`, await page.locator('body').ariaSnapshot().catch(() => ''))
  throw error
} finally {
  await writeFile(`${artifacts}/verification.json`, JSON.stringify({ checks, errors, cameraSettling }, null, 2))
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
