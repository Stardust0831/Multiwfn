<script lang="ts">
  import { Icon } from 'matterviz'
  import AnalysisAction from './AnalysisAction.svelte'
  import { AIM_DEFAULTS, CP_NAMES, CP_COLORS, topology_position, topology_path_points, topology_path_length, type AimOptions, type TopologyResult, type TopologySelection, type TopologyDisplay } from './topology'
  let { options = $bindable({ ...AIM_DEFAULTS }), display = $bindable(), active = $bindable(false), result, selection = $bindable(), busy, reason, cell, onrun, onclose, onexport }:
    { options: AimOptions; display: TopologyDisplay; active: boolean; result?: TopologyResult; selection: TopologySelection; busy: boolean; reason: string; cell?: number[][]; onrun: () => void; onclose: () => void; onexport: (format: 'json' | 'csv') => void } = $props()
  const selectedCP = $derived(selection?.kind === 'cp' ? result?.metadata.criticalPoints.find((cp) => cp.id === selection?.id) : undefined)
  const selectedPath = $derived(selection?.kind === 'path' ? result?.metadata.paths.find((path) => path.id === selection?.id) : undefined)
</script>

<aside class="topology-panel" aria-label="AIM topology analysis">
  <header><strong>Topology analysis (AIM)</strong><button type="button" title="Close panel" aria-label="Close topology panel" onclick={onclose}><Icon icon="Cross" width="16" /></button></header>
  <div class="body">
    <details><summary>Search settings</summary>
      <fieldset disabled={busy}>
        {#each ['Nuclear positions', 'Atomic pair midpoints', 'Three-atom centers', 'Four-atom centers'] as label, index}
          <label class="check"><input type="checkbox" checked={Boolean(options.seeds & (1 << index))} onchange={(event) => options = { ...options, seeds: event.currentTarget.checked ? options.seeds | (1 << index) : options.seeds & ~(1 << index) }} />{label}</label>
        {/each}
        {#each [
          { key: 'distance', label: 'Distance factor', min: 0.1, max: 5, step: 0.1 },
          { key: 'gradient', label: 'Gradient threshold (a.u.)', min: 1e-12, max: 1e-2, step: 'any' },
          { key: 'displacement', label: 'Displacement (Bohr)', min: 1e-12, max: 1e-2, step: 'any' },
          { key: 'cycles', label: 'Maximum iterations', min: 1, max: 1000, step: 1 },
          { key: 'step', label: 'Path step (Bohr)', min: 1e-4, max: 0.2, step: 0.005 },
          { key: 'pathPoints', label: 'Maximum path points', min: 3, max: 1499, step: 1 },
        ] as field}
          <label class="field"><span>{field.label}</span><input type="number" min={field.min} max={field.max} step={field.step} value={options[field.key as keyof AimOptions]} oninput={(event) => options = { ...options, [field.key]: event.currentTarget.valueAsNumber }} /></label>
        {/each}
      </fieldset>
    </details>
    <AnalysisAction reason={reason || (options.seeds === 0 ? 'Select at least one starting-point method' : '')} {busy} onclick={onrun}>{busy ? 'Calculating...' : result ? 'Recalculate AIM' : 'Run AIM analysis'}</AnalysisAction>
    {#if reason}<p class="reason">{reason}</p>{/if}
    {#if result}
      <label class="check"><input type="checkbox" bind:checked={active} />Topology view</label>
      <div class="counts">{result.metadata.criticalPoints.length} CPs · {result.metadata.paths.length} paths</div>
      <div class="reason">{result.metadata.functionId === 1 ? 'Electron density (AIM)' : `Real-space function ${result.metadata.functionId}`}</div>
      <div class="filters">
        {#each CP_NAMES.slice(1) as label, index}<label class="check"><input type="checkbox" bind:checked={display.cpTypes[index + 1]} /><i style={`background:${CP_COLORS[index + 1]}`}></i>{label}</label>{/each}
      </div>
      <label class="check"><input type="checkbox" bind:checked={display.pathTypes[1]} />(3,-1) to (3,-3) paths</label>
      <label class="check"><input type="checkbox" bind:checked={display.pathTypes[2]} />(3,+1) to (3,+3) paths</label>
      {#if result.metadata.paths.some((path) => path.type === 3)}<label class="check"><input type="checkbox" bind:checked={display.pathTypes[3]} />(3,-1) to (3,+1) paths</label>{/if}
      {#if result.metadata.paths.some((path) => path.type === 0)}<label class="check"><input type="checkbox" bind:checked={display.pathTypes[0]} />Other paths</label>{/if}
      {#if result.metadata.criticalPoints.some((cp) => cp.type === 0)}<label class="check"><input type="checkbox" bind:checked={display.cpTypes[0]} />Unclassified CPs</label>{/if}
      <label class="check"><input type="checkbox" bind:checked={display.labels} />CP and path numbers</label>
      <label class="field"><span>CP radius (Å)</span><input type="range" min="0.03" max="0.3" step="0.01" bind:value={display.radius} /></label>
      <label class="field"><span>Path width</span><input type="range" min="1" max="6" step="0.5" bind:value={display.width} /></label>
      <label class="field"><span>Inspect</span><select aria-label="Inspect topology object" value={selection ? `${selection.kind}:${selection.id}` : ''} onchange={(event) => { const [kind, id] = event.currentTarget.value.split(':'); selection = id ? { kind: kind as 'cp' | 'path', id: Number(id) } : undefined }}>
        <option value="">None</option>
        {#each result.metadata.criticalPoints as cp}<option value={`cp:${cp.id}`}>CP {cp.id} {CP_NAMES[cp.type]}</option>{/each}
        {#each result.metadata.paths as path}<option value={`path:${path.id}`}>Path {path.id}: CP {path.start} → {path.end}</option>{/each}
      </select></label>
      {#if selectedCP}
        <section class="readout"><strong>CP {selectedCP.id} {CP_NAMES[selectedCP.type]}</strong><p>{topology_position(result, selectedCP.id - 1).map((v) => v.toFixed(6)).join(', ')} Å</p>
          {#if result.metadata.hasDensity}<p>ρ {selectedCP.density.toExponential(6)} a.u.</p><p>∇²ρ {selectedCP.laplacian.toExponential(6)} a.u.</p>{/if}
        </section>
      {:else if selectedPath}
        <section class="readout"><strong>Path {selectedPath.id}</strong><p>CP {selectedPath.start || '?'} → CP {selectedPath.end || '?'}</p><p>{topology_path_length(topology_path_points(result, selectedPath, cell)).toFixed(6)} Å</p></section>
      {/if}
      <p class="reason">N − B + R − C = {result.metadata.eulerCount}. This count alone does not establish a complete search.</p>
      {#if result.metadata.missingPathDirections}<p class="reason">{result.metadata.missingPathDirections} path directions did not reach a located CP.</p>{/if}
      <div class="exports"><button type="button" onclick={() => onexport('csv')}><Icon icon="Download" width="14" />CSV</button><button type="button" onclick={() => onexport('json')}><Icon icon="Download" width="14" />Topology JSON</button></div>
    {/if}
  </div>
</aside>

<style>
  .topology-panel{width:288px;min-width:0;background:#fff;color:#263238;border-right:1px solid #dce2e5;overflow:auto;flex-shrink:0;max-height:100%;font-size:12px}
  header{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid #dce2e5;gap:8px}
  header strong{font-size:13px}button{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid #cdd5da;border-radius:4px;background:#f5f7f8;color:inherit;min-height:28px;cursor:pointer}
  header button{width:28px;flex-shrink:0}button:disabled{opacity:.45;cursor:not-allowed}.body{padding:12px;display:grid;gap:12px}summary{cursor:pointer;font-weight:600}fieldset{border:0;padding:10px 0 0;display:grid;gap:9px;min-width:0}.check{display:flex;align-items:center;gap:6px;min-width:0}.field{display:grid;grid-template-columns:minmax(0,1fr) 104px;gap:8px;align-items:center}.field input,.field select{min-width:0;width:100%;box-sizing:border-box}input[type=number],select{font:inherit;padding:4px}.filters{display:grid;grid-template-columns:1fr 1fr;gap:6px}i{width:8px;height:8px;border-radius:50%}.counts{font-weight:600}.reason{font-size:11px;line-height:1.5;color:#57656c;margin:0;overflow-wrap:anywhere}.readout{border-top:1px solid #dce2e5;border-bottom:1px solid #dce2e5;padding:10px 0;overflow-wrap:anywhere}.readout p{margin:6px 0}.exports{display:flex;gap:8px}
  @media(max-width:760px){.topology-panel{width:100%;max-height:42vh;border-right:0;border-bottom:1px solid #dce2e5}.body{gap:9px}.field{grid-template-columns:minmax(0,1fr) 120px}}
</style>
