// Pixel-level acceptance of actual scene downloads, including translucent Reps.
// Start preview:session first; Playwright is supplied by the developer environment.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const preview = process.env.PREVIEW_URL || 'http://127.0.0.1:5297/?manifest=/session/surface-manifest.json'
const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-scene-export'
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US', acceptDownloads: true })
const errors = [], checks = []
page.on('pageerror', error => errors.push(String(error)))
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
const button = name => page.getByRole('button', { name, exact: true })
const record = message => { checks.push(message); console.log('PASS', message) }
const state = () => page.evaluate(() => {
  const { camera, scene } = window.exportTestScene
  const canvas = document.querySelector('.structure canvas')
  const materials = []
  scene.traverse(object => {
    if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.push([material.uuid, material.opacity, material.transparent])
    }
  })
  return { position: camera.position.toArray(), rotation: camera.quaternion.toArray(), zoom: camera.zoom,
    width: canvas.width, height: canvas.height, ratio: window.exportTestRenderer.getPixelRatio(),
    background: getComputedStyle(canvas.closest('.structure')).getPropertyValue('--struct-bg-override'),
    materials, sameCanvas: canvas === window.exportTestCanvas }
})
const pixels = async file => page.evaluate(async data => {
  const image = new Image()
  image.src = `data:image/png;base64,${data}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
  const corner = Array.from(rgba.slice(0, 4))
  let transparent = 0, partial = 0, opaque = 0, foreground = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) transparent++
    else if (rgba[i + 3] === 255) opaque++
    else partial++
    if (rgba[i + 3] > 0 && (rgba[i] !== corner[0] || rgba[i + 1] !== corner[1] || rgba[i + 2] !== corner[2])) foreground++
  }
  return { width: image.width, height: image.height, corner, transparent, partial, opaque, foreground }
}, (await readFile(file)).toString('base64'))
const save = async (name, transparent, zh = false) => {
  const before = await state()
  await button(zh ? '保存' : 'Save').click()
  const checkbox = page.getByRole('checkbox', { name: zh ? '透明背景' : 'Transparent background', exact: true })
  if (transparent === undefined) assert.equal(await checkbox.isChecked(), false, 'opaque background is the default')
  else await checkbox.setChecked(transparent)
  const download = page.waitForEvent('download')
  await button(zh ? 'PNG 图像' : 'PNG image').click()
  const file = path.join(artifacts, `${name}.png`)
  await (await download).saveAs(file)
  await page.getByRole('dialog', { name: zh ? '保存选项' : 'Save controls', exact: true }).waitFor({ state: 'hidden' })
  await page.waitForFunction(() => !document.querySelector('.return')?.disabled)
  assert.deepEqual(await state(), before, 'export preserves camera, background, materials and canvas size')
  const stats = await pixels(file)
  assert.ok(stats.foreground > 1000, 'download contains the rendered model')
  return stats
}
try {
  await page.goto(preview, { waitUntil: 'networkidle', timeout: 180000 })
  await page.locator('.rep-row').first().waitFor()
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(url => /\/matterviz\.js/.test(url))
    const mv = await import(url)
    const canvas = document.querySelector('.structure canvas')
    window.exportTestScene = mv.scene_registry.get(canvas)
    window.exportTestRenderer = mv.renderer_registry.get(canvas)
    window.exportTestCanvas = canvas
  })
  await page.waitForFunction(() => window.exportTestScene.scene.getObjectByName('rep-copies-volume-1')?.children[0]?.children.length > 0)
  const white = await save('white')
  assert.deepEqual(white.corner, [255, 255, 255, 255])
  assert.equal(white.transparent + white.partial, 0)
  record('Default PNG has an opaque white background and visible structure/surface')

  const transparent = await save('transparent', true)
  assert.equal(transparent.corner[3], 0)
  assert.ok(transparent.transparent > 1000 && transparent.partial > 1000)
  assert.equal(transparent.width, white.width); assert.equal(transparent.height, white.height)
  record('Transparent PNG has empty alpha outside the model and partial alpha on translucent surfaces')

  await button('Scene').click()
  await page.getByLabel('Background', { exact: true }).fill('#64a0d0')
  await page.getByRole('spinbutton', { name: 'Background opacity', exact: true }).fill('0.35')
  const colored = await save('colored', false)
  assert.deepEqual(colored.corner, [100, 160, 208, 255])
  assert.equal(colored.transparent + colored.partial, 0)
  record('Opaque export uses the chosen background color even with translucent on-screen background')

  await button('切换到中文').click()
  const chinese = await save('transparent-zh', true, true)
  assert.equal(chinese.corner[3], 0)
  await button('保存').click()
  assert.equal(await page.getByRole('checkbox', { name: '透明背景', exact: true }).isChecked(), true)
  await page.screenshot({ path: path.join(artifacts, 'save-menu-zh.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await button('工具').click(); await button('编辑原子和键…').click()
  await page.locator('.rep-edit-banner').waitFor()
  await button('返回表示层').click()
  assert.equal(await page.locator('.tool-rail').getByRole('button', { name: '编辑', exact: true }).count(), 0)
  record('Chinese export option works, selection persists and source editing remains available in Tools')
  assert.deepEqual(errors, [])
  await writeFile(path.join(artifacts, 'verification.json'), JSON.stringify({ preview, checks, white, transparent, colored, chinese, errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  console.error({ checks, errors })
  throw error
} finally { await browser.close() }
