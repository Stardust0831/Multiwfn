// Browser acceptance for the actual workbench, using a real molecule manifest.
// Start the preview first; Playwright is supplied by the developer environment.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const preview = process.env.PREVIEW_URL || 'http://127.0.0.1:5197/'
const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-workbench-ui'
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const checks = []
const record = (message) => { checks.push(message); console.log('PASS', message) }
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true, locale: 'en-US' })
page.on('pageerror', (error) => errors.push(String(error)))
const button = (name) => page.getByRole('button', { name, exact: true })
const choose = async (label, name) => {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option', { name, exact: true }).click()
  await page.getByRole('listbox').waitFor({ state: 'hidden' })
  await page.waitForFunction(({ label, name }) => [...document.querySelectorAll('[data-slot=select-trigger]')].some((e) => e.getAttribute('aria-label') === label && e.textContent.includes(name)), { label, name })
}
const checkCanvas = async () => {
  assert.equal(await page.locator('canvas').count(), 1)
  assert.equal(await page.evaluate(() => document.querySelector('canvas') === window.workbenchTestCanvas), true)
}
try {
  await page.goto(preview, { waitUntil: 'networkidle', timeout: 120000 })
  await page.locator('canvas').waitFor()
  await button('Tools').click(); await button('Edit atoms and bonds...').click()
  await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('2 volume'))
  await page.evaluate(() => { window.workbenchTestCanvas = document.querySelector('canvas') })
  const layout = await page.locator('.inspector-content').evaluate((e) => {
    const pane = e.closest('aside').getBoundingClientRect(); const content = e.getBoundingClientRect()
    return { fits: content.right <= pane.right + 1 && content.left >= pane.left, width: content.width }
  })
  assert.equal(layout.fits, true)
  assert.ok(layout.width > 250)
  assert.ok(await page.locator('[data-slot="slider-track"]').first().evaluate((e) => e.getBoundingClientRect().height > 0))
  record('Real molecule, one canvas, readable inspector and visible slider tracks')

  for (const name of ['View', 'Tools', 'Save']) {
    await button(name).click()
    await page.getByRole('dialog', { name: `${name} controls` }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: `${name} controls` }).waitFor({ state: 'hidden' })
    assert.equal(await button(name).evaluate((e) => document.activeElement === e), true)
  }
  await button('View').focus()
  await page.keyboard.press('Enter')
  await page.getByRole('spinbutton', { name: 'Rotation step', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await button('View').click()
  await button('Save').click()
  await page.getByRole('dialog', { name: 'View controls' }).waitFor({ state: 'hidden' })
  await page.locator('.brand').click()
  await page.getByRole('dialog', { name: 'Save controls' }).waitFor({ state: 'hidden' })
  record('Menus: keyboard open, Escape, focus return, outside click and switching')

  const tab = page.getByRole('tab', { name: 'Structure', exact: true })
  await tab.focus(); await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: 'Surfaces', exact: true }).getAttribute('aria-selected'), 'true')
  await page.keyboard.press('ArrowLeft')
  assert.equal(await tab.getAttribute('aria-selected'), 'true')
  const ambient = page.getByRole('slider', { name: 'Ambient light', exact: true })
  await ambient.focus(); await page.keyboard.press('ArrowRight')
  assert.equal(Number(await ambient.getAttribute('aria-valuenow')), 0.73)
  await choose('Scene appearance preset', 'Studio lighting')
  assert.equal(Number(await ambient.getAttribute('aria-valuenow')), 1.25)
  assert.equal(Number(await page.getByRole('slider', { name: 'Fill light', exact: true }).getAttribute('aria-valuenow')), .85)
  await choose('Scene appearance preset', 'Standard lighting')
  assert.equal(Number(await page.getByRole('slider', { name: 'Fill light', exact: true }).getAttribute('aria-valuenow')), .38)
  assert.equal(Number(await page.getByRole('slider', { name: 'Rim light', exact: true }).getAttribute('aria-valuenow')), .24)
  await choose('Scene appearance preset', 'Studio lighting')
  await choose('Atom material preset', 'Metallic')
  await checkCanvas()
  record('Keyboard tabs and sliders; Studio/standard switches all four lights; atom finish')

  await button('Save').click()
  const downloadEvent = page.waitForEvent('download')
  await button('Save display settings').click()
  const download = await downloadEvent
  const settingsPath = path.join(artifacts, 'display-settings.json')
  await download.saveAs(settingsPath)
  const saved = JSON.parse(await readFile(settingsPath, 'utf8'))
  assert.equal(saved.structureAppearance.lightingRig, 'tmim')
  assert.equal(saved.structureAppearance.fillLight, .85)
  assert.equal(saved.structureAppearance.atomStyle, 'metallic')
  await choose('Scene appearance preset', 'Standard lighting')
  await choose('Atom material preset', 'Matte')
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(settingsPath)
  await page.waitForFunction(() => document.querySelector('[aria-label="Scene appearance preset"]')?.textContent?.includes('Studio lighting'))
  assert.match(await page.getByRole('button', { name: 'Atom material preset', exact: true }).innerText(), /Metallic/)
  await checkCanvas()
  record('Display settings download and restore lighting and atom finish on the same canvas')

  await choose('Atom material preset', 'Balanced')
  await page.locator('.inspector-content').evaluate((e) => e.scrollTop = 0)
  await page.screenshot({ path: path.join(artifacts, 'molecule.png') })
  await page.getByRole('tab', { name: 'Surfaces', exact: true }).click()
  await choose('Original surface material preset', 'BrushedMetal')
  assert.match(await page.getByRole('button', { name: 'Original surface material preset', exact: true }).innerText(), /BrushedMetal/)
  await button('Soft gloss').click()
  assert.equal(await button('Soft gloss').getAttribute('aria-pressed'), 'true')
  await page.locator('.inspector-tab-bar').getByRole('button', { name: 'Open volume layers (2)', exact: true }).click()
  await page.locator('.layer-panel').waitFor()
  await page.locator('.layer-panel .layer-heading input[type="checkbox"]').first().check()
  await page.locator('.layer-panel').getByRole('button', { name: 'Close', exact: true }).click()
  await checkCanvas()
  await page.screenshot({ path: path.join(artifacts, 'surface.png') })
  record('Original surface presets, smooth finish and volume visibility controls')

  await button('Tools').click()
  const disabled = page.getByRole('dialog', { name: 'Tools controls' }).getByRole('button', { name: 'ESP surface', exact: true })
  assert.equal(await disabled.isDisabled(), true)
  const info = page.getByRole('button', { name: 'No ESP calculation is available in this session', exact: true })
  for (let step = 0; step < 20 && !(await info.evaluate((e) => document.activeElement === e)); step++) await page.keyboard.press('Tab')
  assert.equal(await info.evaluate((e) => document.activeElement === e), true)
  await page.getByRole('tooltip', { name: 'No ESP calculation is available in this session', exact: true }).waitFor()
  await page.screenshot({ path: path.join(artifacts, 'tools.png') })
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  record('Unavailable backend actions remain disabled with a keyboard accessible reason')

  await page.setViewportSize({ width: 600, height: 820 })
  await button('Tools').click(); await button('Edit atoms and bonds...').click()
  await page.getByRole('dialog', { name: 'Tools controls', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('tab', { name: 'Structure', exact: true }).evaluate((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }), true)
  await page.screenshot({ path: path.join(artifacts, 'narrow.png') })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.locator('.inspector-header').getByRole('button', { name: 'Close inspector', exact: true }).click()
  await page.screenshot({ path: path.join(artifacts, 'narrow-canvas.png') })
  await button('View').click()
  await page.waitForFunction(() => { const r = document.querySelector('#workbench-menu-view')?.getBoundingClientRect(); return r && r.x >= 0 && r.right <= innerWidth })
  const bounds = await page.getByRole('dialog', { name: 'View controls' }).boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 601)
  await page.keyboard.press('Escape')
  await checkCanvas()
  record('600 px layout: no page overflow, collapsible inspector and viewport-bounded menu')
  assert.deepEqual(errors, [])
  await writeFile(path.join(artifacts, 'verification.json'), JSON.stringify({ preview, checks, errors }, null, 2))
  console.log(JSON.stringify({ checks, errors, artifacts }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  console.error({ checks, errors })
  throw error
} finally {
  await browser.close()
}
