import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { preview } from 'vite'
import { chromium } from 'playwright'
import { quality_fixture } from '../fixtures/volume-quality.mjs'

const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-volume-quality-browser'
await mkdir(artifacts, { recursive: true })
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const { port } = server.httpServer.address()
const fixture = quality_fixture([102, 104, 106]) // 1,124,448 samples, both signs, skew cell.
const chunks = (await readdir(new URL('../../dist/assets/', import.meta.url))).filter(name => /^structure-.*\.js$/.test(name))
assert.equal(chunks.length, 1)
let browser, page
let budget = 192 * 1024 ** 2
const errors = [], checks = [], snapshots = []
const record = message => { checks.push(message); console.log('PASS', message) }
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' })
  page.on('pageerror', error => errors.push(String(error)))
  await page.route('**/api/ready?**', route => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }))
  await page.route('**/api/geometry-budget?**', route => {
    const url = new URL(route.request().url())
    assert.equal(url.searchParams.get('cap'), 'test')
    assert.ok(Number(url.searchParams.get('source_bytes')) >= fixture.volume.grid.data.byteLength)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ geometry_budget_bytes: budget }) })
  })
  await page.route(url => url.pathname.startsWith('/session/'), route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('manifest.json')) {
      const native = path.includes('native')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        structure: { path: 'molecule.xyz' }, layers: [{ path: native ? 'field.bin' : 'field.cub', name: 'Signed field',
          format: native ? 'mwfn-volume-v2' : 'cube', mode: 'signed', isovalue: 0.03, opacity: 1 }],
      }) })
    }
    if (path.endsWith('molecule.xyz')) return route.fulfill({ body: '1\nFixture\nH 4.5 1.5 3.5\n' })
    if (path.endsWith('field.cub')) return route.fulfill({ body: fixture.cube })
    if (path.endsWith('field.bin')) return route.fulfill({ contentType: 'application/vnd.multiwfn.volume',
      headers: { 'Content-Length': String(fixture.binary.length), 'X-MatterViz-Geometry-Memory-Budget': String(budget) }, body: Buffer.from(fixture.binary) })
    return route.fulfill({ status: 404, body: 'Not found' })
  })
  const open = async (native, hosted = true) => {
    await page.goto(`http://127.0.0.1:${port}/?manifest=/session/${native ? 'native-' : ''}manifest.json${hosted ? '&cap=test' : ''}`)
    await page.locator('.structure canvas').waitFor({ timeout: 60000 })
    await page.evaluate(async chunk => {
      const module = await import(`/assets/${chunk}`)
      const canvas = document.querySelector('.structure canvas')
      const registry = Object.values(module).find(value => (value instanceof Map || value instanceof WeakMap) && value.get(canvas)?.camera)
      window.qualityScene = registry.get(canvas)
      window.qualityMesh = () => {
        const meshes = []
        window.qualityScene.scene.updateMatrixWorld(true)
        window.qualityScene.scene.traverse(object => {
          if (!object.name.startsWith('rep-copies-')) return
          object.traverseVisible(mesh => {
            if (!mesh.isMesh) return
            const positions = mesh.geometry.getAttribute('position').array
            mesh.geometry.computeBoundingBox()
            const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)
            // All vertices contribute to the checksum, not just counts/bounds.
            let sum = 0, weighted = 0
            positions.forEach((value, idx) => { sum += value; weighted += value * ((idx % 101) + 1) })
            meshes.push({ vertices: positions.length / 3, triangles: mesh.geometry.index.count / 3,
              bounds: [...box.min.toArray(), ...box.max.toArray()], sum, weighted })
          })
        })
        return meshes
      }
      window.qualityCaptures = []
      const original = canvas.toBlob.bind(canvas)
      canvas.toBlob = (...args) => { window.qualityCaptures.push({ meshes: window.qualityMesh(), width: canvas.width, height: canvas.height }); return original(...args) }
    }, chunks[0])
    await page.waitForFunction(() => window.qualityMesh().length === 2, { timeout: 60000 })
    await page.waitForFunction(() => document.querySelector('.volume-quality')?.textContent.includes('102 × 104 × 106 → 102 × 104 × 106'))
    await page.getByRole('button', { name: 'Scene', exact: true }).click()
    await page.getByRole('button', { name: 'Fit all visible Reps', exact: true }).click()
    await page.getByRole('button', { name: 'Representations', exact: true }).click()
    return page.evaluate(() => window.qualityMesh())
  }
  const fileMesh = await open(false)
  assert.equal(fileMesh.length, 2)
  snapshots.push({ route: 'Cube', meshes: fileMesh })
  const nativeMesh = await open(true)
  assert.deepEqual(nativeMesh, fileMesh)
  record('Production Cube and binary loaders produce identical full-grid ±0.03 meshes and placement above one million samples')
  assert.deepEqual(await open(false, false), fileMesh)
  record('Standalone browser admission retains the same original-grid geometry without a native budget header')
  // Ordinary Cube arrays use actual transferable workers; native input uses SAB here.
  await open(false)
  const sampling = page.getByRole('combobox', { name: 'Surface sampling', exact: true })
  await sampling.selectOption('preview')
  await page.waitForFunction(full => {
    const meshes = window.qualityMesh()
    return meshes.length === 2 && meshes[0].triangles < full[0].triangles && !document.querySelector('.volume-quality')?.textContent.includes('Preparing surfaces')
  }, fileMesh)
  assert.match(await page.locator('.volume-quality').innerText(), /Preview may reduce detail/)
  const save = async name => {
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const download = page.waitForEvent('download', { timeout: 60000 })
    await page.getByRole('button', { name: 'PNG image', exact: true }).click()
    const path = `${artifacts}/${name}.png`
    await (await download).saveAs(path)
    const capture = await page.evaluate(() => window.qualityCaptures.at(-1))
    assert.deepEqual(capture.meshes, fileMesh, 'export must wait for the source mesh, including borrowed Rep copies')
    const png = await readFile(path)
    assert.equal(png.readUInt32BE(16), capture.width); assert.equal(png.readUInt32BE(20), capture.height)
    const pixels = await page.evaluate(async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
      let red = 0, blue = 0, background = 0
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i] > rgba[i + 2] * 1.3 && rgba[i] > rgba[i + 1] * 1.3) red++
        if (rgba[i + 2] > rgba[i] * 1.3 && rgba[i + 2] > rgba[i + 1] * 1.2) blue++
        if (rgba[i] > 240 && rgba[i + 1] > 240 && rgba[i + 2] > 240) background++
      }
      return { red, blue, background, total: rgba.length / 4 }
    }, png.toString('base64'))
    assert.ok(pixels.red > 100 && pixels.blue > 100 && pixels.background > pixels.total / 10, 'saved PNG contains both signed surfaces and the background')
    snapshots.push({ export: name, ...capture, pixels })
    return capture
  }
  const first = await save('source-from-preview-1200')
  assert.equal(await sampling.inputValue(), 'preview')
  await page.setViewportSize({ width: 900, height: 650 })
  const second = await save('source-from-preview-900')
  assert.notEqual(second.width, first.width)
  record('Both PNG sizes rebuild source geometry from preview and restore the display choice after saving')
  let downloads = 0
  page.on('download', () => downloads++)
  budget = 1
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'PNG image', exact: true }).click()
  await page.waitForFunction(() => /budget|requires/.test(document.querySelector('.volume-quality')?.textContent || ''))
  await page.waitForFunction(() => !document.querySelector('[aria-label="Surface sampling"]').disabled)
  assert.equal(downloads, 0)
  budget = 192 * 1024 ** 2
  await save('source-after-rejection')
  assert.equal(downloads, 1)
  record('Insufficient resources refuse PNG without fallback; the retained Cube source supports a successful retry')
  await sampling.selectOption('source')
  await page.waitForFunction(full => JSON.stringify(window.qualityMesh()) === JSON.stringify(full), fileMesh)
  await page.locator('.rep-select').nth(1).click()
  await page.getByRole('button', { name: 'Duplicate Rep', exact: true }).click()
  await page.waitForFunction(() => window.qualityMesh().length === 4)
  const duplicated = await page.evaluate(() => window.qualityMesh())
  assert.deepEqual(duplicated, [...fileMesh, ...fileMesh])
  record('Two visible Reps sharing an immutable source each complete both signed surfaces')
  await page.waitForFunction(() => !document.querySelector('.volume-quality')?.textContent.includes('Preparing surfaces'))
  await page.screenshot({ path: `${artifacts}/source-grid.png` })
  assert.deepEqual(errors, [])
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {})
    await writeFile(`${artifacts}/failure.txt`, await page.locator('body').innerText().catch(() => ''))
  }
  throw error
} finally {
  await writeFile(`${artifacts}/results.json`, JSON.stringify({ checks, errors, snapshots }, null, 2))
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
