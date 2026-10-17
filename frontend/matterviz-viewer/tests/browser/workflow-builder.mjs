import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: {width: 1440, height: 950}, locale: 'zh-CN' })
page.setDefaultTimeout(15000)
const artifacts = process.env.ARTIFACT_DIR || '/tmp/banewfn-builder-ui'
await mkdir(artifacts, {recursive:true})
const errors = []
page.on('pageerror', error => errors.push(error.message))
const status = {format:'multiwfn-workflows', version:1, available:true, runner:'runner', library:'scripts', results:null, wavefunction:null, multiwfn:'engine', scripts:[], selectedScript:null, catalogError:null, job:null}
let lastDraft, saves = 0, runs = 0
const field = (id, group, value) => ({id, name:'grid', group, label:'Grid quality', labels:{zh:'网格精度', en:'Grid quality'}, type:'select', value, expression:value, source:'placeholder', options:['1','2','3'].map((value, index) => ({value,label:['Low','Medium','High'][index],labels:{zh:['低精度','中等精度','高精度'][index],en:['Low','Medium','High'][index]}}))})
const inspection = draft => ({version:1, runnable:true, diagnostics:[], tasks: draft.steps.flatMap((step, index) => step.kind === 'analysis' ? [{task:index, module:step.module, commands:'5\n1\n3\n12\n1\nq\n'}] : []), fields:draft.steps.flatMap((step, index) => step.kind === 'analysis' ? step.processes.map((process, position) => field(`${index}/${position}/grid`,`${index+1} · ${step.module} / ${process.section} [${position}]`, process.parameters.grid ?? (process.section === 'esp' ? '1':'3'))) : [])})
const source = draft => draft.steps.map(step => step.kind === 'analysis' ? `[${step.module}]\n%process\n${step.processes.map(p => p.section + (p.parameters.grid ? ` grid ${p.parameters.grid}` : '')).join('\n')}\n` + (step.commands.length ? '%command\n#!/bin/bash\n' + step.commands.map(c => c.kind === 'rename' ? `mv -- "${c.source}" "${c.target}"` : c.text).join('\n') + '\n' : '') + 'end\n' : step.kind === 'collect' ? `collect(${step.target});\n` : step.kind === 'rebase' ? `wfn_rebase=${step.target}\n` : `%command\n${step.text}\nend\n`).join('\n')
await page.route('**/api/workflows/**', async route => {
  const request = route.request(), url = new URL(request.url()), action = url.pathname.split('/').at(-1)
  assert.equal(url.searchParams.get('cap'),'builder-cap')
  let value = status
  if (action === 'builder-catalog') value = {version:1,modules:[{name:'grid',sections:['main','wfn2','electron','esp'].map(name => ({name, notes:name === 'esp' ? 'ESP 必须最后执行' : ''}))},{name:'edaff',sections:[{name:'main',notes:''}]}]}
  if (action === 'builder-preview') {
    lastDraft = request.postDataJSON()
    value = {source:source(lastDraft),inspection:inspection(lastDraft)}
  }
  if (action === 'builder-save') {
    saves++
    lastDraft = request.postDataJSON()
    if (saves === 1) value = {saved:false}
    else {status.scripts = [{id:'my workflow.bwc',name:'my workflow.bwc'}];status.selectedScript = 'my workflow.bwc';value = {saved:true,status}}
  }
  if (action === 'preview') value = {id:'my workflow.bwc',source:source(lastDraft)}
  if (action === 'inspect') value = inspection(lastDraft)
  if (action === 'run') runs++
  await route.fulfill({contentType:'application/json',body:JSON.stringify(value)})
})
try {
  await page.goto(`${process.env.PREVIEW_URL || 'http://127.0.0.1:5301/'}?workbench=1&cap=builder-cap`)
  const entry = page.getByRole('button',{name:'生成脚本',exact:true})
  await entry.click()
  let modal = page.getByRole('dialog',{name:'脚本构造',exact:true})
  await modal.getByRole('combobox',{name:'分析模块'}).selectOption('grid')
  await modal.getByRole('checkbox',{name:/^electron ·/}).check()
  await modal.getByRole('checkbox',{name:/^esp ·/}).check()
  await modal.getByRole('button',{name:'添加分析块',exact:true}).click()
  await modal.getByLabel('网格精度',{exact:true}).first().waitFor()
  assert.deepEqual(lastDraft.steps[0].processes.map(p => p.section),['electron','esp'])
  await modal.getByLabel('网格精度',{exact:true}).first().selectOption('2')
  await page.waitForFunction(() => document.querySelector('dialog pre')?.textContent.includes('electron grid 2'))
  await modal.getByRole('button',{name:'重命名产物',exact:true}).click()
  await modal.getByLabel('原文件名',{exact:true}).fill('totesp.cub')
  await modal.getByLabel('新文件名',{exact:true}).fill('${input}_kcal_esp.cub')
  await page.waitForFunction(() => document.querySelector('dialog pre')?.textContent.includes('"${input}_kcal_esp.cub"'))
  await modal.getByRole('button',{name:'切换启动文件',exact:true}).click()
  await modal.getByLabel('后续启动文件模板',{exact:true}).fill('${input}_NTO${state}.fch')
  await modal.getByRole('button',{name:'恢复原启动文件',exact:true}).click()
  await modal.getByRole('button',{name:'收集产物',exact:true}).click()
  await modal.getByLabel('收集目录模板',{exact:true}).fill('${input}_ESP')
  await modal.getByRole('button',{name:'上移步骤',exact:true}).nth(2).click()
  await page.waitForFunction(() => document.querySelector('dialog pre')?.textContent.includes('collect(${input}_ESP);\n\nwfn_rebase='))
  assert.deepEqual(lastDraft.steps.map(s => s.kind),['analysis','collect','rebase'])
  await modal.getByRole('button',{name:'下移步骤',exact:true}).nth(1).click()
  await modal.getByRole('button',{name:/^1\s*grid$/}).click()
  await modal.getByRole('button',{name:'上移处理段',exact:true}).nth(1).click()
  await page.waitForFunction(() => document.querySelector('dialog pre')?.textContent.includes('esp\nelectron grid 2'))
  assert.equal(lastDraft.steps[0].processes[1].parameters.grid,'2')
  await modal.getByRole('button',{name:'下移处理段',exact:true}).first().click()
  await modal.getByRole('button',{name:'Conf 说明',exact:true}).click()
  await modal.getByText('ESP 必须最后执行',{exact:true}).waitFor()
  await modal.getByText('BaneWfn 解析通过',{exact:true}).waitFor()
  await page.screenshot({path:`${artifacts}/builder-zh.png`})
  for (const width of [900,1200,1440]) {
    await page.setViewportSize({width,height:900})
    const bounds = await modal.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width+1,JSON.stringify(bounds))
    assert.equal(await modal.evaluate(node => node.scrollWidth > node.clientWidth),false)
  }
  await modal.getByRole('button',{name:'关闭脚本构造',exact:true}).click()
  await page.getByRole('button',{name:'English',exact:true}).click()
  await page.getByRole('button',{name:'Generate script',exact:true}).click()
  modal = page.getByRole('dialog',{name:'Script builder',exact:true})
  await modal.getByRole('button',{name:'Density + ESP example',exact:true}).click()
  await modal.getByLabel('Grid quality',{exact:true}).first().waitFor()
  assert.equal(await modal.getByLabel('Grid quality',{exact:true}).first().locator('option:checked').innerText(),'High')
  await modal.getByRole('combobox',{name:'Builder preview content'}).selectOption({label:'Multiwfn input'})
  await modal.locator('pre').getByText('5',{exact:false}).waitFor()
  await page.screenshot({path:`${artifacts}/builder-en.png`})
  await modal.getByRole('button',{name:'Save and load',exact:true}).click()
  await modal.getByRole('button',{name:'Save and load',exact:true}).waitFor()
  assert.equal(await modal.count(),1,'cancelled native Save keeps draft open')
  await modal.getByRole('button',{name:'Save and load',exact:true}).click()
  await page.waitForFunction(() => document.querySelector('.workflow-script.selected')?.title === 'my workflow.bwc')
  assert.equal(await page.getByRole('dialog').count(),0)
  assert.equal(runs,0,'saving never starts a calculation')
  await page.getByRole('button',{name:'Generate script',exact:true}).click()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(),0)
  assert.equal(await page.getByRole('button',{name:'Generate script',exact:true}).evaluate(node => node === document.activeElement),true)
  assert.deepEqual(errors,[])
  console.log('PASS: builder conf selection, scoped controls, ordered glue/sections, bilingual modal, native preview, Save cancellation and load without execution')
} catch (error) { await page.screenshot({path:`${artifacts}/failure.png`}); throw error }
finally { await browser.close() }
