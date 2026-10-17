// Browser checks exercise the real workbench panel with a simulated native API.
// Process/DSL tests separately exercise the real Rust manager and C++ sidecar.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const artifacts = process.env.ARTIFACT_DIR || '/tmp/multiwfn-workflows-ui'
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en' })
let source = '# <img src=x onerror="window.injected=true">\n[grid]\n%process\nelectron grid ${grid:-1}\nend\n'
let status = {
  format: 'multiwfn-workflows', version: 1, available: true, runner: '/package/resources/tools/multiwfn-workflow',
  library: '/project/scripts', results: '/project/loaded molecule_workflows', wavefunction: '/project/loaded molecule.fchk', multiwfn: '/package/Multiwfn_MatterVizGUI',
  scripts: [{ id: 'density.bw', name: 'density.bw' }, { id: 'mayer.bwc', name: 'mayer.bwc' }], catalogError: null, job: null,
}
const calls = []
let resultsSelected = false
let startupSelections = 0
const reply = (route, value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
await page.route('**/session/manifest.json', (route) => reply(route, { format: 'multiwfn-matterviz-workbench', version: 2, structure: null, cubes: [] }))
await page.route('**/api/ready*', (route) => reply(route, { ok: true }))
await page.route('**/api/workflows/**', async (route) => {
  const request = route.request()
  const url = new URL(request.url())
  assert.equal(url.searchParams.get('cap'), 'test-capability')
  const action = url.pathname.split('/').at(-1)
  calls.push(action)
  if (action === 'preview') return reply(route, { id: url.searchParams.get('script'), source })
  if (action === 'inspect') return reply(route, {version: 1, runnable: true, fields: [{id: '0/0/grid', name: 'grid', label: 'Grid quality', group: 'grid / electron', type: 'select', value: request.postDataJSON().parameters?.['0/0/grid'] ?? '1', source: 'script', options: [{value: '1', label: 'Low'}, {value: '2', label: 'Medium'}, {value: '3', label: 'High'}]}], tasks: [{task: 0, module: 'grid', commands: '5\n1\n1\n2\n0\n5\n-10\nq\n'}], diagnostics: []})
  if (action === 'pick') {
    const { kind } = request.postDataJSON()
    assert.notEqual(kind, 'multiwfn', 'the panel must not request a different engine')
    if (kind === 'results') {
      resultsSelected = true
      status = { ...status, results: '/project/results' }
    } else if (kind === 'wavefunction') {
      const input = ++startupSelections === 1 ? '/project/input molecule.fchk' : '/project/second molecule.xyz'
      status = { ...status, wavefunction: input, results: resultsSelected ? status.results : input.replace(/\.[^.]+$/, '_workflows') }
    }
  }
  if (action === 'run') {
    const input = request.postDataJSON()
    assert.equal(input.cores, 2)
    assert.deepEqual(input.variables, ['grid=1'])
    status = { ...status, job: { directory: '/project/results/workflow-0001', state: input.dryRun ? 'prepared' : 'running', exitCode: input.dryRun ? 0 : null, message: '', log: input.dryRun ? 'Dry-run mode: Command file generated, skipping execution.' : 'Starting Multiwfn process...\n' + 'Multiwfn process output\n'.repeat(200), files: ['workflow.log', 'grid_input.txt'] } }
  }
  if (action === 'cancel') status = { ...status, job: { ...status.job, state: 'cancelled', exitCode: null } }
  return reply(route, status)
})
try {
  await page.goto(`${process.env.PREVIEW_URL || 'http://127.0.0.1:5205/'}?workbench=1&cap=test-capability`, { waitUntil: 'networkidle' })
  const panel = page.getByRole('main', { name: 'BaneWfn', exact: true })
  await panel.waitFor()
  const parametersTab = panel.getByRole('tab', { name: 'Parameters', exact: true })
  const previewTab = panel.getByRole('tab', { name: 'Script preview', exact: true })
  const resultsTab = panel.getByRole('tab', { name: 'Results', exact: true })
  assert.equal(await panel.getByRole('tab').count(), 3)
  assert.equal(await parametersTab.getAttribute('aria-selected'), 'true')
  await panel.getByRole('button', { name: 'Choose startup file', exact: true }).filter({ hasText: '/project/loaded molecule.fchk' }).waitFor()
  assert.ok((await panel.getByRole('button', { name: 'Choose results folder', exact: true }).textContent()).includes('/project/loaded molecule_workflows'))
  assert.equal(await panel.getByRole('button', { name: 'Choose Multiwfn', exact: true }).count(), 0)
  assert.equal(await panel.getByText('Wavefunction', { exact: true }).count(), 0)
  const initialBounds = await panel.boundingBox()
  const layoutBounds = await panel.locator('.workflow-layout').boundingBox()
  const libraryBounds = await panel.locator('.workflow-library').boundingBox()
  const executionBounds = await panel.locator('.workflow-execution').boundingBox()
  assert.ok(libraryBounds.x + libraryBounds.width <= executionBounds.x + 1, 'script library and execution controls occupy separate columns')
  assert.ok(Math.abs(libraryBounds.y - executionBounds.y) < 1, 'columns start at the same height')
  assert.ok(Math.abs(libraryBounds.width / layoutBounds.width - 0.3) < 0.01, 'script library occupies about 30% of the layout')
  assert.ok(await panel.evaluate((element) => element.scrollHeight <= element.clientHeight + 1), 'desktop panel fits without outer scrolling')
  await parametersTab.focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await previewTab.getAttribute('aria-selected'), 'true', 'tabs support keyboard navigation')
  await panel.locator('.workflow-source').filter({ hasText: 'electron grid' }).waitFor()
  const previewBounds = await panel.locator('.workflow-preview').boundingBox()
  assert.ok(previewBounds.x >= executionBounds.x, 'script preview is inside the right column')
  assert.equal(await panel.locator('img').count(), 0)
  assert.equal(await page.evaluate(() => window.injected), undefined)
  await page.keyboard.press('End')
  assert.equal(await resultsTab.getAttribute('aria-selected'), 'true')
  await panel.getByText('No runs yet', { exact: true }).waitFor()
  await page.keyboard.press('Home')
  assert.equal(await parametersTab.getAttribute('aria-selected'), 'true')
  source = await readFile(new URL('../../../workflows/scripts/density.bw', import.meta.url), 'utf8')
  await panel.getByRole('button', { name: 'Choose script folder', exact: true }).click()
  await panel.getByRole('button', { name: 'mayer.bwc BWC', exact: true }).click()
  assert.equal(await panel.getByRole('button', { name: 'mayer.bwc BWC', exact: true }).getAttribute('aria-pressed'), 'true')
  await panel.getByRole('button', { name: 'density.bw BW', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('Run workflow') && !button.disabled))
  await panel.getByRole('button', { name: 'Choose startup file', exact: true }).click()
  await panel.getByRole('button', { name: 'Choose results folder', exact: true }).filter({ hasText: '/project/input molecule_workflows' }).waitFor()
  assert.ok((await panel.getByRole('button', { name: 'Choose results folder', exact: true }).textContent()).includes('/project/input molecule_workflows'))
  await page.screenshot({ path: path.join(artifacts, 'workflows-autofill.png') })
  await panel.getByRole('button', { name: 'Choose results folder', exact: true }).click()
  await panel.getByRole('button', { name: 'Choose startup file', exact: true }).click()
  await panel.getByRole('button', { name: 'Choose startup file', exact: true }).filter({ hasText: '/project/second molecule.xyz' }).waitFor()
  assert.ok((await panel.getByRole('button', { name: 'Choose results folder', exact: true }).textContent()).includes('/project/results'), 'explicit result directory survives startup-file changes')
  await panel.getByLabel('CPU cores', { exact: true }).fill('2')
  await panel.getByText('Additional variables', { exact: true }).click()
  await panel.getByLabel('Variables', { exact: true }).fill('grid=1')
  await previewTab.click()
  await panel.locator('.workflow-source').filter({ hasText: 'Export an electron-density cube' }).waitFor()
  await page.screenshot({ path: path.join(artifacts, 'workflows-preview.png') })
  await resultsTab.click()
  await parametersTab.click()
  assert.equal(await panel.getByLabel('CPU cores', { exact: true }).inputValue(), '2')
  assert.equal(await panel.getByLabel('Variables', { exact: true }).inputValue(), 'grid=1', 'tab switches preserve parameters')
  await page.screenshot({ path: path.join(artifacts, 'workflows-ready.png') })
  await panel.getByRole('button', { name: 'Preflight', exact: true }).click()
  await panel.getByText('prepared', { exact: true }).waitFor()
  assert.equal(await resultsTab.getAttribute('aria-selected'), 'true', 'preflight switches to the result page')
  assert.deepEqual(await panel.boundingBox(), initialBounds, 'job output keeps the desktop panel dimensions stable')
  await page.screenshot({ path: path.join(artifacts, 'workflows-desktop.png') })
  await panel.getByRole('button', { name: 'Result files', exact: true }).click()
  await panel.getByText('grid_input.txt', { exact: true }).waitFor()
  await panel.getByText('/project/results/workflow-0001', { exact: true }).waitFor()
  await panel.getByRole('button', { name: 'Log', exact: true }).click()
  await previewTab.click()
  await panel.getByRole('button', { name: 'Run workflow', exact: true }).click()
  await panel.getByText('running', { exact: true }).waitFor()
  assert.equal(await resultsTab.getAttribute('aria-selected'), 'true', 'run controls work from the preview and show results')
  assert.ok(await panel.locator('.workflow-log').evaluate((element) => element.scrollHeight > element.clientHeight), 'long logs scroll inside the output area')
  assert.ok(await panel.evaluate((element) => element.scrollHeight <= element.clientHeight + 1), 'long logs do not expand the desktop panel')
  assert.equal(await panel.getByRole('button', { name: 'Preflight', exact: true }).isDisabled(), true)
  assert.equal(await panel.getByRole('button', { name: 'density.bw BW', exact: true }).isDisabled(), true)
  await parametersTab.click()
  assert.equal(await panel.getByLabel('CPU cores', { exact: true }).isDisabled(), true)
  await previewTab.click()
  await panel.getByRole('button', { name: 'Cancel workflow', exact: true }).click()
  await panel.getByText('cancelled', { exact: true }).waitFor()
  await resultsTab.click()
  await page.setViewportSize({ width: 1024, height: 768 })
  assert.ok(await panel.evaluate((element) => element.scrollHeight <= element.clientHeight + 1), 'laptop viewport fits without outer scrolling')
  await page.screenshot({ path: path.join(artifacts, 'workflows-laptop.png') })
  await page.keyboard.press('Escape')
  assert.ok(await panel.isVisible(), 'Escape keeps the independent workbench open')
  await panel.getByText('cancelled', { exact: true }).waitFor()
  await page.setViewportSize({ width: 400, height: 800 })
  assert.ok(await panel.evaluate((element) => element.getBoundingClientRect().width <= 400))
  assert.ok(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'narrow panel has no horizontal overflow')
  for (const tab of [parametersTab, resultsTab, previewTab]) {
    await tab.click()
    assert.ok(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'each narrow tab stays within the panel')
    assert.ok(await panel.getByRole('button', { name: 'Run workflow', exact: true }).isVisible())
  }
  await page.screenshot({ path: path.join(artifacts, 'workflows-narrow.png') })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1280, height: 900 })
  await panel.getByRole('button', { name: '中文', exact: true }).click()
  const chinesePanel = page.getByRole('main', { name: 'BaneWfn', exact: true })
  await chinesePanel.getByRole('tab', { name: '参数设置', exact: true }).click()
  await chinesePanel.getByText('启动文件', { exact: true }).waitFor()
  assert.equal(await chinesePanel.getByRole('button', { name: '选择 Multiwfn 程序', exact: true }).count(), 0)
  await page.screenshot({ path: path.join(artifacts, 'workflows-zh-parameters.png') })
  await chinesePanel.getByRole('tab', { name: '脚本预览', exact: true }).click()
  await page.screenshot({ path: path.join(artifacts, 'workflows-zh-preview.png') })
  await chinesePanel.getByRole('button', { name: '预检', exact: true }).click()
  await chinesePanel.getByText('预检完成', { exact: true }).waitFor()
  assert.equal(await chinesePanel.getByRole('tab', { name: '结果页', exact: true }).getAttribute('aria-selected'), 'true')
  await page.screenshot({ path: path.join(artifacts, 'workflows-zh.png') })
  assert.ok(calls.includes('preview') && calls.includes('pick') && calls.filter((action) => action === 'run').length === 3 && calls.includes('cancel'))
  console.log('PASS: startup-file label, loaded-input/result-directory prefill, automatic results after input selection, explicit result-directory preservation, no engine picker, 30/70 layout, three tabs, keyboard navigation, parameter persistence, shared actions, preflight/run/results, bounded logs, laptop/mobile layouts, safe text rendering, cancellation, independent window lifetime and Chinese controls')
} finally { await browser.close() }
