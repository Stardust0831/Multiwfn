// Real StructureScene/Three/Threlte regression. Requires a Playwright installation.
// Run from this viewer with: node tests/browser/topology-picking.mjs
// Optional overrides: PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM_EXECUTABLE,
// MULTIWFN_VIEWER_ROOT, MATTERVIZ_PACKAGE_ROOT, KEEP_BROWSER_FIXTURE=1.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const viewer = path.resolve(process.env.MULTIWFN_VIEWER_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)))
const require = createRequire(path.join(viewer, 'package.json'))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { svelte } = await import(pathToFileURL(require.resolve('@sveltejs/vite-plugin-svelte')).href)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href
  : pathToFileURL(require.resolve('playwright')).href)
const installed = fs.realpathSync(path.join(viewer, 'node_modules/matterviz'))
const metadata = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'))
const packageSource = path.resolve(process.env.MATTERVIZ_PACKAGE_ROOT ?? installed)
let server
let browser
const evidence = []
const errors = []
const warnings = []
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multiwfn-topology-picking-'))
const packageRoot = path.join(root, 'matterviz')
try {
  // Instrument an exact copy of the installed package without altering node_modules.
  // Keeping the fixture source outside node_modules also lets Vite discover and
  // prebundle transitive CommonJS dependencies such as Threlte's tweakpane import.
  fs.cpSync(path.join(packageSource, 'dist'), path.join(packageRoot, 'dist'), { recursive: true })
  fs.copyFileSync(path.join(packageSource, 'package.json'), path.join(packageRoot, 'package.json'))
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
  fs.writeFileSync(path.join(root, 'index.html'), '<link rel="icon" href="data:,"><div id="app"></div><script type="module" src="/main.js"></script>')
  fs.writeFileSync(path.join(root, 'main.js'), "import { mount } from 'svelte'; import App from './App.svelte'; mount(App, { target: document.getElementById('app') });")
  fs.copyFileSync(fileURLToPath(new URL('./TopologyPicking.svelte', import.meta.url)), path.join(root, 'App.svelte'))
  const dependencyNames = [...Object.keys(metadata.dependencies), 'svelte']
  for (const name of dependencyNames) {
    const destination = root + '/node_modules/' + name
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    if (!fs.existsSync(destination)) fs.symlinkSync(fs.realpathSync(name === 'svelte' ? viewer + '/node_modules/svelte' : path.dirname(installed) + '/' + name), destination, process.platform === 'win32' ? 'junction' : 'dir')
  }
  const aliases = []
  aliases.push({ find: 'fixture-matterviz', replacement: packageRoot + '/dist' })
  server = await createServer({
    configFile: false, root, cacheDir: root + '/.vite',
    plugins: [{ name: 'capture-real-interactivity', enforce: 'pre', transform(code, id) {
      if (!id.endsWith('/dist/structure/StructureScene.svelte')) return
      assert.ok(code.includes('import { T, useTask }'), 'StructureScene imports changed; update the test probe')
      assert.ok(code.includes('  extras.interactivity()'), 'StructureScene interactivity setup changed; update the test probe')
      return code.replace('import { T, useTask }', 'import { T, useTask, useThrelte }')
        .replace('  extras.interactivity()', '  window.__interactivity = extras.interactivity()\n  window.__threlte = useThrelte()\n  window.__project = (xyz) => { const p = new Vector3(...xyz).project(window.__threlte.camera.current); const rect = window.__threlte.canvas.getBoundingClientRect(); return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 } }')
    } }, svelte()],
    resolve: { alias: aliases, dedupe: dependencyNames },
    optimizeDeps: { exclude: ['fixture-matterviz'] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, viewer, packageRoot] }, watch: null, hmr: false },
  })
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address !== 'string')
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    // Existing Threlte passive pointer listeners warn when a context handler calls
    // preventDefault. Retain that baseline diagnostic separately from new failures.
    if (message.text().includes('Unable to preventDefault inside passive event listener invocation.')) {
      warnings.push(message.text())
      return
    }
    if (message.type() === 'error' || /THREE\.WebGLProgram|VALIDATE_STATUS|WebGL: INVALID/.test(message.text())) errors.push(message.text())
  })
  // A cold Svelte/Vite compile on a mounted filesystem can exceed Playwright's
  // 30-second navigation default.
  await page.goto(`http://127.0.0.1:${address.port}/`, { timeout: 120000 })
  await page.waitForFunction(() => window.__interactivity?.interactiveObjects.length > 0, undefined, { timeout: 60000 })
  // Allow the actual renderer and ResizeObserver to publish camera/viewport matrices.
  await page.waitForTimeout(500)
  const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const snapshot = async (label) => {
    const state = await page.evaluate(() => {
      const bondMeshes = []
      window.__threlte.scene.traverse((object) => {
        if (object.isInstancedMesh && object.geometry?.type === 'CylinderGeometry') {
          bondMeshes.push({ mesh: object.uuid, geometry: object.geometry.uuid })
        }
      })
      return {
        ...window.fixture.state(),
        objects: window.__interactivity.interactiveObjects.map((object) => ({
          id: object.uuid, instanced: Boolean(object.isInstancedMesh),
          geometry: object.geometry?.type, parentVisible: object.parent?.visible,
        })),
        bondMeshes: bondMeshes.sort((a, b) => a.mesh.localeCompare(b.mesh)),
        menuCount: document.querySelectorAll('.bond-context-menu').length,
      }
    })
    evidence.push({ label, ...state })
    return state
  }
  const cylinders = (state) => state.objects.filter((object) => object.geometry === 'CylinderGeometry')
  const clickWorld = async (xyz, button = 'right') => {
    const point = await page.evaluate((xyz) => window.__project(xyz), xyz)
    const target = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)
    assert.equal(target, 'CANVAS', `world click ${xyz} must reach canvas, got ${target}`)
    await page.mouse.click(point.x, point.y, { button })
    await settle()
  }
  const initial = await snapshot('ordinary-distance')
  assert.equal(cylinders(initial).length, 1)
  assert.equal(initial.bondMeshes.length, 2, 'bond body and outline must both be mounted')
  await clickWorld([0.35, 0, 0])
  const normal = await snapshot('ordinary-context-positive')
  assert.equal(normal.contexts.length, 1, 'visible bond context event must fire')
  await page.evaluate(() => window.fixture.topology(true))
  await settle()
  const hidden = await snapshot('topology-distance')
  assert.equal(cylinders(hidden).length, 0, 'hidden selected bond must leave the actual interactive registry')
  assert.deepEqual(hidden.bondMeshes, initial.bondMeshes, 'hiding topology bonds must retain meshes and geometries')
  await clickWorld([0.35, 0, 0])
  await clickWorld([-0.7, 0, 0])
  assert.equal((await snapshot('topology-context-blocked')).contexts.length, normal.contexts.length)

  await page.evaluate(() => { window.fixture.topology(false); window.fixture.mode('edit-bonds') })
  await settle()
  await clickWorld([0, 0, 0])
  assert.equal((await snapshot('ordinary-edit-menu-open')).menuCount, 1)
  await page.evaluate(() => window.fixture.topology(true))
  await settle()
  const hiddenMenu = await snapshot('topology-edit-menu-dismissed')
  assert.equal(hiddenMenu.menuCount, 0, 'already-open HTML menu must disappear')
  assert.equal(cylinders(hiddenMenu).length, 0, 'edit-bond cylinders must be unregistered')
  await clickWorld([0, 0, 0], 'left')
  assert.deepEqual((await snapshot('topology-no-hidden-delete')).removed, [])
  await page.evaluate(() => window.fixture.topology(false))
  await settle()
  const restored = await snapshot('ordinary-restored')
  assert.equal(restored.menuCount, 0, 'closed menu must not reappear when topology is disabled')
  assert.equal(cylinders(restored).length, 1, 'normal edit target must register again')
  assert.deepEqual(restored.bondMeshes, initial.bondMeshes)

  await page.evaluate(() => { window.fixture.topology(true); window.fixture.editMode('add'); window.fixture.measured([]) })
  await settle()
  await clickWorld([-0.7, 0, 0], 'left')
  assert.deepEqual((await snapshot('topology-edit-add-atom')).measured, [0])
  await page.evaluate(() => { window.fixture.mode('distance'); window.fixture.measured([]) })
  await settle()
  await clickWorld([-0.7, 0, 0], 'left')
  assert.deepEqual((await snapshot('topology-ordered-atom-measurement')).measured, [0])

  await page.evaluate(() => { window.fixture.partial(true); window.fixture.measured([]) })
  await settle()
  await clickWorld([-0.7, 0, 0], 'left')
  assert.deepEqual((await snapshot('topology-partial-atom-measurement')).measured, [0])
  await page.evaluate(() => { window.fixture.measured([0, 1]); window.fixture.labels(true) })
  await settle()
  const partialBefore = (await snapshot('topology-partial-context-before')).contexts.length
  await clickWorld([-0.7, 0, 0])
  await page.locator('.atom-label').first().click({ button: 'right' })
  assert.equal((await snapshot('topology-partial-and-label-context-blocked')).contexts.length, partialBefore)
  await page.evaluate(() => window.fixture.topology(false))
  await settle()
  await page.locator('.atom-label').first().click({ button: 'right' })
  assert.equal((await snapshot('ordinary-label-context-restored')).contexts.length, partialBefore + 1)

  await page.evaluate(() => { window.fixture.labels(false); window.fixture.atoms(false); window.fixture.measured([]) })
  await settle()
  const atomsHidden = await snapshot('ordinary-atoms-disabled')
  assert.equal(atomsHidden.objects.filter((object) => object.geometry === 'SphereGeometry').length, 0)
  await page.evaluate(() => window.fixture.topology(true))
  await settle()
  const forcedAtoms = await snapshot('topology-forces-atoms')
  assert.ok(forcedAtoms.objects.some((object) => object.geometry === 'SphereGeometry'))
  await clickWorld([-0.7, 0, 0], 'left')
  assert.deepEqual((await snapshot('topology-forced-atom-selection')).measured, [0])

  await page.evaluate(() => { window.fixture.topology(false); window.fixture.atoms(true); window.fixture.mode('edit-bonds'); window.fixture.editMode('delete') })
  await settle()
  await clickWorld([0, 0, 0], 'left')
  assert.equal((await snapshot('ordinary-delete-positive')).removed.length, 1, 'normal delete must remain functional')
  assert.deepEqual(errors, [], 'fixture must render without JavaScript or WebGL shader errors')
  console.log(JSON.stringify({ result: 'PASS', package: packageSource, checks: evidence.map(({ label }) => label) }, null, 2))
} finally {
  fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ errors, warnings, evidence }, null, 2))
  await browser?.close()
  await server?.close()
  if (process.env.KEEP_BROWSER_FIXTURE === '1') console.log(`Browser fixture and evidence: ${root}`)
  else fs.rmSync(root, { recursive: true, force: true })
}
