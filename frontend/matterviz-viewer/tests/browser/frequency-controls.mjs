// Production UI + native MatterViz acceptance. Saving is an HTTP-boundary stub;
// actual host writes/cancellation/validation are covered by the Rust harness.
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright'

const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-frequency-controls-browser'
await mkdir(artifacts, { recursive: true })
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
let browser, page
const errors = [], checks = [], exports = []
let result = 'saved', pendingVideo
const record = message => { checks.push(message); console.log('PASS', message) }
const fixture = name => fileURLToPath(new URL(`../fixtures/frequency/${name}.cjson`, import.meta.url))
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  page = await browser.newPage({ viewport: { width: 1280, height: 950 }, locale: 'en-US' })
  page.on('pageerror', error => errors.push(error.message))
  page.on('download', () => errors.push('Unexpected global browser download'))
  await page.addInitScript(() => {
    window.recordedSteps = []
    const capture = HTMLCanvasElement.prototype.captureStream
    HTMLCanvasElement.prototype.captureStream = function (...args) {
      const stream = capture.apply(this, args)
      for (const track of stream.getVideoTracks()) {
        const request = track.requestFrame?.bind(track)
        track.requestFrame = () => {
          window.recordedSteps.push({ step: Number(document.querySelector('dialog .step-input')?.value), positions: window.frequencyPositions?.() })
          request?.()
        }
      }
      return stream
    }
  })
  await page.route('**/api/workflows/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ format: 'multiwfn-workflows', version: 1, available: true, scripts: [], session: null, runner: 'unused', library: '/unused', results: '/unused', wavefunction: null, multiwfn: 'unused', catalogError: null, job: null }) }))
  await page.route('**/api/viewer-export?**', async route => {
    const request = route.request(), url = new URL(request.url()), bytes = request.postDataBuffer()
    assert.equal(url.searchParams.get('cap'), 'test-capability')
    assert.equal(url.searchParams.has('path'), false)
    exports.push({ filename: url.searchParams.get('filename'), mime: request.headers()['content-type'], bytes })
    if (request.headers()['content-type'] === 'video/webm') await new Promise(resolve => { pendingVideo = resolve })
    await route.fulfill({ status: result === 'failure' ? 500 : 200, contentType: 'application/json', body: JSON.stringify(result === 'failure' ? { message: 'native write failed' } : { status: result }) })
  })
  await page.goto(`http://127.0.0.1:${address.port}/?workbench=1&cap=test-capability`)
  await page.getByRole('button', { name: 'Vibrational modes', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Vibrational modes', exact: true })
  const file = dialog.getByLabel('Frequency file', { exact: true })
  await file.setInputFiles([{ name: 'water.cjson', mimeType: 'application/json', buffer: await readFile(fixture('gaussian16-water')) }, { name: 'bad.cjson', mimeType: 'application/json', buffer: Buffer.from('{}') }, { name: 'orca.cjson', mimeType: 'application/json', buffer: await readFile(fixture('orca42-dvb')) }])
  await dialog.locator('canvas').waitFor()
  const queue = dialog.getByRole('combobox', { name: 'Frequency files', exact: true })
  assert.deepEqual(await queue.locator('option').allTextContents(), ['1. water.cjson', '2. bad.cjson', '3. orca.cjson'])
  await dialog.getByRole('button', { name: 'Next frequency file', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  assert.equal(await dialog.locator('.filename').textContent(), 'water.cjson')
  assert.equal(await queue.inputValue(), '1')
  await dialog.getByRole('button', { name: 'Next frequency file', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('dialog .filename')?.textContent === 'orca.cjson')
  assert.equal(await dialog.getByRole('spinbutton', { name: 'Step input', exact: true }).inputValue(), '0')
  assert.equal(await dialog.locator('.play-button.playing').count(), 0)
  await queue.selectOption('0')
  await page.waitForFunction(() => document.querySelector('dialog .filename')?.textContent === 'water.cjson')
  record('Ordered queue, malformed middle item preserves identity, switching starts paused at equilibrium')

  const chunks = (await readdir(new URL('../../dist/assets/', import.meta.url))).filter(name => name.startsWith('structure-') && name.endsWith('.js'))
  await page.evaluate(async chunk => {
    const canvas = document.querySelector('dialog canvas'), module = await import(`/assets/${chunk}`)
    const registry = Object.values(module).find(value => (value instanceof Map || value instanceof WeakMap) && value.get(canvas)?.camera)
    window.frequencyScene = registry.get(canvas)
    window.frequencyPositions = () => {
      const positions = []
      window.frequencyScene.scene.traverse(object => { if (object.isInstancedMesh && object.geometry.type === 'SphereGeometry') for (let index = 0; index < object.count; index++) positions.push(...object.instanceMatrix.array.slice(index * 16 + 12, index * 16 + 15)) })
      return positions
    }
  }, chunks[0])
  const arrows = dialog.getByRole('checkbox', { name: 'Displacement arrows', exact: true })
  assert.equal(await arrows.isChecked(), false)
  const step = dialog.getByRole('spinbutton', { name: 'Step input', exact: true })
  await step.fill('12'); await arrows.check()
  await page.waitForTimeout(150)
  const countMeshes = () => page.evaluate(() => { let count = 0; window.frequencyScene.scene.traverse(object => { if (object.isMesh) count++ }); return count })
  const withArrows = await countMeshes()
  await arrows.uncheck(); await page.waitForTimeout(100)
  assert.ok(withArrows > await countMeshes())
  record('Initially-off displacement toggle controls native arrow meshes')

  await dialog.locator('.structure-export-toggle').click()
  // Deliberately do not wait for the requested frame to render before clicking.
  await dialog.getByRole('combobox', { name: 'Normal mode', exact: true }).selectOption('1')
  await dialog.getByRole('spinbutton', { name: 'Visual amplitude (Å)', exact: true }).fill('0.6')
  await dialog.getByRole('spinbutton', { name: 'Visual amplitude (Å)', exact: true }).press('Tab')
  await step.fill('36')
  const jsonSaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/viewer-export')
  await dialog.getByRole('button', { name: 'Download JSON', exact: true }).click()
  await jsonSaved
  await page.waitForFunction(() => !document.querySelector('dialog .step-input')?.disabled)
  const exported = JSON.parse(exports.at(-1).bytes.toString('utf8'))
  const source = JSON.parse(await readFile(fixture('gaussian16-water'), 'utf8'))
  const vectors = source.vibrations.displacement[1], extent = Math.max(...vectors.map(vector => Math.hypot(...vector)))
  exported.sites.forEach((site, atom) => site.xyz.forEach((coordinate, axis) => assert.ok(Math.abs(coordinate - (source.atoms.coords['3d'][atom * 3 + axis] - .6 * vectors[atom][axis] / extent)) < 1e-9)))
  record('Immediate structure export waits for the selected current mode, amplitude and lazy frame')

  const pngSaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/viewer-export')
  await dialog.getByRole('button', { name: 'Download PNG', exact: true }).click()
  await pngSaved
  await page.waitForFunction(() => !document.querySelector('dialog .step-input')?.disabled)
  const png = exports.at(-1)
  assert.equal(png.mime, 'image/png'); assert.deepEqual([...png.bytes.subarray(0,8)], [137,80,78,71,13,10,26,10])
  result = 'cancelled'
  await dialog.getByRole('button', { name: 'Download XYZ', exact: true }).click()
  await dialog.getByRole('status').filter({ hasText: 'Save cancelled' }).waitFor()
  result = 'failure'
  await dialog.getByRole('button', { name: 'Download XYZ', exact: true }).click()
  await dialog.getByRole('status').filter({ hasText: 'native write failed' }).waitFor()
  record('Native byte sink receives PNG; cancellation and write failure remain visible and never succeed')
  result = 'saved'
  await dialog.locator('.structure-export-toggle').click()
  await dialog.locator('.trajectory-export-toggle').click()
  assert.equal(await dialog.getByRole('button', { name: 'Download MP4', exact: true }).count(), 0)
  const supported = await page.evaluate(() => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9'))
  if (supported) {
    await dialog.locator('label').filter({ hasText: 'End Frame' }).locator('input[type=number]').fill('2')
    const before = await step.inputValue()
    const pose = () => page.evaluate(() => { const c = window.frequencyScene.camera; return [...c.position.toArray(), ...c.quaternion.toArray(), c.zoom] })
    const camera = await pose()
    await dialog.getByRole('button', { name: 'Download WebM', exact: true }).click()
    for (let attempt = 0; !pendingVideo && attempt < 1500; attempt++) await page.waitForTimeout(20)
    assert.ok(pendingVideo, 'recording must reach the bounded native save endpoint')
    assert.equal(await dialog.getByRole('button', { name: 'Download WebM', exact: true }).isDisabled(), true)
    const webm = exports.at(-1)
    assert.equal(webm.mime, 'video/webm'); assert.deepEqual([...webm.bytes.subarray(0,4)], [26,69,223,163])
    const captured = await page.evaluate(() => window.recordedSteps)
    assert.deepEqual(captured.map(frame => frame.step), [0,1,2])
    for (const frame of captured) {
      assert.equal(frame.positions.length, 9)
      frame.positions.forEach((coordinate, index) => {
        const atom = Math.floor(index / 3), axis = index % 3
        const expected = source.atoms.coords['3d'][index] + .6 * Math.sin(2 * Math.PI * frame.step / 48) * vectors[atom][axis] / extent
        assert.ok(Math.abs(coordinate - expected) < 1e-5, `captured geometry must match requested lazy frame ${frame.step}`)
      })
    }
    pendingVideo(); pendingVideo = null
    await page.waitForFunction(index => document.querySelector('dialog .step-input')?.value === index, before)
    assert.ok((await pose()).every((value,index) => Math.abs(value - camera[index]) < 1e-7))
    record('Actual WebM frame geometry captured in order; completion awaits native save and restores step/camera')
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Download WebM"]')?.disabled)
    await dialog.locator('.play-button').click()
    await dialog.getByRole('button', { name: 'Download WebM', exact: true }).click()
    for (let attempt = 0; !pendingVideo && attempt < 1500; attempt++) await page.waitForTimeout(20)
    assert.ok(pendingVideo)
    pendingVideo(); pendingVideo = null
    await dialog.locator('.play-button.playing').waitFor()
    await dialog.locator('.play-button').click()
    record('A previously playing trajectory resumes after export')
  } else {
    assert.equal(await dialog.getByRole('button', { name: 'Download WebM', exact: true }).isDisabled(), true)
    record('Unsupported WebM codec leaves recording disabled')
  }
  await page.screenshot({ path: `${artifacts}/controls.png` })
  assert.deepEqual(errors, [])
} finally {
  pendingVideo?.()
  await writeFile(`${artifacts}/verification.json`, JSON.stringify({ checks, errors, exports: exports.map(({ filename, mime, bytes }) => ({ filename, mime, size: bytes.length })) }, null, 2))
  await browser?.close(); await new Promise(resolve => server.httpServer.close(resolve))
}
