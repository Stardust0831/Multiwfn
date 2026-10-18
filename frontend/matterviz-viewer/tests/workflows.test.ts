import assert from 'node:assert/strict'
import { test } from 'node:test'
import { create_workflow_client, parse_workflow_status, workflow_active, workflow_variables } from '../src/workflows.ts'
import { documentation_text, esp_example } from '../src/workflow-builder.ts'

test('documentation selects the interface language and exposes the fallback language', () => {
  const text = { en: 'English', zh: '中文' }
  assert.deepEqual(documentation_text(text, 'zh'), { text: '中文', language: 'zh' })
  assert.deepEqual(documentation_text(text, 'en'), { text: 'English', language: 'en' })
  assert.deepEqual(documentation_text({ zh: '中文' }, 'en'), { text: '中文', language: 'zh' })
  assert.deepEqual(documentation_text({ und: 'Raw comments', zh: '中文' }, 'en'), { text: 'Raw comments', language: 'und' })
  assert.equal(documentation_text(undefined, 'zh').text, '')
})

const status = {
  format: 'multiwfn-workflows', version: 1, available: true,
  runner: '/runner', library: '/scripts', results: '/results', wavefunction: null, multiwfn: '/Multiwfn',
  scripts: [{ id: 'density.bw', name: 'density.bw' }], catalogError: null, job: null,
}

test('builder sends ordered drafts and handles Save dialog cancellation without selecting a script', async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = []
  let saved = false
  const client = create_workflow_client(new URL('http://localhost:4321/?cap=secret'), async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => url.pathname.endsWith('builder-catalog') ? {version:2, modules:[]} : url.pathname.endsWith('builder-save') ? {saved, status} : {source:'BWC', inspection:{}} }
  })
  await client.builderCatalog()
  const draft = esp_example()
  assert.equal((await client.builderPreview(draft)).source, 'BWC')
  assert.equal(await client.builderSave(draft), null)
  saved = true
  assert.deepEqual(await client.builderSave(draft), status)
  assert.equal(calls[0].init?.method, undefined)
  for (const call of calls.slice(1)) {
    assert.equal(call.url.searchParams.get('cap'), 'secret')
    assert.equal(call.init?.method, 'POST')
    assert.deepEqual(JSON.parse(call.init?.body as string), draft)
  }
  const analysis = draft.steps[0]
  assert.equal(analysis.kind, 'analysis')
  if (analysis.kind === 'analysis') {
    assert.deepEqual(analysis.processes.map(step => step.section), ['electron', 'esp'])
    assert.deepEqual(analysis.commands[1], {kind:'rename', source:'totesp.cub', target:'${input}_kcal_esp.cub'})
  }
})

test('workflow request keeps capability, variables and script as structured values', async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = []
  const client = create_workflow_client(new URL('http://127.0.0.1:4321/index.html?cap=secret'), async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => status }
  })
  await client.run({ script: 'a #;.bwc', cores: 2, variables: ['grid=(1 2)'], dryRun: true })
  assert.equal(calls[0].url.searchParams.get('cap'), 'secret')
  assert.equal(calls[0].init?.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init?.body as string), { script: 'a #;.bwc', cores: 2, variables: ['grid=(1 2)'], dryRun: true })
})

test('workflow preview checks identity and leaves code text intact', async () => {
  let identity = 'folder/test.bwc'
  const client = create_workflow_client(new URL('http://localhost/'), async (url) => {
    assert.equal(url.searchParams.get('script'), 'folder/test.bwc')
    return { ok: true, status: 200, json: async () => ({ id: identity, source: '%raw\n<script>\nend' }) }
  })
  assert.equal(await client.preview(identity), '%raw\n<script>\nend')
  identity = 'another.bw'
  await assert.rejects(client.preview('folder/test.bwc'), /Invalid workflow preview/)
})

test('opening results sends the current job and exact filename without treating it as a URL', async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = []
  const client = create_workflow_client(new URL('http://localhost:4321/?cap=secret'), async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ opened: true }) }
  })
  const directory = 'D:\\分析\\苯 workflows\\run'
  const file = 'ESP/报告 #&;.txt'
  await client.openPath(directory, file)
  await client.openPath(directory)
  assert.deepEqual(calls.map(call => JSON.parse(call.init!.body as string)), [{ directory, file }, { directory }])
  for (const { url, init } of calls) {
    assert.equal(url.pathname, '/api/workflows/open-path')
    assert.equal(url.searchParams.get('cap'), 'secret')
    assert.equal(init?.method, 'POST')
  }
})

test('workflow errors remain visible and malformed statuses are rejected', async () => {
  const client = create_workflow_client(new URL('http://localhost/'), async () => ({ ok: false, status: 400, json: async () => ({ message: 'Choose a results folder' }) }))
  await assert.rejects(client.status(), /Choose a results folder/)
  assert.throws(() => parse_workflow_status({ ...status, job: { state: 'success' } }), /Invalid workflow job/)
  assert.throws(() => parse_workflow_status({ ...status, version: 2 }), /Invalid workflow status/)
  assert.equal(workflow_active({ state: 'cancelling' } as never), true)
  assert.equal(workflow_active(null), false)
})

test('workflow variables preserve arrays and reject malformed lines', () => {
  assert.deepEqual(workflow_variables('grid=(1 2)\r\n\n label=hello world '), ['grid=(1 2)', 'label=hello world'])
  assert.throws(() => workflow_variables('grid'), /key=value/)
  assert.throws(() => workflow_variables('grid=\0'), /key=value/)
})
