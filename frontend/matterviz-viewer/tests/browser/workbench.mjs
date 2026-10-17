import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({viewport: {width: 1200, height: 820}, locale: 'zh-CN'})
const artifacts = process.env.ARTIFACT_DIR || '/tmp/banewfn-workbench-ui'
await mkdir(artifacts, {recursive: true})
const errors = []
page.on('pageerror', error => errors.push(error.message))
let sent
let rendered
const openedPaths = []
let inspections = 0
const status = {format: 'multiwfn-workflows', version: 1, available: true, session: null, runner: 'runner', library: '\\\\?\\C:\\BaneWfn\\scripts', results: '\\\\?\\D:\\分析\\苯_workflows', wavefunction: '\\\\?\\D:\\分析\\苯.fch', multiwfn: 'engine', scripts: [{id: 'density.bw', name: 'density.bw'}], catalogError: null, job: null}
status.scripts.unshift({id: 'aaa.bw', name: 'aaa.bw'})
status.selectedScript = 'density.bw'
await page.route('**/api/workflows/**', async route => {
  const request = route.request(), url = new URL(request.url())
  assert.equal(url.searchParams.get('cap'), 'test-capability')
  const action = url.pathname.split('/').at(-1)
  let value = status
  if (action === 'trace') value = {available:false,steps:[],groups:[],truncated:false}
  if (action === 'preview') value = {id: url.searchParams.get('script'), source: '[grid]\n%process\nelectron\nspin\nend\n'}
  if (action === 'pick') {
    assert.equal(request.postDataJSON().kind, 'script')
    status.scripts = [{id: 'chosen.bwc', name: 'chosen.bwc'}]
    status.selectedScript = 'chosen.bwc'
  }
  if (action === 'inspect') {
    inspections++
    const params = request.postDataJSON().parameters
    value = {version: 1, runnable: true, fields: [0, 1].map(i => ({id: `0/${i}/grid`, name: 'grid', label: 'Grid', labels: {zh: i ? '自旋网格' : '网格精度', en: i ? 'Spin grid' : 'Grid quality'}, group: i ? '1 · grid / spin [1]' : '1 · grid / electron [0]', type: 'select', value: params[`0/${i}/grid`] ?? (i ? '2' : '3'), source: 'placeholder', helps: {zh: '控制生成网格的精细程度', en: 'Controls grid resolution'}, options: ['1', '2', '3'].map((value, index) => ({value, label: value, labels: {zh: ['低精度', '中等精度', '高精度'][index], en: ['Low', 'Medium', 'High'][index]}}))})), tasks: [{task: 0, module: 'grid', commands: `5\n${params['0/0/grid'] ?? '3'}\n2\nq\n`}], diagnostics: []}
  }
  if (action === 'run') {
    sent = request.postDataJSON()
    status.job = {state: 'completed', directory: 'D:\\分析\\苯_workflows\\run', exitCode: 0, message: '', log: 'Analysis completed', files: ['ESP/benzene_den.cub', 'ESP/benzene_esp.cub', 'ESP/benzene_kcal_esp.cub', '分析 report.txt'], cubes: [
      {file: 'ESP/benzene_den.cub', kind: 'density', unit: null, orbital: null},
      {file: 'ESP/benzene_esp.cub', kind: 'esp', unit: null, unitDeclared: false, orbital: null, density: 'ESP/benzene_den.cub'},
      {file: 'ESP/benzene_kcal_esp.cub', kind: 'esp', unit: 'kcal/mol', unitDeclared: true, orbital: null, density: 'ESP/benzene_den.cub'},
    ]}
  }
  if (action === 'open-result') { rendered = request.postDataJSON(); value = {opened: true} }
  if (action === 'open-path') { openedPaths.push(request.postDataJSON()); value = {opened: true} }
  await route.fulfill({contentType: 'application/json', body: JSON.stringify(value)})
})
try {
  await page.goto(`${process.env.PREVIEW_URL || 'http://127.0.0.1:5205/'}?workbench=1&cap=test-capability`)
  const panel = page.getByRole('main', {name: 'BaneWfn', exact: true})
  await panel.getByLabel('网格精度', {exact:true}).waitFor()
  assert.equal(await panel.locator('.workflow-script.selected').getAttribute('title'), 'density.bw')
  assert.ok(await panel.locator('img.workflow-mark').evaluate(img => img.complete && img.naturalWidth > 0), 'BaneWfn icon must load')
  for (const width of [900, 1200, 1920]) {
    await page.setViewportSize({width, height: 820})
    const bounds = await panel.boundingBox()
    assert.ok(bounds && bounds.x === 0 && bounds.y === 0 && Math.abs(bounds.width - width) <= 1 && Math.abs(bounds.height - 820) <= 1,
      `Workbench must fill the viewport: ${JSON.stringify(bounds)}`)
  }
  await page.setViewportSize({width: 1200, height: 820})
  assert.equal(await panel.getByRole('tab').count(), 3)
  assert.equal(await page.locator('canvas').count(), 0)
  assert.equal(await panel.getByLabel('网格精度', {exact:true}).inputValue(), '3')
  assert.equal(await panel.getByLabel('自旋网格', {exact:true}).inputValue(), '2')
  assert.ok(!(await panel.innerText()).includes('\\\\?\\'))
  const left = await panel.locator('.workflow-library').boundingBox(), full = await panel.locator('.workflow-layout').boundingBox()
  assert.ok(Math.abs(left.width / full.width - .3) < .01)
  await panel.getByLabel('网格精度', {exact:true}).selectOption('1')
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('运行工作流') && !b.disabled))
  assert.equal(await panel.getByLabel('自旋网格', {exact:true}).inputValue(), '2')
  await page.screenshot({path: `${artifacts}/banewfn-parameters.png`})
  await panel.getByRole('button', {name: 'English', exact:true}).click()
  assert.equal(await panel.getByLabel('Grid quality', {exact:true}).inputValue(), '1')
  assert.equal(await panel.getByLabel('Spin grid', {exact:true}).inputValue(), '2')
  assert.equal(await panel.getByLabel('Grid quality', {exact:true}).locator('option:checked').innerText(), 'Low')
  assert.equal(await panel.locator('label[for="parameter-0/0/grid"]').getAttribute('title'), 'Controls grid resolution')
  await page.screenshot({path: `${artifacts}/banewfn-parameters-en.png`})
  await panel.getByRole('button', {name: '中文', exact:true}).click()
  assert.equal(await panel.getByLabel('网格精度', {exact:true}).inputValue(), '1')
  assert.equal(await panel.getByLabel('网格精度', {exact:true}).locator('option:checked').innerText(), '低精度')
  await panel.getByRole('tab', {name: '脚本预览', exact:true}).click()
  await panel.getByLabel('预览内容').selectOption({label:'Multiwfn 输入'})
  assert.ok((await panel.locator('.workflow-source').innerText()).includes('5\n1\n2\nq'))
  await panel.getByRole('button', {name: '运行工作流', exact:true}).click()
  await panel.getByText('Analysis completed', {exact:true}).waitFor()
  assert.deepEqual(sent.parameters, {'0/0/grid': '1'})
  assert.ok(inspections >= 2)
  await panel.getByRole('button', {name: '结果文件', exact:true}).click()
  assert.equal(await panel.getByRole('button', {name: /^打开文件：/}).count(), status.job.files.length)
  await panel.getByRole('button', {name: '打开目录', exact:true}).click()
  await page.waitForFunction(() => !document.querySelector('button[aria-label="打开文件：分析 report.txt"]')?.disabled)
  await panel.getByRole('button', {name: '打开文件：分析 report.txt', exact:true}).click()
  await page.waitForFunction(() => !document.querySelector('button[aria-label="打开文件：ESP/benzene_den.cub"]')?.disabled)
  await panel.getByRole('button', {name: '打开文件：ESP/benzene_den.cub', exact:true}).click()
  await page.waitForTimeout(100)
  assert.deepEqual(openedPaths, [
    {directory: status.job.directory},
    {directory: status.job.directory, file: '分析 report.txt'},
    {directory: status.job.directory, file: 'ESP/benzene_den.cub'},
  ])
  const legacy = panel.locator('li').filter({hasText: 'ESP/benzene_esp.cub'})
  assert.equal(await legacy.getByRole('button', {name: '渲染', exact:true}).isEnabled(), false)
  await legacy.getByRole('combobox').selectOption('kcal/mol')
  await legacy.getByRole('button', {name: '渲染', exact:true}).click()
  await page.waitForTimeout(100)
  assert.deepEqual(rendered, {directory: status.job.directory, file: 'ESP/benzene_esp.cub', unit: 'kcal/mol'})
  await panel.getByRole('button', {name: 'English', exact:true}).click()
  assert.equal(await panel.getByRole('button', {name: 'Open folder', exact:true}).count(), 1)
  assert.equal(await panel.getByRole('button', {name: 'Open file: 分析 report.txt', exact:true}).innerText(), 'Open')
  assert.ok((await legacy.innerText()).includes('Electrostatic potential'))
  assert.equal(await legacy.getByRole('combobox').inputValue(), 'kcal/mol')
  const declared = panel.locator('li').filter({hasText: 'ESP/benzene_kcal_esp.cub'})
  assert.equal(await declared.getByRole('combobox').count(), 0)
  await declared.getByRole('button', {name: 'Render', exact:true}).click()
  await page.waitForTimeout(100)
  assert.equal(rendered.file, 'ESP/benzene_kcal_esp.cub')
  await panel.getByLabel('Select result: ESP/benzene_den.cub', {exact:true}).check()
  await panel.getByLabel('Select result: ESP/benzene_esp.cub', {exact:true}).check()
  await panel.getByRole('button', {name: 'Render selected', exact:true}).click()
  await page.waitForTimeout(100)
  assert.deepEqual(rendered.files, ['ESP/benzene_den.cub', 'ESP/benzene_esp.cub'])
  assert.equal(rendered.units['ESP/benzene_esp.cub'], 'kcal/mol')
  await panel.getByRole('button', {name: '中文', exact:true}).click()
  await panel.getByRole('button', {name: '一键渲染', exact:true}).click()
  await page.waitForTimeout(100)
  assert.deepEqual(rendered.files, status.job.cubes.map(cube => cube.file))
  assert.equal(await panel.getByLabel('全选 Cube 文件', {exact:true}).isChecked(), true)
  await panel.getByLabel('全选 Cube 文件', {exact:true}).uncheck()
  assert.equal(await panel.getByRole('button', {name:'渲染所选', exact:true}).isEnabled(), false)
  assert.deepEqual(errors, [])
  await page.screenshot({path: `${artifacts}/banewfn-results.png`})
  await panel.getByRole('button', {name:'打开工作流脚本', exact:true}).click()
  await page.waitForFunction(() => document.querySelector('.workflow-script.selected')?.title === 'chosen.bwc')
  assert.equal(await panel.getByRole('tab', {name:'参数设置', exact:true}).getAttribute('aria-selected'), 'true')
  console.log('PASS: independent window, bilingual labels/help/options, preserved selections, 30/70 layout, native preview and explicit overrides')
} finally { await browser.close() }
