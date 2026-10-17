<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Plus, X, ArrowUp, ArrowDown, Trash2, FileCode2, FolderInput, ArrowRightLeft, Terminal, Check } from '@lucide/svelte'
  import { t, locale } from './i18n'
  import { create_workflow_client, type WorkflowField, type WorkflowStatus } from './workflows'
  import { new_analysis, esp_example, module_labels, section_labels, type BuilderCatalog, type BuilderDraft, type BuilderPreview, type BuilderAnalysis, type BuilderCommand, type BuilderStep } from './workflow-builder'

  export let onclose: () => void
  export let onsaved: (status: WorkflowStatus) => void
  const client = create_workflow_client()
  let dialog: HTMLDialogElement
  let catalog: BuilderCatalog = { version: 1, modules: [] }
  let draft: BuilderDraft = { variables: '', steps: [] }
  let result: BuilderPreview | undefined
  let selectedModule = 'grid'
  let search = ''
  let chosen: string[] = []
  let active = -1
  let error = ''
  let busy = false
  let saving = false
  let valid = false
  let nativePreview = false
  let showConf = false
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false
  let previousFocus: HTMLElement | null = null
  $: modules = catalog.modules.filter(module => module.name.toLowerCase().includes(search.toLowerCase()))
  $: module = catalog.modules.find(module => module.name === selectedModule)
  $: step = draft.steps[active]
  $: analysis = step?.kind === 'analysis' ? step : undefined
  $: fields = (result?.inspection.fields ?? []).filter(field => field.id.startsWith(`${active}/`))
  $: preview = nativePreview ? (result?.inspection.tasks ?? []).map(task => `# ${task.task + 1} · ${task.module || 'raw'}\n${task.commands}`).join('\n') : result?.source ?? ''

  const message = (reason: unknown): void => { error = reason instanceof Error ? reason.message : String(reason) }
  const inspect = async (): Promise<void> => {
    const current = ++generation
    if (!draft.steps.length) { result = undefined; busy = false; return }
    busy = true; valid = false
    try {
      const next = await client.builderPreview(draft)
      if (!destroyed && current === generation) { result = next; valid = true; error = '' }
    } catch (reason) { if (!destroyed && current === generation) message(reason) }
    finally { if (!destroyed && current === generation) busy = false }
  }
  const changed = (): void => {
    draft = { ...draft, steps: [...draft.steps] }
    valid = false; generation++; busy = draft.steps.length > 0
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void inspect(), 280)
  }
  const add = (next: BuilderStep): void => { draft.steps.push(next); active = draft.steps.length - 1; changed() }
  const addAnalysis = (): void => { if (module) add(new_analysis(module.name, module.sections.filter(s => chosen.includes(s.name)).map(s => s.name))) }
  const remove = (index: number): void => { draft.steps.splice(index, 1); active = Math.min(active, draft.steps.length - 1); result = undefined; changed() }
  const move = (index: number, offset: number): void => {
    const next = index + offset
    if (next < 0 || next >= draft.steps.length) return
    ;[draft.steps[index], draft.steps[next]] = [draft.steps[next], draft.steps[index]]
    active = next; result = undefined; changed()
  }
  const moveProcess = (analysis: BuilderAnalysis, index: number, offset: number): void => {
    const next = index + offset
    ;[analysis.processes[index], analysis.processes[next]] = [analysis.processes[next], analysis.processes[index]]
    result = undefined; changed()
  }
  const update = (field: WorkflowField, value?: string): void => {
    if (!analysis) return
    const location = field.id.split('/')[1]
    const params = location === 'main' ? analysis.parameters : analysis.processes[Number(location)]?.parameters
    if (!params) return
    if (value === undefined) delete params[field.name]
    else params[field.name] = value
    changed()
  }
  const value = (field: WorkflowField): string => {
    if (!analysis) return field.value
    const location = field.id.split('/')[1]
    const params = location === 'main' ? analysis.parameters : analysis.processes[Number(location)]?.parameters
    return params?.[field.name] ?? field.expression ?? field.value
  }
  const pick = async (field: WorkflowField): Promise<void> => {
    try { const path = await client.parameterPath(field.type); if (path) update(field, path) } catch (reason) { message(reason) }
  }
  const rename = (): void => { if (analysis) { analysis.commands.push({ kind: 'rename', source: '', target: '${input}_' }); changed() } }
  const addCommand = (): void => { if (analysis) { analysis.commands.push({ kind: 'command', text: '' }); changed() } }
  const moveCommand = (commands: BuilderCommand[], index: number, offset: number): void => {
    const next = index + offset; [commands[index], commands[next]] = [commands[next], commands[index]]; changed()
  }
  const save = async (): Promise<void> => {
    if (!valid || busy || saving) return
    saving = true
    try { const status = await client.builderSave(draft); if (status && !destroyed) onsaved(status) }
    catch (reason) { if (!destroyed) message(reason) }
    finally { if (!destroyed) saving = false }
  }
  const example = (): void => { draft = esp_example(); active = 0; result = undefined; changed() }
  onMount(() => {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    void client.builderCatalog().then(next => { if (!destroyed) { catalog = next; if (!catalog.modules.some(m => m.name === selectedModule)) selectedModule = catalog.modules[0]?.name ?? '' } }).catch(message)
  })
  onDestroy(() => { destroyed = true; generation++; if (timer) clearTimeout(timer); dialog?.close(); queueMicrotask(() => { if (previousFocus?.isConnected) previousFocus.focus() }) })
</script>

<dialog bind:this={dialog} class="builder" aria-labelledby="builder-title" oncancel={event => { event.preventDefault(); if (!saving) onclose() }}>
  <header>
    <div class="heading"><FileCode2 size={21} /><h2 id="builder-title">{$t('Script builder')}</h2></div>
    <button type="button" class="icon" aria-label={$t('Close script builder')} disabled={saving} onclick={onclose}><X size={20} /></button>
  </header>
  <fieldset class="body" disabled={saving}>
    <aside class="palette" aria-label={$t('Conf library')}>
      <h3>{$t('Conf library')}</h3>
      <input aria-label={$t('Search conf')} placeholder={$t('Search conf')} bind:value={search} />
      <select aria-label={$t('Analysis module')} bind:value={selectedModule} onchange={() => { chosen = [] }}>
        {#each modules as module}<option value={module.name}>{module.name}.conf{module_labels[module.name] ? ` · ${$t(module_labels[module.name])}` : ''}</option>{/each}
      </select>
      <div class="sections">
        {#each module?.sections.filter(section => section.name !== 'main') ?? [] as section}
          <label class="conf-section" title={section.notes}><input type="checkbox" checked={chosen.includes(section.name)} onchange={event => { chosen = event.currentTarget.checked ? [...chosen, section.name] : chosen.filter(name => name !== section.name) }} /><span>{section.name}{selectedModule && section_labels[selectedModule]?.[section.name] ? ` · ${$t(section_labels[selectedModule][section.name])}` : ''}</span></label>
        {/each}
        {#if module && module.sections.length === 1}<p class="hint">{$t('This conf runs its main section only.')}</p>{/if}
      </div>
      <button type="button" class="primary" disabled={!module || draft.steps.length >= 64} onclick={addAnalysis}><Plus size={16} />{$t('Add analysis block')}</button>
      <p class="hint">{$t('Main and quit are automatic. Selected sections run in the listed order.')}</p>
      <div class="glue">
        <h3>{$t('Glue steps')}</h3>
        <button type="button" onclick={() => add({ kind: 'collect', target: '${input}_results' })}><FolderInput size={16} />{$t('Collect outputs')}</button>
        <button type="button" onclick={() => add({ kind: 'rebase', target: '${input}_NTO1.fch' })}><ArrowRightLeft size={16} />{$t('Switch startup file')}</button>
        <button type="button" onclick={() => add({ kind: 'command', text: '', shell: 'bash' })}><Terminal size={16} />{$t('Shell command')}</button>
      </div>
      {#if catalog.modules.some(m => m.name === 'grid')}<button type="button" class="example" disabled={draft.steps.length > 0} onclick={example}>{$t('Density + ESP example')}</button>{/if}
    </aside>
    <section class="editor" aria-label={$t('Workflow steps')}>
      <h3>{$t('Workflow steps')} <span class="count">{draft.steps.length}</span></h3>
      <div class="step-list">
        {#each draft.steps as item, index}
          <div class="step-item" class:active={active === index}>
            <button type="button" class="step-name" aria-pressed={active === index} onclick={() => { active = index }}><span class="number">{index + 1}</span><span>{item.kind === 'analysis' ? item.module : $t(item.kind === 'collect' ? 'Collect outputs' : item.kind === 'rebase' ? 'Switch startup file' : 'Shell command')}</span></button>
            <button class="icon" type="button" aria-label={$t('Move step up')} disabled={index === 0} onclick={() => move(index, -1)}><ArrowUp size={14} /></button>
            <button class="icon" type="button" aria-label={$t('Move step down')} disabled={index === draft.steps.length - 1} onclick={() => move(index, 1)}><ArrowDown size={14} /></button>
            <button class="icon" type="button" aria-label={$t('Remove step')} onclick={() => remove(index)}><Trash2 size={14} /></button>
          </div>
        {/each}
        {#if !draft.steps.length}<div class="builder-empty"><FileCode2 size={34} /><p>{$t('Choose conf sections on the left to start building.')}</p></div>{/if}
      </div>
      {#if step}
        <div class="step-settings">
          {#if analysis}
            <h3>{analysis.module} · {$t('Process sections')}</h3>
            {#each analysis.processes as process, index}
              <div class="process-row">
                <select aria-label={$t('Process section')} bind:value={process.section} onchange={() => { process.parameters = {}; result = undefined; changed() }}>
                  {#each catalog.modules.find(m => m.name === analysis?.module)?.sections.filter(s => s.name !== 'main') ?? [] as section}<option value={section.name}>{section.name}</option>{/each}
                </select>
                <button class="icon" type="button" aria-label={$t('Move section up')} disabled={index === 0} onclick={() => analysis && moveProcess(analysis, index, -1)}><ArrowUp size={14} /></button>
                <button class="icon" type="button" aria-label={$t('Move section down')} disabled={index === analysis.processes.length - 1} onclick={() => analysis && moveProcess(analysis, index, 1)}><ArrowDown size={14} /></button>
                <button class="icon" type="button" aria-label={$t('Remove section')} onclick={() => { analysis?.processes.splice(index, 1); result = undefined; changed() }}><X size={14} /></button>
              </div>
              {@const note = catalog.modules.find(m => m.name === analysis?.module)?.sections.find(s => s.name === process.section)?.notes}
              {#if showConf && note}<p class="conf-note">{note}</p>{/if}
            {/each}
            <div class="inline-actions"><button type="button" onclick={() => { const section = catalog.modules.find(m => m.name === analysis?.module)?.sections.find(s => s.name !== 'main'); if (section && analysis) { analysis.processes.push({ section: section.name, parameters: {} }); result = undefined; changed() } }}><Plus size={14} />{$t('Add section')}</button><button type="button" aria-pressed={showConf} onclick={() => { showConf = !showConf }}>{$t('Conf notes')}</button></div>
            {#each [...new Set(fields.map(field => field.group))] as group}
              <div class="parameter-group"><h4>{group.split(' / ').slice(1).join(' / ')}</h4>
                {#each fields.filter(field => field.group === group) as field (field.id)}
                  <div class="parameter" title={field.helps?.[$locale] ?? field.help}>
                    <label for={'builder-parameter-' + field.id}>{field.labels?.[$locale] ?? field.label}{field.unit ? ` (${field.unit})` : ''}</label>
                    <span class="control">
                      {#if field.type === 'select' || field.type === 'boolean'}
                        <select id={'builder-parameter-' + field.id} value={value(field)} onchange={event => update(field, event.currentTarget.value)}>
                          {#if !field.options.some(option => option.value === value(field))}<option value={value(field)}>{value(field) || $t('Conf default')}</option>{/if}
                          {#each field.options as option}<option value={option.value}>{option.labels?.[$locale] ?? option.label}</option>{/each}
                        </select>
                      {:else}<input id={'builder-parameter-' + field.id} value={value(field)} oninput={event => update(field, event.currentTarget.value)} />{/if}
                      {#if field.type === 'file' || field.type === 'directory'}<button type="button" class="icon" aria-label={$t('Choose file')} onclick={() => pick(field)}><FolderInput size={15} /></button>{/if}
                      <button type="button" class="icon" aria-label={$t('Reset parameter')} onclick={() => update(field)}>↺</button>
                    </span>
                  </div>
                {/each}
              </div>
            {/each}
            <h3 class="subheading">{$t('After this analysis')}</h3>
            {#if analysis.commands.length}<label class="parameter"><span>{$t('Command shell')}</span><select bind:value={analysis.shell} onchange={changed}><option value="bash">Bash / Git Bash</option><option value="cmd">Windows cmd</option></select></label>{/if}
            {#each analysis.commands as command, index}
              <div class="command-card">
                <div class="command-heading"><span>{$t(command.kind === 'rename' ? 'Rename output' : 'Shell command')}</span><span class="inline-actions">
                  <button class="icon" type="button" aria-label={$t('Move command up')} disabled={index === 0} onclick={() => analysis && moveCommand(analysis.commands, index, -1)}><ArrowUp size={14} /></button>
                  <button class="icon" type="button" aria-label={$t('Move command down')} disabled={index === analysis.commands.length - 1} onclick={() => analysis && moveCommand(analysis.commands, index, 1)}><ArrowDown size={14} /></button>
                  <button class="icon" type="button" aria-label={$t('Remove command')} onclick={() => { analysis?.commands.splice(index, 1); changed() }}><X size={14} /></button>
                </span></div>
                {#if command.kind === 'rename'}
                  <input aria-label={$t('Original filename')} placeholder="totesp.cub" bind:value={command.source} oninput={changed} />
                  <input aria-label={$t('New filename')} placeholder={'${input}_kcal_esp.cub'} bind:value={command.target} oninput={changed} />
                {:else}<textarea aria-label={$t('Command text')} rows="4" spellcheck="false" bind:value={command.text} oninput={changed}></textarea>{/if}
              </div>
            {/each}
            <div class="inline-actions"><button type="button" onclick={rename}><Plus size={14} />{$t('Rename output')}</button><button type="button" onclick={addCommand}><Plus size={14} />{$t('Shell command')}</button></div>
          {:else if step.kind === 'collect'}
            <label class="stack"><span>{$t('Collection folder template')}</span><input bind:value={step.target} oninput={changed} /></label>
            <p class="hint">{$t('collect moves new files from preceding steps. Collect after the last consumer of an intermediate file.')}</p>
          {:else if step.kind === 'rebase'}
            <label class="stack"><span>{$t('Next startup file template')}</span><input bind:value={step.target} oninput={changed} placeholder={'${input}_NTO1.fch'} /></label>
            <button type="button" onclick={() => { if (step.kind === 'rebase') step.target = ''; changed() }}>{$t('Restore original startup file')}</button>
            <p class="hint">{$t('wfn_rebase changes the input of subsequent analysis blocks. An empty value restores the original file.')}</p>
          {:else if step.kind === 'command'}
            <label class="parameter"><span>{$t('Command shell')}</span><select bind:value={step.shell} onchange={changed}><option value="bash">Bash / Git Bash</option><option value="cmd">Windows cmd</option></select></label>
            <textarea aria-label={$t('Command text')} rows="8" spellcheck="false" bind:value={step.text} oninput={changed}></textarea>
            <p class="hint">{$t('Use analysis post-processing when the command needs ${output}.')}</p>
          {/if}
        </div>
      {/if}
      <details class="variables"><summary>{$t('Custom variables')}</summary><textarea aria-label={$t('Custom variables')} placeholder="state=(1 2)" rows="3" spellcheck="false" bind:value={draft.variables} oninput={changed}></textarea></details>
    </section>
    <section class="preview" aria-label={$t('Generated script')}>
      <div class="preview-heading"><h3>{$t('Preview')}</h3><select aria-label={$t('Builder preview content')} bind:value={nativePreview}><option value={false}>BWC</option><option value={true}>{$t('Multiwfn input')}</option></select></div>
      <pre aria-busy={busy}>{preview || $t('The generated script will appear here.')}</pre>
      {#if result?.inspection.diagnostics.length}<details class="diagnostics"><summary>{$t('Parser notes')}</summary>{#each result.inspection.diagnostics as note}<p>{note}</p>{/each}</details>{/if}
    </section>
  </fieldset>
  <footer>
    <div class="state" role="status">{#if error}<span class="error">{$t(error)}</span>{:else if busy}<span>{$t('Checking script…')}</span>{:else if valid}<Check size={15} /><span>{$t('Checked with BaneWfn')}</span>{/if}</div>
    <button type="button" onclick={onclose} disabled={saving}>{$t('Cancel')}</button>
    <button type="button" class="primary" disabled={!valid || busy || saving} onclick={save}>{$t(saving ? 'Saving…' : 'Save and load')}</button>
  </footer>
</dialog>

<style>
  .builder { width:min(1390px,96vw); height:min(880px,92vh); max-width:none; max-height:none; padding:0; border:1px solid #d7dfe7; border-radius:14px; color:#26374a; background:#fff; box-shadow:0 25px 90px #172b4d40; overflow:hidden; }
  .builder[open] { display:flex; flex-direction:column; }
  .builder::backdrop { background:#15263f66; }
  header,footer { display:flex; align-items:center; gap:10px; padding:14px 20px; flex-shrink:0; }
  header { border-bottom:1px solid #e3e9ef; }
  .heading { display:flex; align-items:center; gap:10px; flex:1; color:#235b81; }
  h2 { margin:0; font-size:18px; font-weight:650; } h3 { font-size:13px; font-weight:650; margin:0 0 12px; } h4 { font-size:12px; font-weight:600; margin:0 0 8px; color:#52677d; }
  button,input,select,textarea { font:inherit; font-size:13px; } button { display:inline-flex; justify-content:center; align-items:center; gap:6px; border:1px solid #d7e0e8; border-radius:6px; padding:7px 10px; background:#fff; color:inherit; cursor:pointer; } button:hover { background:#f0f6fb; } button:disabled { opacity:.45; cursor:default; } button.primary { background:#24618b; color:#fff; border-color:#24618b; } button.primary:hover { background:#194f75; } button.icon { padding:5px; border:0; background:transparent; flex-shrink:0; } :is(input,select,textarea):focus-visible,button:focus-visible { outline:2px solid #5c9bd0; outline-offset:2px; }
  input,select,textarea { border:1px solid #d7e0e8; border-radius:6px; background:#fff; padding:7px; min-width:0; max-width:100%; color:#26374a; } input,select { height:35px; } button { height:auto; min-height:32px; } button.icon { min-height:28px; } textarea { width:100%; resize:vertical; font-family:ui-monospace,monospace; line-height:1.6; } input[type=checkbox] { accent-color:#24618b; width:15px; height:15px; }
  .body { display:grid; grid-template-columns:210px minmax(320px,1.15fr) minmax(260px,1fr); flex:1; min-height:0; min-width:0; margin:0; padding:0; border:0; }
  .palette { background:#f7f9fc; border-right:1px solid #e3e9ef; padding:18px 15px; overflow:auto; display:flex; flex-direction:column; gap:10px; } .palette h3 { margin-bottom:0; } .sections { max-height:210px; min-height:42px; overflow:auto; border:1px solid #e0e6ed; border-radius:7px; background:white; padding:6px; } .conf-section { display:flex; align-items:center; gap:8px; padding:5px; font-size:13px; cursor:pointer; } .conf-section:hover { background:#eff5fa; }
  .glue { display:grid; gap:8px; border-top:1px solid #e0e6ed; padding-top:18px; margin-top:4px; } .glue button { justify-content:flex-start; } .example { margin-top:auto; }
  .editor { padding:18px; overflow:auto; min-width:0; } .step-list { display:grid; gap:6px; } .step-item { display:flex; align-items:center; border:1px solid #e0e6ed; border-radius:7px; padding-right:5px; } .step-item.active { border-color:#77a4c6; background:#eef5fb; } .step-name { flex:1; min-width:0; justify-content:flex-start; text-align:left; background:transparent; border:0; } .step-name>span:last-child { overflow:hidden; text-overflow:ellipsis; } .number { display:grid; place-items:center; border-radius:5px; width:23px; height:23px; color:#446987; background:#e8eff5; font-size:12px; flex-shrink:0; } .count { padding-left:7px; color:#7b8998; }
  .step-settings { margin-top:18px; border-top:1px solid #e4e9ee; padding-top:16px; } .process-row { display:flex; align-items:center; gap:4px; margin:6px 0; } .process-row select { flex:1; } .inline-actions { display:flex; gap:6px; flex-wrap:wrap; } .subheading { margin-top:22px; } .parameter-group { margin-top:15px; } .parameter { display:grid; grid-template-columns:minmax(80px,1fr) minmax(0,1.5fr); align-items:center; gap:8px; margin:9px 0; font-size:13px; } .control { display:flex; min-width:0; gap:3px; } .control input,.control select { width:100%; } .command-card { border:1px solid #e0e6ed; background:#fafbfd; border-radius:8px; padding:10px; display:grid; gap:8px; margin-bottom:10px; } .command-heading { display:flex; align-items:center; justify-content:space-between; font-size:12px; font-weight:600; } .stack { display:grid; gap:8px; margin-bottom:12px; font-size:13px; } .hint { font-size:12px; line-height:1.65; color:#65788b; margin:0; } .conf-note { font-size:12px; white-space:pre-line; padding:8px; color:#536c80; background:#f4f7fa; } .variables { border-top:1px solid #e0e6ed; margin-top:20px; padding-top:12px; font-size:13px; } summary { cursor:pointer; } .variables textarea { margin-top:10px; }
  .preview { background:#f8fafc; border-left:1px solid #e3e9ef; display:flex; flex-direction:column; min-height:0; min-width:0; } .preview-heading { display:flex; align-items:center; justify-content:space-between; padding:14px; border-bottom:1px solid #e3e9ef; gap:8px; } .preview-heading h3 { margin:0; } .preview-heading select { max-width:65%; } pre { flex:1; min-height:0; overflow:auto; font-size:12px; line-height:1.7; font-family:ui-monospace,monospace; padding:15px; margin:0; white-space:pre; } .diagnostics { padding:12px; font-size:12px; max-height:140px; overflow:auto; border-top:1px solid #e0e6ed; }
  footer { border-top:1px solid #e3e9ef; } .state { flex:1; min-width:0; display:flex; align-items:center; gap:6px; font-size:12px; color:#4e7460; } .error { color:#ae3535; } .builder-empty { display:grid; justify-items:center; text-align:center; gap:12px; padding:40px 18px; color:#7b8ea2; font-size:13px; }
  @media(max-width:1000px) { .body { grid-template-columns:180px minmax(280px,1.2fr) minmax(220px,1fr); } .palette,.editor { padding:12px; } }
  @media(max-width:760px) { .builder { height:96vh; width:98vw; } .body { grid-template-columns:160px minmax(0,1fr); overflow:auto; } .preview { grid-column:1 / -1; min-height:220px; max-height:330px; border-top:1px solid #e3e9ef; } .palette,.editor { overflow:visible; } footer { padding:10px; } }
</style>
