// Exercise the production workbench, the upstream finish selector and the real PNG download.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { chromiumOptions } from './chromium-options.mjs'

const server = process.env.PREVIEW_URL ? undefined : await preview({ preview: { port: 0, host: '127.0.0.1' } })
const base = process.env.PREVIEW_URL ?? server.resolvedUrls.local[0]
const browser = await chromium.launch(chromiumOptions)
const finishes = ['satin', 'translucent_shell', 'chalk', 'unlit']
const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-scene-export-browser'
await mkdir(artifacts, { recursive: true })
const verification = { status: 'failed', browserVersion: browser.version(), cases: [] }

// A signed p-like orbital and two independent scalar fields on the same finite grid.
function cube(role) {
  const axis = 23, data = []
  for (let i = 0; i < axis; i++) for (let j = 0; j < axis; j++) for (let k = 0; k < axis; k++) {
    const [x, y, z] = [i, j, k].map(n => (n - 11) / 5)
    const rho = Math.exp(-x*x - y*y - z*z)
    data.push(role === 'potential' ? x : role === 'orbital' ? x*rho : rho)
  }
  return ['Multiwfn', role, '2 -2.2 -2.2 -2.2', '-23 0.2 0 0', '-23 0 0.2 0', '-23 0 0 0.2',
    '6 0 -0.8 0 0', '8 0 0.8 0 0', data.join(' ')].join('\n')
}

try {
  // Keep the synthetic ESP case narrow for responsive coverage. Real reference
  // sessions use the desktop canvas so the whole molecular surface is visible.
  for (const [mode, width] of [['orbital', 1080], ['esp', process.env.ESP_PREVIEW_URL ? 1080 : 390]]) {
    const page = await browser.newPage({ viewport: { width, height: 720 }, locale: 'en-US' })
    try {
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      const entries = mode === 'orbital'
        ? [{ path: 'orbital.cube', role: 'orbital', mode: 'signed', isovalue: .15, opacity: 1 }]
        : [{ path: 'density.cube', name: 'Density', analysisKind: 'esp-density', isovalue: .15,
            colorMapping: { path: 'potential.cube', range: [-1, 1], stops: [
              { position: 0, color: '#ff0000' }, { position: .5, color: '#ffffff' }, { position: 1, color: '#0000ff' }] } },
          { path: 'potential.cube', name: 'Potential', analysisKind: 'esp-potential', visible: false }]
      const url = new URL((mode === 'orbital' ? process.env.ORBITAL_PREVIEW_URL : process.env.ESP_PREVIEW_URL) ?? base)
      const fixture = !url.searchParams.has('manifest')
      const result = { mode, fixture, url: url.href, viewport: { width, height: 720 }, images: [], errors }
      verification.cases.push(result)
      if (fixture) {
        url.searchParams.set('manifest', '/test-session/manifest.json')
        await page.route('**/test-session/*', route => {
          const filename = new URL(route.request().url()).pathname.split('/').pop()
          if (filename === 'manifest.json') return route.fulfill({ json: { cubes: entries } })
          return route.fulfill({ contentType: 'text/plain', body: cube(filename.split('.')[0]) })
        })
      }
      await page.goto(url.href)
      const controls = page.getByRole('button', { name: 'Structure controls', exact: true })
      await controls.click()
      const finish = page.locator('select').filter({ has: page.locator('option[value="translucent_shell"]') }).filter({ visible: true })
      await finish.waitFor()
      assert.deepEqual(await finish.locator('option').evaluateAll(options => options.map(o => o.value)), finishes)
      if (mode === 'orbital') {
        // Upstream renders translucent, uniformly colored satin lobes with the shell shader.
        const opacity = page.getByRole('slider', { name: 'Opacity', exact: true }).first()
        await opacity.press('End')
        assert.equal(Number(await opacity.inputValue()), 1)
      }
      if (!fixture && mode === 'esp') {
        // Upstream initially fits the atoms; the density surface extends beyond
        // them. Use its normal zoom interaction to frame the reference export.
        const bounds = await page.locator('.scene-viewport canvas').boundingBox()
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        for (let step = 0; step < 3; step++) {
          await page.mouse.wheel(0, 500)
          await page.waitForTimeout(200)
        }
        await page.mouse.move(5, 5)
        await page.waitForTimeout(1500)
        result.cameraAdjustment = 'Three native wheel zoom-out events of 500 before all four exports'
      }
      // Reopen controls between downloads because the native pane dismisses on outside clicks.
      const images = []
      for (const value of finishes) {
        if (!await finish.isVisible()) await controls.click()
        await finish.selectOption(value)
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        const pending = page.waitForEvent('download')
        await page.getByRole('button', { name: 'PNG image', exact: true }).click()
        const download = await pending
        assert.equal(await download.failure(), null)
        const filename = `${mode}-${value}.png`
        await download.saveAs(`${artifacts}/${filename}`)
        const png = await readFile(`${artifacts}/${filename}`)
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
        const pixels = await page.evaluate(async base64 => {
          const image = new Image()
          image.src = 'data:image/png;base64,' + base64
          await image.decode()
          const c = document.createElement('canvas')
          c.width = c.height = 128
          const ctx = c.getContext('2d')
          ctx.drawImage(image, 0, 0, 128, 128)
          return Array.from(ctx.getImageData(0, 0, 128, 128).data)
        }, png.toString('base64'))
        assert.ok(pixels.filter((v, i) => i % 4 !== 3 && v < 220).length > 120, 'molecule appears in PNG')
        result.images.push({ finish: value, filename, bytes: png.length,
          width: png.readUInt32BE(16), height: png.readUInt32BE(20),
          sha256: createHash('sha256').update(png).digest('hex') })
        images.push(pixels)
      }
      for (let i = 0; i < images.length; i++) for (let j = 0; j < i; j++) {
        assert.ok(images[i].some((v,k) => Math.abs(v - images[j][k]) > 4), finishes[i] + ' should differ from ' + finishes[j])
      }
      if (mode === 'esp') {
        if (!await finish.isVisible()) await controls.click()
        const removeDensity = page.getByRole('button', { name: /^Remove volume .*density$/i })
        const restoreLabel = (await removeDensity.getAttribute('aria-label')).replace(/^Remove/, 'Restore')
        await removeDensity.click()
        await page.locator('.statusbar').getByText('1 volume(s)', { exact: true }).waitFor()
        await page.getByRole('button', { name: restoreLabel, exact: true }).click()
        await page.locator('.statusbar').getByText('2 volume(s)', { exact: true }).waitFor()
        await page.getByRole('button', { name: 'Tools', exact: true }).click()
        await page.getByRole('button', { name: 'Approx. ESP extrema', exact: true }).click()
        await page.locator('.esp-extrema-list').waitFor()
        result.volumeRecovery = true
      }
      const toolbar = page.locator('.toolbar')
      await toolbar.getByRole('button', { name: '切换到中文', exact: true }).click()
      assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN')
      await toolbar.getByRole('button', { name: 'Switch to English', exact: true }).click()
      assert.equal(await page.locator('html').getAttribute('lang'), 'en')
      assert.deepEqual(errors, [])
      console.log(mode + ': four native finishes rendered and exported at ' + width + 'px')
    } catch (error) {
      await page.screenshot({ path: `${artifacts}/${mode}-failure.png` }).catch(() => {})
      await writeFile(`${artifacts}/${mode}-failure.txt`, await page.locator('body').ariaSnapshot().catch(() => ''))
      throw error
    } finally { await page.close() }
  }
  verification.status = 'passed'
} catch (error) {
  verification.error = String(error)
  throw error
} finally {
  await writeFile(`${artifacts}/verification.json`, JSON.stringify(verification, null, 2))
  await browser.close()
  if (server) await server.close()
}
