<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { FolderOpen, FileCode2, FileText, Play, Square, Check, Terminal, Cpu, SlidersHorizontal } from '@lucide/svelte'
  import banewfnIcon from '../../workflows/icons/banewfn.png'
  import * as Tabs from '$lib/components/ui/tabs'
  import { t, locale, set_locale } from './i18n'
  import { create_workflow_client, workflow_active, workflow_variables, workflow_cube_label, display_path, type WorkflowCube, type WorkflowStatus, type WorkflowSelection, type WorkflowInspection, type WorkflowField } from './workflows'

  const client = create_workflow_client()
  let status: WorkflowStatus | undefined
  let selected = ''
  let source = ''
  let variables = ''
  let parameters: Record<string, string> = {}
  let inspection: WorkflowInspection | undefined
  let inspectBusy = false
  let inspectValid = false
  let inspectGeneration = 0
  let nativePreview = false
  let inspectTimer: ReturnType<typeof setTimeout> | undefined
  const inspect = async (): Promise<void> => {
    const generation = ++inspectGeneration
    if (!selected) return
    inspectBusy = true
    inspectValid = false
    try {
      const next = await client.inspect(selected, parameters, workflow_variables(variables))
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
    if (!status?.job || busy) return
    busy = true; error = ''
    try { await client.openPath(status.job.directory, file) }
    catch (reason) { show_error(reason) }
    finally { busy = false }
  }
  const selectResult = (file: string, checked: boolean): void => {
    selectedResults = checked ? [...selectedResults, file] : selectedResults.filter(value => value !== file)
  }
  const openResults = async (all = false): Promise<void> => {
    if (!status?.job || busy || workflow_active(status.job)) return
    if (all) selectedResults = (status.job.cubes ?? []).map(cube => cube.file)
    if (!selectedResults.length) return
    error = ''
    const chosen = (status.job.cubes ?? []).filter(cube => selectedResults.includes(cube.file))
    for (const cube of chosen) {
      if (cube.kind !== 'esp') continue
      const message = !cube.density ? 'ESP needs one matching _den Cube in the same folder'
        : !(resultUnits[cube.file] || cube.unit) ? 'Choose the ESP data unit' : ''
      if (message) { error = `${cube.file}: ${$t(message)}`; return }
    }
    busy = true
    try {
      await client.openResults(status.job.directory, selectedResults, resultUnits)
      apply(await client.status())
    } catch (reason) { show_error(reason) }
    finally { busy = false }
  }
  const openResult = async (cube: WorkflowCube): Promise<void> => {
    if (!status?.job || busy) return
    busy = true; error = ''
    try {
      await client.openResult(status.job.directory, cube.file, resultUnits[cube.file] || cube.unit || undefined)
      apply(await client.status())
    } catch (reason) { show_error(reason) }
    finally { busy = false }
  }

  const show_error = (reason: unknown): void => { if (!destroyed) error = reason instanceof Error ? reason.message : String(reason) }
  const preview = async (id: string): Promise<void> => {
    selected = id; source = ''; parameters = {}; inspection = undefined; inspectGeneration++
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
    if (status?.job?.directory !== next.job?.directory) { resultUnits = {}; selectedResults = [] }
    else selectedResults = selectedResults.filter(file => next.job?.cubes?.some(cube => cube.file === file))
    status = next
    if (!next.scripts.some((script) => script.id === selected)) void preview(next.selectedScript ?? next.scripts[0]?.id ?? '')
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    if (!destroyed && workflow_active(status?.job ?? null)) timer = setTimeout(() => void refresh(), 700)
  }
  const refresh = async (): Promise<void> => {
    try { apply(await client.status()) } catch (reason) { show_error(reason) }
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
    if (busy || workflow_active(status?.job ?? null)) return
    busy = true; error = ''; outputView = 'log'
    try {
      apply(await client.run({ script: selected, cores, variables: workflow_variables(variables), dryRun, parameters }))
      activeTab = 'results'
    }
    catch (reason) { show_error(reason); await refresh() }
    finally { busy = false; schedule() }
  }
  const cancel = async (): Promise<void> => {
    busy = true; error = ''
    try { apply(await client.cancel()) } catch (reason) { show_error(reason) }
    finally { busy = false; schedule() }
  }
  $: running = workflow_active(status?.job ?? null)
  $: canRun = status?.available && selected && status?.results && status?.multiwfn && inspection?.runnable && inspectValid && !inspectBusy && !running && !busy
  $: previewText = nativePreview ? (inspection?.tasks ?? []).map(task => `# ${task.task + 1} · ${task.module || 'raw'}\n${task.commands}`).join('\n') : source
  $: sourceLines = previewText ? previewText.split('\n').map((_, index) => index + 1).join('\n') : ''
  $: groups = [...new Set((inspection?.fields ?? []).map(field => field.group))]
  onMount(() => { void refresh() })
  onDestroy(() => { destroyed = true; previewGeneration++; inspectGeneration++; if (timer) clearTimeout(timer); if (inspectTimer) clearTimeout(inspectTimer) })
</script>

  <main class="workflow-panel" aria-labelledby="workflow-heading">
    <header class="workflow-header">
      <div class="workflow-title"><img class="workflow-mark" src={banewfnIcon} alt="" /><h2 id="workflow-heading">BaneWfn</h2></div>
      <button type="button" onclick={() => set_locale($locale === 'zh' ? 'en' : 'zh')}>{$locale === 'zh' ? 'English' : '中文'}</button>
    </header>
    {#if error}<p class="workflow-error workflow-banner" role="alert">{$t(error)}</p>{/if}
    {#if status?.available === false}<p class="workflow-error workflow-banner" role="alert">{$t('Install the optional workflow runner to use this panel.')}</p>{/if}
    {#if status?.available && !status.multiwfn}<p class="workflow-error workflow-banner" role="alert">{$t('The bundled Multiwfn executable could not be located.')}</p>{/if}
    <div class="workflow-layout">
      <section class="workflow-library" aria-labelledby="workflow-library-heading">
        <div class="workflow-field">
          <label for="workflow-startup">{$t('Startup file')}</label>
          <button id="workflow-startup" class="workflow-picker" type="button" aria-label={$t('Choose startup file')} title={display_path(status?.wavefunction)} onclick={() => pick('wavefunction')} disabled={busy || running}><span>{display_path(status?.wavefunction) || $t('Choose startup file')}</span><FolderOpen size={17} /></button>
        </div>
        <div class="workflow-catalog">
          <div class="workflow-section-heading">
            <h3 id="workflow-library-heading">{$t('Scripts')} <span class="workflow-count">{status?.scripts.length ?? 0}</span></h3>
            <div class="workflow-library-actions">
            <button class="workflow-folder" type="button" aria-label={$t('Open workflow script')} title={$t('Open workflow script')} onclick={() => pick('script')} disabled={busy || running}><FileCode2 size={17} /></button>
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
                        {#if field.type === 'select' || field.type === 'boolean'}
                          <select id={'parameter-' + field.id} value={parameters[field.id] ?? field.value} onchange={event => change(field, event.currentTarget.value)}>
                            {#if !field.options.some(option => option.value === (parameters[field.id] ?? field.value))}<option value={parameters[field.id] ?? field.value}>{parameters[field.id] ?? field.value}</option>{/if}
                            {#each field.options as option}<option value={option.value}>{option.labels?.[$locale] ?? option.label}</option>{/each}
                          </select>
                        {:else}
                          <input id={'parameter-' + field.id} type={field.type === 'number' ? 'number' : 'text'} step="any" value={parameters[field.id] ?? field.value} oninput={event => change(field, event.currentTarget.value)} />
                          {#if field.type === 'file' || field.type === 'directory'}<button type="button" aria-label={$t('Choose file')} onclick={() => parameterPath(field)}><FolderOpen size={16} /></button>{/if}
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
          <Tabs.Content value="results" class="min-h-0 min-w-0 m-0">
            <section class="workflow-output" aria-label={$t('Workflow output')}>
              <div class="workflow-output-heading">
                <div class="workflow-output-switch" role="group" aria-label={$t('Workflow output')}>
                  <button type="button" class:active={outputView === 'log'} aria-pressed={outputView === 'log'} onclick={() => outputView = 'log'}><Terminal size={15} />{$t('Log')}</button>
                  <button type="button" class:active={outputView === 'files'} aria-pressed={outputView === 'files'} onclick={() => outputView = 'files'}><FileText size={15} />{$t('Result files')}</button>
                </div>
                {#if outputView === 'files' && status?.job}
                  <button type="button" disabled={busy} onclick={() => openPath()} title={$t('Open results folder')}><FolderOpen size={15} />{$t('Open folder')}</button>
                {/if}
              </div>
              {#if status?.job}
                {#if status.job.message}<p class="workflow-error workflow-job-message" role="alert">{$t(status.job.message)}</p>{/if}
                {#if status.job.exitCode !== null && status.job.exitCode !== 0}<p class="workflow-error workflow-job-message">{$t('Exit code')}: {status.job.exitCode}</p>{/if}
                {#if outputView === 'log'}
                  <pre class="workflow-log">{status.job.log}</pre>
                {:else}
                  <div class="workflow-result-files">
                    <p class="workflow-result-path">{display_path(status.job.directory)}</p>
                    {#if status.job.cubes?.length}
                      <div class="workflow-result-toolbar">
                        <label><input type="checkbox" aria-label={$t('Select all Cube files')} checked={selectedResults.length === status.job.cubes.length} indeterminate={selectedResults.length > 0 && selectedResults.length < status.job.cubes.length} disabled={busy || running || status.job.state === 'prepared'} onchange={(event) => selectedResults = event.currentTarget.checked ? (status?.job?.cubes ?? []).map(cube => cube.file) : []} />{$t('Select all')}</label>
                        <span class="workflow-selected-count">{selectedResults.length} / {status.job.cubes.length}</span>
                        <button type="button" disabled={busy || running || status.job.state === 'prepared' || !selectedResults.length} onclick={() => openResults()}>{$t('Render selected')}</button>
                        <button type="button" class="workflow-primary" disabled={busy || running || status.job.state === 'prepared'} onclick={() => openResults(true)}><Play size={15} />{$t('One-click render')}</button>
                      </div>
                    {/if}
                    <ul>{#each status.job.files as file}
                      {@const cube = status.job.cubes?.find(cube => cube.file === file)}
                      <li>
                        {#if cube}<input type="checkbox" aria-label={`${$t('Select result')}: ${file}`} checked={selectedResults.includes(file)} disabled={busy || running || status.job.state === 'prepared'} onchange={(event) => selectResult(file, event.currentTarget.checked)} />{/if}
                        <FileText size={16} /><div class="workflow-result-name"><span>{file}</span>{#if cube}<span class="workflow-result-kind">{$t(workflow_cube_label(cube))}{#if cube.unit} · {cube.unit}{/if}</span>{/if}</div>
                        {#if cube}
                          {#if cube.kind === 'esp' && !cube.unitDeclared}
                            <select aria-label={`${$t('ESP data unit')}: ${file}`} value={resultUnits[file] || cube.unit || ''} onchange={(event) => resultUnits = { ...resultUnits, [file]: event.currentTarget.value }}>
                              <option value="" disabled>{$t('Choose unit')}</option><option value="au">a.u.</option><option value="kcal/mol">kcal/mol</option>
                            </select>
                          {/if}
                          <button type="button" onclick={() => openResult(cube)} disabled={busy || running || status.job.state === 'prepared' || (cube.kind === 'esp' && (!cube.density || (!cube.unit && !resultUnits[file])))} title={cube.kind === 'esp' && !cube.density ? $t('ESP needs one matching _den Cube in the same folder') : $t('Open in Multiwfn viewer')}>{$t('Render')}</button>
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
          </Tabs.Content>
        </Tabs.Root>
        <div class="workflow-footer">
          <div class="workflow-status">{#if status?.job}<span class="workflow-state" class:running class:failed={status.job.state === 'failed'} role="status"><span></span>{$t(status.job.state)}</span>{/if}</div>
          <div class="workflow-actions">
            <button type="button" disabled={!canRun} onclick={() => run(true)}><Check size={16} />{$t('Preflight')}</button>
            {#if running}
              <button type="button" class="workflow-stop" disabled={busy} onclick={cancel}><Square size={15} />{$t('Cancel workflow')}</button>
            {:else}
              <button type="button" class="workflow-primary" disabled={!canRun} onclick={() => run(false)}><Play size={16} />{$t('Run workflow')}</button>
            {/if}
          </div>
        </div>
      </section>
    </div>
  </main>

<style>
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
  .workflow-output { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #fafbfc; }
  .workflow-output-heading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 18px; border-bottom: 1px solid var(--ui-border); }
  .workflow-output-switch { display: flex; gap: 4px; }
  .workflow-output-switch button { min-height: 30px; padding: 5px 8px; border-color: transparent; background: transparent; color: var(--ui-muted-foreground); white-space: nowrap; }
  .workflow-output-switch button.active { background: #eaf0f4; color: var(--ui-foreground); }
  .workflow-state { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; font-size: 12px; color: #28755a; }
  .workflow-state > span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .workflow-state.running { color: var(--ui-primary); }
  .workflow-state.failed { color: #b42318; }
  .workflow-log { flex: 1; min-height: 0; margin: 0; padding: 16px 24px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: #526276; font: 12px/1.8 ui-monospace, monospace; }
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
