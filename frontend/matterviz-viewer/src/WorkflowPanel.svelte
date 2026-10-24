<script lang="ts">
  import { onDestroy, onMount, type Component } from 'svelte'
  import { FolderOpen, FileCode2, FileText, Play, Square, Check, Terminal, Cpu, SlidersHorizontal, FilePlus2 } from '@lucide/svelte'
  import WorkflowBuilder from './WorkflowBuilder.svelte'
  import WorkflowInputs from './WorkflowInputs.svelte'
  import WorkflowBatch from './WorkflowBatch.svelte'
  import WorkflowTrace from './WorkflowTrace.svelte'
  import { batch_active, type WorkflowScope, type BatchDetail } from './workflows'
  import banewfnIcon from '../../workflows/icons/banewfn.png'
  import * as Tabs from '$lib/components/ui/tabs'
  import { t, locale, set_locale } from './i18n'
  import { create_workflow_client, workflow_active, workflow_variables, workflow_cube_label, display_path, type WorkflowCube, type WorkflowStatus, type WorkflowSelection, type WorkflowInspection, type WorkflowField } from './workflows'

  const client = create_workflow_client()
  let status: WorkflowStatus | undefined
  let inputMode: 'single' | 'batch' = 'single'
  let inputModal = false
  let bindings: Record<string,string> = {}
  let previewInput = ''
  let batchScope: WorkflowScope | undefined
  let detail: BatchDetail | undefined
  let detailGeneration = 0
  $: job = status?.batch ? detail?.job ?? null : status?.job ?? null
  let selected = ''
  let source = ''
  let variables = ''
  let parameters: Record<string, string> = {}
  let inspection: WorkflowInspection | undefined
  let inspectBusy = false
  let inspectValid = false
  let inspectGeneration = 0
  let nativePreview = false
  let builderOpen = false
  let frequencyOpen = false
  let FrequencyViewer: Component<{ onclose: () => void }> | undefined
  const openFrequencies = async (): Promise<void> => {
    try {
      FrequencyViewer ??= (await import('./FrequencyViewer.svelte')).default
      if (!destroyed) frequencyOpen = true
    } catch (reason) { show_error(reason) }
  }
  const built = async (next: WorkflowStatus): Promise<void> => { builderOpen = false; apply(next); activeTab = 'settings'; await preview(next.selectedScript ?? '') }
  let inspectTimer: ReturnType<typeof setTimeout> | undefined
  const inspect = async (): Promise<void> => {
    const generation = ++inspectGeneration
    if (!selected) return
    inspectBusy = true
    inspectValid = false
    try {
      const vars = workflow_variables(variables)
      let current = { ...parameters }
      const wfn = inputMode === 'batch' ? previewInput || status?.inputSet?.files[0] : undefined
      if (wfn && Object.keys(bindings).length) {
        const planned = await client.batchPlan({script:selected,files:[wfn],parameters,bindings,variables:vars})
        const first = planned.inputs[0]
        if (!first || first.errors.length) throw new Error(first?.errors.join('\n') || $t('Choose at least one input file'))
        current = {...current,...first.bindings}
      }
      const next = await client.inspect(selected, current, vars, wfn)
      if (!destroyed && generation === inspectGeneration) { inspection = next; inspectValid = true; error = '' }
    } catch (reason) { if (generation === inspectGeneration) show_error(reason) }
    finally { if (generation === inspectGeneration) inspectBusy = false }
  }
  const change = (field: WorkflowField, value: string): void => {
    parameters = { ...parameters, [field.id]: value }
    inspectBusy = true; inspectGeneration++
    if (inspectTimer) clearTimeout(inspectTimer)
    inspectTimer = setTimeout(() => void inspect(), 300)
  }
  const reset = (field: WorkflowField): void => { const next = { ...parameters }; delete next[field.id]; parameters = next; void inspect() }
  const parameterPath = async (field: WorkflowField): Promise<void> => {
    try { const path = await client.parameterPath(field.type); if (path) change(field, display_path(path)) } catch (reason) { show_error(reason) }
  }
  let cores = 1
  let error = ''
  let busy = false
  let destroyed = false
  let previewGeneration = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let outputView: 'log' | 'files' = 'log'
  let activeTab = 'settings'
  let resultUnits: Record<string, string> = {}
  let selectedResults: string[] = []
  const openPath = async (file?: string): Promise<void> => {
    if (!job || busy) return
    busy = true; error = ''
    try { await client.openPath(job.directory, file, batchScope) }
    catch (reason) { show_error(reason) }
    finally { busy = false }
  }
  const selectResult = (file: string, checked: boolean): void => {
    selectedResults = checked ? [...selectedResults, file] : selectedResults.filter(value => value !== file)
  }
  const openResults = async (all = false): Promise<void> => {
    if (!job || busy || workflow_active(job)) return
    if (all) selectedResults = (job.cubes ?? []).map(cube => cube.file)
    if (!selectedResults.length) return
    error = ''
    const chosen = (job.cubes ?? []).filter(cube => selectedResults.includes(cube.file))
    for (const cube of chosen) {
      if (cube.kind !== 'esp') continue
      const message = !cube.density ? 'ESP needs one matching _den Cube in the same folder'
        : !(resultUnits[cube.file] || cube.unit) ? 'Choose the ESP data unit' : ''
      if (message) { error = `${cube.file}: ${$t(message)}`; return }
    }
    busy = true
    try {
      await client.openResults(job.directory, selectedResults, resultUnits, batchScope)
      apply(await client.status())
    } catch (reason) { show_error(reason) }
    finally { busy = false }
  }
  const openResult = async (cube: WorkflowCube): Promise<void> => {
    if (!job || busy) return
    busy = true; error = ''
    try {
      await client.openResult(job.directory, cube.file, resultUnits[cube.file] || cube.unit || undefined, batchScope)
      apply(await client.status())
    } catch (reason) { show_error(reason) }
    finally { busy = false }
  }

  const show_error = (reason: unknown): void => { if (!destroyed) error = reason instanceof Error ? reason.message : String(reason) }
  const preview = async (id: string): Promise<void> => {
    selected = id; source = ''; parameters = {}; bindings = {}; inspection = undefined; inspectGeneration++
    if (inspectTimer) clearTimeout(inspectTimer)
    const generation = ++previewGeneration
    if (!id) return
    try {
      const text = await client.preview(id)
      if (!destroyed && generation === previewGeneration) { source = text; await inspect() }
    } catch (reason) { if (generation === previewGeneration) show_error(reason) }
  }
  const apply = (next: WorkflowStatus): void => {
    if (destroyed) return
    if (!status && next.inputSet?.files.length) inputMode = 'batch'
    if (status?.batch?.id !== next.batch?.id || status?.batch?.directory !== next.batch?.directory) { batchScope = undefined; detail = undefined; detailGeneration++; selectedResults = []; resultUnits = {} }
    if (!next.batch) {
      if (status?.job?.directory !== next.job?.directory) { resultUnits = {}; selectedResults = [] }
      else selectedResults = selectedResults.filter(file => next.job?.cubes?.some(cube => cube.file === file))
    }
    status = next
    if (!next.scripts.some(script => script.id === selected)) void preview(next.selectedScript ?? next.scripts[0]?.id ?? '')
  }
  const loadDetail = async (scope: WorkflowScope): Promise<void> => {
    const generation = ++detailGeneration
    try {
      const next = await client.batchDetail(scope)
      if (destroyed || generation !== detailGeneration) return
      if (detail?.job.directory !== next.job.directory) { selectedResults = []; resultUnits = {} }
      else selectedResults = selectedResults.filter(file => next.job.cubes?.some(cube => cube.file === file))
      detail = next; batchScope = {...scope,attempt:next.item.attempt}
    } catch(reason) { if (!destroyed && generation === detailGeneration) show_error(reason) }
  }
  const viewItem = (item: string, attempt?: number): void => { if(status?.batch) void loadDetail({batch:status.batch.id,item,...(attempt?{attempt}:{})}) }
  const batchControl = async (action: string, item?: string): Promise<void> => {
    if(!status?.batch || busy) return
    busy = true; error = ''
    try { apply(await client.batchControl(status.batch.id,action,item)) } catch(reason) { show_error(reason) }
    finally { busy = false; schedule() }
  }
  const loadBatch = async (): Promise<void> => {
    busy = true; error = ''
    try { apply(await client.batchLoad()); activeTab = 'results' } catch(reason) { show_error(reason) }
    finally { busy = false; schedule() }
  }
  const selectedInputs = async (next: WorkflowStatus): Promise<void> => {
    inputModal = false; inputMode = 'batch'; previewInput = next.inputSet?.files[0] ?? ''
    apply(next); await inspect()
  }
  const bindingMode = (field: WorkflowField, matched: boolean): void => {
    const next = {...bindings}
    if (matched) next[field.id] = field.name === 'logfile' ? '${input}.log' : '${input}_' + field.name
    else delete next[field.id]
    bindings = next; void inspect()
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    if (!destroyed && (workflow_active(status?.job ?? null) || batch_active(status?.batch))) timer = setTimeout(() => void refresh(), 700)
  }
  const refresh = async (): Promise<void> => {
    try { apply(await client.status()); if(batchScope) await loadDetail(batchScope) } catch (reason) { show_error(reason) }
    schedule()
  }
  const pick = async (kind: WorkflowSelection): Promise<void> => {
    if (busy) return
    busy = true; error = ''
    try {
      const next = await client.pick(kind)
      if (next.selectionChanged === false) return
      apply(next)
      if (kind === 'library') await preview(status?.scripts[0]?.id ?? '')
      else if (kind === 'script') { activeTab = 'settings'; await preview(status?.selectedScript ?? selected) }
      else if (kind === 'wavefunction') await inspect()
    } catch (reason) { show_error(reason) }
    finally { busy = false; schedule() }
  }
  const run = async (dryRun: boolean): Promise<void> => {
    if (busy || workflow_active(job ?? null)) return
    busy = true; error = ''; outputView = 'log'
    try {
      const request = { script: selected, cores, variables: workflow_variables(variables), dryRun, parameters, ...(inputMode === 'batch' ? {bindings} : {}) }
      apply(inputMode === 'batch' ? await client.batchStart(request) : await client.run(request))
      activeTab = 'results'
    }
    catch (reason) { show_error(reason); await refresh() }
    finally { busy = false; schedule() }
  }
  const cancel = async (): Promise<void> => {
    busy = true; error = ''
    try { if(batch_active(status?.batch)) { apply(await client.batchControl(status!.batch!.id,'cancel')) } else apply(await client.cancel()) } catch (reason) { show_error(reason) }
    finally { busy = false; schedule() }
  }
  $: running = workflow_active(status?.job ?? null) || batch_active(status?.batch)
  $: jobRunning = workflow_active(job)
  $: canRun = status?.available && selected && status?.results && status?.multiwfn && inspection?.runnable && inspectValid && !inspectBusy && !running && !busy && (inputMode !== 'batch' || !!status?.inputSet?.files.length)
  $: previewText = nativePreview ? (inspection?.tasks ?? []).map(task => `# ${task.task + 1} · ${task.module || 'raw'}\n${task.commands}`).join('\n') : source
  $: sourceLines = previewText ? previewText.split('\n').map((_, index) => index + 1).join('\n') : ''
  $: groups = [...new Set((inspection?.fields ?? []).map(field => field.group))]
  onMount(() => { void refresh() })
  onDestroy(() => { destroyed = true; previewGeneration++; inspectGeneration++; if (timer) clearTimeout(timer); if (inspectTimer) clearTimeout(inspectTimer) })
</script>

  {#if inputModal}<WorkflowInputs initial={status?.inputSet ?? {files:[],roots:[]}} script={selected} {parameters} {bindings} variables={variables.split(/\r?\n/).map(s => s.trim()).filter(Boolean)} onclose={() => { inputModal = false }} onselected={next => void selectedInputs(next)} />{/if}
  {#if builderOpen}<WorkflowBuilder onclose={() => { builderOpen = false }} onsaved={next => void built(next)} />{/if}
  {#if frequencyOpen && FrequencyViewer}<svelte:component this={FrequencyViewer} onclose={() => { frequencyOpen = false }}/>{/if}
  <main class="workflow-panel" aria-labelledby="workflow-heading">
    <header class="workflow-header">
      <div class="workflow-title"><img class="workflow-mark" src={banewfnIcon} alt="" /><h2 id="workflow-heading">BaneWfn</h2></div>
      <button type="button" onclick={openFrequencies}>{$t('Vibrational modes')}</button>
      <button type="button" onclick={() => set_locale($locale === 'zh' ? 'en' : 'zh')}>{$locale === 'zh' ? 'English' : '中文'}</button>
    </header>
    {#if error}<p class="workflow-error workflow-banner" role="alert">{$t(error)}</p>{/if}
    {#if status?.available === false}<p class="workflow-error workflow-banner" role="alert">{$t('Install the optional workflow runner to use this panel.')}</p>{/if}
    {#if status?.available && !status.multiwfn}<p class="workflow-error workflow-banner" role="alert">{$t('The bundled Multiwfn executable could not be located.')}</p>{/if}
    <div class="workflow-layout">
      <section class="workflow-library" aria-labelledby="workflow-library-heading">
        <div class="workflow-field">
          <label for="workflow-startup">{$t('Startup file')}</label>
          <div class="input-mode" role="group" aria-label={$t('Input mode')}><button type="button" class:chosen={inputMode === 'single'} disabled={busy || running} onclick={() => { inputMode = 'single'; void inspect() }}>{$t('Single file')}</button><button type="button" class:chosen={inputMode === 'batch'} disabled={busy || running} onclick={() => { inputMode = 'batch'; if(!status?.inputSet?.files.length) inputModal = true; else void inspect() }}>{$t('Batch files')}</button></div>
          {#if inputMode === 'batch'}<button id="workflow-startup" class="workflow-picker" type="button" disabled={busy || running} onclick={() => { inputModal = true }}><span>{$t('{count} input files selected',{count:status?.inputSet?.files.length ?? 0})}</span><FolderOpen size={17}/></button>
          {:else}
          <button id="workflow-startup" class="workflow-picker" type="button" aria-label={$t('Choose startup file')} title={display_path(status?.wavefunction)} onclick={() => pick('wavefunction')} disabled={busy || running}><span>{display_path(status?.wavefunction) || $t('Choose startup file')}</span><FolderOpen size={17} /></button>
          {/if}
        </div>
        <div class="workflow-catalog">
          <div class="workflow-section-heading">
            <h3 id="workflow-library-heading">{$t('Scripts')} <span class="workflow-count">{status?.scripts.length ?? 0}</span></h3>
            <div class="workflow-library-actions">
            <button class="workflow-folder" type="button" aria-label={$t('Open workflow script')} title={$t('Open workflow script')} onclick={() => pick('script')} disabled={busy || running}><FileCode2 size={17} /></button>
            <button class="workflow-folder" type="button" aria-label={$t('Generate script')} title={$t('Generate script')} onclick={() => { builderOpen = true }} disabled={busy || running || !status?.available}><FilePlus2 size={17} /></button>
            <button class="workflow-folder" type="button" aria-label={$t('Choose script folder')} title={$t('Choose script folder')} onclick={() => pick('library')} disabled={busy || running}><FolderOpen size={17} /></button>
            </div>
          </div>
          <p class="workflow-library-path" title={display_path(status?.library)}>{display_path(status?.library) || '—'}</p>
          {#if status?.catalogError}<p class="workflow-error" role="alert">{status.catalogError}</p>{/if}
          <div class="workflow-script-list" role="group" aria-label={$t('Scripts')}>
            {#each status?.scripts ?? [] as script}
              <button class="workflow-script" class:selected={selected === script.id} type="button" aria-pressed={selected === script.id} title={script.id} disabled={busy || running} onclick={() => preview(script.id)}>
                <FileCode2 size={17} /><span>{script.id}</span><span class="workflow-extension">{script.id.toLowerCase().endsWith('.bwc') ? 'BWC' : 'BW'}</span>
              </button>
            {/each}
            {#if status && !status.scripts.length}<p class="workflow-empty">{$t('No .bw or .bwc scripts found.')}</p>{/if}
          </div>
        </div>
      </section>
      <section class="workflow-execution" aria-label={$t('Workflow pages')}>
        <Tabs.Root bind:value={activeTab} class="grid grid-rows-[auto_minmax(0,1fr)] flex-1 min-h-0 min-w-0 gap-0">
          <div class="workflow-tab-bar">
            <Tabs.List variant="line" aria-label={$t('Workflow pages')} class="h-11 w-full gap-1">
              <Tabs.Trigger value="settings" class="min-w-0 px-2 text-[13px] transition-none after:transition-none"><SlidersHorizontal size={16} />{$t('Parameters')}</Tabs.Trigger>
              <Tabs.Trigger value="preview" class="min-w-0 px-2 text-[13px] transition-none after:transition-none"><FileCode2 size={16} />{$t('Script preview')}</Tabs.Trigger>
              <Tabs.Trigger value="results" class="min-w-0 px-2 text-[13px] transition-none after:transition-none"><FileText size={16} />{$t('Results')}</Tabs.Trigger>
            </Tabs.List>
          </div>
          <Tabs.Content value="settings" class="min-h-0 min-w-0 overflow-auto m-0">
            <div class="workflow-settings">
              <div class="workflow-field">
                <label for="workflow-results">{$t('Results folder')}</label>
                <button id="workflow-results" class="workflow-picker" class:unselected={!status?.results} type="button" aria-label={$t('Choose results folder')} title={display_path(status?.results)} onclick={() => pick('results')} disabled={busy || running}><span>{display_path(status?.results) || $t('Choose results folder')}</span><FolderOpen size={17} /></button>
              </div>
              {#if inputMode === 'batch' && status?.inputSet?.files.length}<div class="workflow-field"><label for="batch-preview-input">{$t('Preview input')}</label><select id="batch-preview-input" value={previewInput || status.inputSet.files[0]} disabled={busy || running} onchange={event => { previewInput = event.currentTarget.value; void inspect() }}>{#each status.inputSet.files as path}<option value={path}>{display_path(path)}</option>{/each}</select></div>{/if}
              <div class="workflow-parameters">
                <div class="workflow-field"><label for="workflow-cores"><Cpu size={14} />{$t('CPU cores')}</label><input id="workflow-cores" type="number" min="1" max="1024" step="1" bind:value={cores} disabled={busy || running} /></div>
              </div>
              {#each groups as group}
                <fieldset class="parameter-group" disabled={busy || running}>
                  <legend>{group}</legend>
                  {#each inspection?.fields.filter(field => field.group === group) ?? [] as field (field.id)}
                    <div class="parameter-row">
                      <label for={'parameter-' + field.id} title={field.helps?.[$locale] ?? field.help}>{field.labels?.[$locale] ?? field.label}{#if field.unit} ({field.unit}){/if}</label>
                      <div class="parameter-control">
                        {#if inputMode === 'batch' && (field.type === 'file' || ['logfile','fragdef'].includes(field.name))}
                          <select class="binding-mode" aria-label={`${$t('File binding')}: ${field.labels?.[$locale] ?? field.label}`} value={field.id in bindings ? 'matched' : 'fixed'} onchange={event => bindingMode(field,event.currentTarget.value === 'matched')}><option value="fixed">{$t('Fixed file')}</option><option value="matched">{$t('Match per input')}</option></select>
                        {/if}
                        {#if field.id in bindings}<input id={'parameter-' + field.id} aria-label={`${$t('Companion filename pattern')}: ${field.labels?.[$locale] ?? field.label}`} value={bindings[field.id]} placeholder={'${input}.log'} oninput={event => { bindings = {...bindings,[field.id]:event.currentTarget.value}; if(inspectTimer) clearTimeout(inspectTimer); inspectTimer = setTimeout(() => void inspect(),300) }}/>
                        {:else}
                        {#if field.type === 'select' || field.type === 'boolean'}
                          <select id={'parameter-' + field.id} value={parameters[field.id] ?? field.value} onchange={event => change(field, event.currentTarget.value)}>
                            {#if !field.options.some(option => option.value === (parameters[field.id] ?? field.value))}<option value={parameters[field.id] ?? field.value}>{parameters[field.id] ?? field.value}</option>{/if}
                            {#each field.options as option}<option value={option.value}>{option.labels?.[$locale] ?? option.label}</option>{/each}
                          </select>
                        {:else}
                          <input id={'parameter-' + field.id} type={field.type === 'number' ? 'number' : 'text'} step="any" value={parameters[field.id] ?? field.value} oninput={event => change(field, event.currentTarget.value)} />
                          {#if field.type === 'file' || field.type === 'directory'}<button type="button" aria-label={$t('Choose file')} onclick={() => parameterPath(field)}><FolderOpen size={16} /></button>{/if}
                        {/if}
                        {/if}
                        {#if field.id in parameters}<button type="button" title={$t('Reset parameter')} aria-label={$t('Reset parameter')} onclick={() => reset(field)}>↺</button>{/if}
                      </div>
                    </div>
                  {/each}
                </fieldset>
              {/each}
              {#if inspection && !inspection.fields.length}<p class="workflow-empty">{$t('This script has no configurable parameters.')}</p>{/if}
              {#if inspection?.diagnostics.length}<details><summary>{$t('Script notes')}</summary>{#each inspection.diagnostics as note}<p>{note}</p>{/each}</details>{/if}
              <details class="advanced-variables"><summary>{$t('Additional variables')}</summary><textarea aria-label={$t('Variables')} bind:value={variables} oninput={() => { if (inspectTimer) clearTimeout(inspectTimer); inspectBusy = true; inspectTimer = setTimeout(() => void inspect(), 300) }} disabled={busy || running}></textarea></details>
            </div>
          </Tabs.Content>
          <Tabs.Content value="preview" class="min-h-0 min-w-0 m-0">
            <div class="workflow-preview-page">
              <section class="workflow-preview" aria-label={$t('Script preview')}>
                <div class="workflow-preview-heading"><FileCode2 size={16} /><span title={selected}>{selected || '—'}</span><select aria-label={$t('Preview content')} bind:value={nativePreview}><option value={false}>{$t('Original script')}</option><option value={true}>{$t('Multiwfn input')}</option></select></div>
                <div class="workflow-code">
                  <pre class="workflow-line-numbers" aria-hidden="true">{sourceLines}</pre>
                  <pre class="workflow-source"><code>{previewText}</code></pre>
                </div>
              </section>
            </div>
          </Tabs.Content>
          <Tabs.Content value="results" class="flex flex-col min-h-0 min-w-0 overflow-hidden m-0">
            <div class="batch-navigation"><button type="button" disabled={busy || running} onclick={loadBatch}><FolderOpen size={15}/>{$t('Open batch')}</button>{#if status?.batch && batchScope}<button type="button" onclick={() => { batchScope = undefined; detail = undefined; detailGeneration++ }}>{$t('Batch overview')}</button><select aria-label={$t('Result input')} value={batchScope.item} onchange={event => viewItem(event.currentTarget.value)}>{#each status.batch.cases as item}<option value={item.id} disabled={!item.attempts}>{item.name}</option>{/each}</select>{#if detail}<select aria-label={$t('Run attempt')} value={detail.item.attempt} onchange={event => batchScope && viewItem(batchScope.item,Number(event.currentTarget.value))}>{#each Array.from({length:detail.item.attempts},(_,i)=>i+1) as attempt}<option value={attempt}>{$t('Attempt {number}',{number:attempt})}</option>{/each}</select>{/if}{/if}</div>
            {#if status?.batch && !batchScope}<WorkflowBatch batch={status.batch} {busy} onview={viewItem} oncontrol={batchControl} onfolder={() => { if(status?.batch) void client.openPath(status.batch.directory,undefined,{batch:status.batch.id}).catch(show_error) }}/>
            {:else}
            <section class="workflow-output" aria-label={$t('Workflow output')}>
              <div class="workflow-output-heading">
                <div class="workflow-output-switch" role="group" aria-label={$t('Workflow output')}>
                  <button type="button" class:active={outputView === 'log'} aria-pressed={outputView === 'log'} onclick={() => outputView = 'log'}><Terminal size={15} />{$t('Log')}</button>
                  <button type="button" class:active={outputView === 'files'} aria-pressed={outputView === 'files'} onclick={() => outputView = 'files'}><FileText size={15} />{$t('Result files')}</button>
                </div>
                {#if outputView === 'files' && job}
                  <button type="button" disabled={busy} onclick={() => openPath()} title={$t('Open results folder')}><FolderOpen size={15} />{$t('Open folder')}</button>
                {/if}
              </div>
              {#if job}
                {#if job.message}<p class="workflow-error workflow-job-message" role="alert">{$t(job.message)}</p>{/if}
                {#if job.exitCode !== null && job.exitCode !== 0}<p class="workflow-error workflow-job-message">{$t('Exit code')}: {job.exitCode}</p>{/if}
                {#if outputView === 'log'}
                  <WorkflowTrace {job} scope={batchScope}/>
                {:else}
                  <div class="workflow-result-files">
                    <p class="workflow-result-path">{display_path(job.directory)}</p>
                    {#if job.cubes?.length}
                      <div class="workflow-result-toolbar">
                        <label><input type="checkbox" aria-label={$t('Select all Cube files')} checked={selectedResults.length === job.cubes.length} indeterminate={selectedResults.length > 0 && selectedResults.length < job.cubes.length} disabled={busy || jobRunning || job.state === 'prepared'} onchange={(event) => selectedResults = event.currentTarget.checked ? (job?.cubes ?? []).map(cube => cube.file) : []} />{$t('Select all')}</label>
                        <span class="workflow-selected-count">{selectedResults.length} / {job.cubes.length}</span>
                        <button type="button" disabled={busy || jobRunning || job.state === 'prepared' || !selectedResults.length} onclick={() => openResults()}>{$t('Render selected')}</button>
                        <button type="button" class="workflow-primary" disabled={busy || jobRunning || job.state === 'prepared'} onclick={() => openResults(true)}><Play size={15} />{$t('One-click render')}</button>
                      </div>
                    {/if}
                    <ul>{#each job.files as file}
                      {@const cube = job.cubes?.find(cube => cube.file === file)}
                      <li>
                        {#if cube}<input type="checkbox" aria-label={`${$t('Select result')}: ${file}`} checked={selectedResults.includes(file)} disabled={busy || jobRunning || job.state === 'prepared'} onchange={(event) => selectResult(file, event.currentTarget.checked)} />{/if}
                        <FileText size={16} /><div class="workflow-result-name"><span>{file}</span>{#if cube}<span class="workflow-result-kind">{$t(workflow_cube_label(cube))}{#if cube.unit} · {cube.unit}{/if}</span>{/if}</div>
                        {#if cube}
                          {#if cube.kind === 'esp' && !cube.unitDeclared}
                            <select aria-label={`${$t('ESP data unit')}: ${file}`} value={resultUnits[file] || cube.unit || ''} onchange={(event) => resultUnits = { ...resultUnits, [file]: event.currentTarget.value }}>
                              <option value="" disabled>{$t('Choose unit')}</option><option value="au">a.u.</option><option value="kcal/mol">kcal/mol</option>
                            </select>
                          {/if}
                          <button type="button" onclick={() => openResult(cube)} disabled={busy || jobRunning || job.state === 'prepared' || (cube.kind === 'esp' && (!cube.density || (!cube.unit && !resultUnits[file])))} title={cube.kind === 'esp' && !cube.density ? $t('ESP needs one matching _den Cube in the same folder') : $t('Open in Multiwfn viewer')}>{$t('Render')}</button>
                        {/if}
                        <button type="button" onclick={() => openPath(file)} disabled={busy} aria-label={$t('Open file: {file}', { file })} title={$t('Open with the default application')}>{$t('Open')}</button>
                      </li>
                    {/each}</ul>
                  </div>
                {/if}
              {:else}
                <div class="workflow-output-empty"><Terminal size={24} /><p>{$t('No runs yet')}</p></div>
              {/if}
            </section>
            {/if}
          </Tabs.Content>
        </Tabs.Root>
        <div class="workflow-footer">
          <div class="workflow-status">{#if status?.batch}<span class="workflow-state" class:running class:failed={['failed','partial'].includes(status.batch.state)} role="status"><span></span>{$t(status.batch.state)}</span>{:else if job}<span class="workflow-state" class:running class:failed={job.state === 'failed'} role="status"><span></span>{$t(job.state)}</span>{/if}</div>
          <div class="workflow-actions">
            <button type="button" disabled={!canRun} onclick={() => run(true)}><Check size={16} />{$t('Preflight')}</button>
            {#if running}
              <button type="button" class="workflow-stop" disabled={busy} onclick={cancel}><Square size={15} />{$t('Cancel workflow')}</button>
            {:else}
              <button type="button" class="workflow-primary" disabled={!canRun} onclick={() => run(false)}><Play size={16} />{$t(inputMode === 'batch' ? 'Run batch' : 'Run workflow')}</button>
            {/if}
          </div>
        </div>
      </section>
    </div>
  </main>

<style>
  .input-mode { display:flex; gap:5px; margin-bottom:8px; } .input-mode button {flex:1; min-height:30px; font-size:12px; padding:4px;} .input-mode button.chosen {background:#e8f1f8; border-color:#9fbfd5; color:#245f84;}
  .batch-navigation {display:flex; gap:8px; align-items:center; padding:10px 20px; border-bottom:1px solid var(--ui-border); flex-shrink:0; min-width:0;} .batch-navigation button {font-size:12px;min-height:31px;padding:5px 8px;flex-shrink:0;} .batch-navigation select {min-width:0;max-width:250px;height:33px;padding:4px 7px;} .binding-mode {max-width:135px;}

  .parameter-group { padding: 18px 0; margin: 12px 0; border: 0; border-top: 1px solid var(--ui-border); }
  .parameter-group legend { padding-right: 12px; font-weight: 600; }
  .parameter-row { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr); gap: 18px; align-items: center; margin-bottom: 14px; }
  .parameter-row label { margin: 0; }
  .parameter-control { display: flex; gap: 6px; min-width: 0; }
  .parameter-control input, .parameter-control select { flex: 1; min-width: 0; }
  select { height: 39px; border: 1px solid var(--ui-border); border-radius: 7px; padding: 8px 10px; color: inherit; background: var(--ui-background); font: inherit; }
  .workflow-preview-heading select { margin-left: auto; }
  details { margin-top: 18px; color: var(--ui-muted-foreground); }
  summary { cursor: pointer; }
  details textarea { margin-top: 12px; }
  .workflow-panel { display: flex; flex-direction: column; position: fixed; inset: 0; margin: 0; padding: 0; width: 100%; max-width: none; height: 100dvh; overflow: hidden; background: var(--ui-background); color: var(--ui-foreground); font-size: 13px; }
  .workflow-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; padding: 18px 24px; border-bottom: 1px solid var(--ui-border); }
  .workflow-title { display: flex; align-items: center; gap: 12px; }
  .workflow-mark { width: 40px; height: 40px; object-fit: contain; border-radius: 7px; }
  .workflow-library-actions { display: flex; gap: 6px; }
  h2 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -.02em; }
  h3 { margin: 0; font-size: 14px; font-weight: 600; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; height: auto; padding: 7px 12px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-background); color: var(--ui-foreground); font: inherit; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--ui-muted); border-color: #b5c5d1; }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--ui-ring); outline-offset: 2px; }
  button :global(svg) { flex-shrink: 0; }
  .workflow-layout { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 7fr); flex: 1; min-height: 0; }
  .workflow-library, .workflow-execution { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .workflow-library { padding: 22px 18px; background: #f7f9fb; border-right: 1px solid var(--ui-border); }
  .workflow-catalog { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .workflow-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .workflow-section-heading h3 { display: flex; align-items: center; gap: 8px; }
  .workflow-count { display: inline-flex; justify-content: center; min-width: 22px; padding: 1px 6px; border-radius: 5px; background: #e7edf2; color: var(--ui-muted-foreground); font-size: 12px; }
  .workflow-folder { width: 34px; min-height: 34px; padding: 0; }
  .workflow-library-path { margin: 10px 0 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ui-muted-foreground); font: 12px/1.5 ui-monospace, monospace; }
  .workflow-script-list { display: grid; flex: 1; align-content: start; gap: 5px; min-height: 0; overflow: auto; padding: 2px; margin: -2px; }
  .workflow-script { width: 100%; justify-content: flex-start; min-height: 40px; padding: 8px 12px; border-color: transparent; background: transparent; text-align: left; }
  .workflow-script > span:first-of-type { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .workflow-script.selected, .workflow-script.selected:hover:not(:disabled) { background: var(--ui-accent); color: var(--ui-primary); border-color: #c5dfe7; }
  .workflow-extension { font: 11px/1.4 ui-monospace, monospace; color: var(--ui-muted-foreground); background: #ffffffa6; padding: 2px 5px; border-radius: 4px; }
  .workflow-tab-bar { padding: 12px 24px 0; border-bottom: 1px solid var(--ui-border); }
  .workflow-preview-page { display: flex; height: 100%; padding: 24px; }
  .workflow-preview { display: flex; flex-direction: column; flex: 1; min-height: 0; border: 1px solid var(--ui-border); border-radius: 9px; overflow: hidden; background: var(--ui-background); }
  .workflow-preview-heading { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 10px 14px; border-bottom: 1px solid var(--ui-border); color: var(--ui-muted-foreground); }
  .workflow-preview-heading > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 13px/1.5 ui-monospace, monospace; }
  .workflow-code { display: flex; flex: 1; min-height: 0; overflow: auto; }
  .workflow-code pre { margin: 0; padding: 16px 14px; font: 13px/1.85 ui-monospace, SFMono-Regular, Consolas, monospace; tab-size: 2; }
  .workflow-line-numbers { flex-shrink: 0; text-align: right; color: #99a6b5; background: #fafbfc; user-select: none; }
  .workflow-source { flex: 1; color: #354559; }
  .workflow-source code { font: inherit; }
  .workflow-settings { padding: 28px 24px; }
  .workflow-field { min-width: 0; margin-bottom: 22px; }
  label { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; font-size: 13px; }
  .workflow-picker { width: 100%; justify-content: space-between; min-height: 39px; text-align: left; }
  .workflow-picker > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px/1.5 ui-monospace, monospace; }
  .workflow-picker :global(svg) { color: var(--ui-muted-foreground); }
  .workflow-picker.unselected > span { font: inherit; color: var(--ui-muted-foreground); }
  .workflow-parameters { display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: 20px; }
  input, textarea { width: 100%; height: 39px; border: 1px solid var(--ui-border); border-radius: 7px; padding: 9px 11px; background: var(--ui-background); color: inherit; font: inherit; }
  textarea { display: block; height: 128px; min-height: 128px; max-height: 128px; resize: none; font: 13px/1.6 ui-monospace, monospace; }
  textarea::placeholder { color: #95a2b1; }
  .workflow-footer { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--ui-border); }
  .workflow-status { min-width: 0; }
  .workflow-actions { display: flex; gap: 10px; }
  .workflow-actions button { min-height: 40px; padding: 8px 18px; font-weight: 500; }
  .workflow-primary, .workflow-primary:hover:not(:disabled) { background: var(--ui-primary); color: var(--ui-primary-foreground); border-color: var(--ui-primary); }
  .workflow-primary:hover:not(:disabled) { background: #125b72; }
  .workflow-stop, .workflow-stop:hover:not(:disabled) { background: #fff2f0; color: #b42318; border-color: #f0c4be; }
  .workflow-output { display: flex; flex-direction: column; flex: 1; min-height: 0; background: #fafbfc; }
  .workflow-output-heading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 18px; border-bottom: 1px solid var(--ui-border); }
  .workflow-output-switch { display: flex; gap: 4px; }
  .workflow-output-switch button { min-height: 30px; padding: 5px 8px; border-color: transparent; background: transparent; color: var(--ui-muted-foreground); white-space: nowrap; }
  .workflow-output-switch button.active { background: #eaf0f4; color: var(--ui-foreground); }
  .workflow-state { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; font-size: 12px; color: #28755a; }
  .workflow-state > span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .workflow-state.running { color: var(--ui-primary); }
  .workflow-state.failed { color: #b42318; }
  .workflow-result-files { flex: 1; min-height: 0; padding: 16px 24px; overflow: auto; font: 12px/1.8 ui-monospace, monospace; }
  .workflow-result-path { margin: 0 0 12px; color: var(--ui-muted-foreground); overflow-wrap: anywhere; }
  ul { padding: 0; margin: 0; list-style: none; }
  li { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--ui-border); overflow-wrap: anywhere; }
  .workflow-result-name { display: flex; flex: 1; min-width: 0; flex-direction: column; }
  .workflow-result-kind { color: var(--ui-muted-foreground); font: 12px/1.6 system-ui, sans-serif; }
  li button, li select { flex-shrink: 0; font: 12px/1.5 system-ui, sans-serif; }
  li :global(svg) { flex-shrink: 0; margin-top: 4px; color: var(--ui-muted-foreground); }
  li span { min-width: 0; }
  .workflow-output-empty { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 10px; padding: 24px; color: #8b98a8; }
  .workflow-result-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--ui-border); }
  .workflow-result-toolbar label { display: flex; align-items: center; gap: 7px; font-size: 13px; cursor: pointer; }
  .workflow-selected-count { margin-right: auto; color: var(--ui-muted-foreground); font-size: 12px; }
  .workflow-result-toolbar button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; }
  .workflow-result-files input[type="checkbox"] { flex-shrink: 0; width: 16px; height: 16px; accent-color: var(--ui-accent); }
  .workflow-output-empty p, .workflow-empty { margin: 0; }
  .workflow-empty { padding: 16px 0; color: var(--ui-muted-foreground); }
  .workflow-error { margin: 10px 0; color: #b42318; font-size: 13px; overflow-wrap: anywhere; }
  .workflow-banner { flex-shrink: 0; margin: 0; padding: 12px 24px; background: #fff2f0; border-bottom: 1px solid #f0d3cf; }
  .workflow-job-message { flex-shrink: 0; margin: 0; padding: 10px 24px 0; }
  @media (max-width: 760px) {
    .workflow-header { padding: 14px 18px; }
    .workflow-layout { grid-template-columns: 1fr; grid-template-rows: 190px minmax(0, 1fr); }
    .workflow-library { padding: 12px 18px; border-right: 0; border-bottom: 1px solid var(--ui-border); }
    .workflow-tab-bar { padding: 8px 12px 0; }
    .workflow-preview-page { padding: 18px; }
    .workflow-settings { padding: 20px 18px; }
    .workflow-footer { padding: 12px 18px; flex-wrap: wrap; }
    .workflow-actions { margin-left: auto; }
    .workflow-actions button { padding: 8px 12px; }
    .workflow-output-heading { padding: 10px 12px; }
    .workflow-parameters { grid-template-columns: 100px minmax(0, 1fr); gap: 12px; }
  }
</style>
