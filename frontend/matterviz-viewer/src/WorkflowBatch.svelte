<script lang="ts">
  import { t } from './i18n'
  import { batch_active, display_path, type BatchStatus } from './workflows'
  import { FolderOpen, Pause, Play, RotateCcw, Square } from '@lucide/svelte'
  export let batch: BatchStatus
  export let busy=false
  export let onview: (id:string)=>void
  export let oncontrol: (action:string,id?:string)=>void
  export let onfolder: ()=>void
  let search=''
  let filter='all'
  $: active=batch_active(batch)
  $: cases=batch.cases.filter(item=>(filter==='all'||item.state===filter)&&item.path.toLowerCase().includes(search.toLowerCase()))
  $: finished=batch.cases.filter(item=>!['waiting','running','cancelling'].includes(item.state)).length
  const elapsed=(start:number|null,end:number|null):string=>start?`${Math.max(0,Math.round(((end??Date.now())-start)/1000))} s`:'—'
</script>
<div class="batch-overview">
  <div class="batch-heading"><div><h3>{$t('Batch overview')}</h3><p>{batch.script} · {$t('{count} inputs',{count:batch.cases.length})} · {$t('{count} variable combinations per input',{count:batch.combinations})}</p></div><button type="button" disabled={busy} onclick={onfolder}><FolderOpen size={15}/>{$t('Open folder')}</button></div>
  <div class="batch-progress"><progress max={batch.cases.length||1} value={finished}></progress><span>{finished} / {batch.cases.length}</span></div>
  <div class="batch-counts">{#each ['completed','failed','running','waiting','cancelled','prepared','interrupted'] as state}{#if batch.counts[state]}<span class:failed={state==='failed'}>{$t(state)} <strong>{batch.counts[state]}</strong></span>{/if}{/each}</div>
  <div class="batch-tools"><input aria-label={$t('Search batch inputs')} placeholder={$t('Search batch inputs')} bind:value={search}/><select aria-label={$t('Filter batch state')} bind:value={filter}><option value="all">{$t('All states')}</option>{#each ['completed','failed','running','waiting','cancelled','prepared','interrupted'] as state}<option value={state}>{$t(state)}</option>{/each}</select>
    {#if active}<button type="button" disabled={busy||batch.state==='cancelling'} onclick={()=>oncontrol(batch.state==='paused'||batch.state==='pausing'?'resume':'pause')}>{#if batch.state==='paused'||batch.state==='pausing'}<Play size={15}/>{$t('Resume queue')}{:else}<Pause size={15}/>{$t('Pause queue')}{/if}</button><button type="button" disabled={busy||batch.state==='cancelling'} onclick={()=>oncontrol('cancel')}><Square size={14}/>{$t('Cancel batch')}</button>
    {:else}<button type="button" disabled={busy||!batch.cases.some(item=>['failed','cancelled','interrupted','waiting'].includes(item.state))} onclick={()=>oncontrol('retry')}><RotateCcw size={15}/>{$t('Retry unfinished')}</button>{/if}
  </div>
  {#if batch.message}<p class="batch-error" role="alert">{batch.message}</p>{/if}
  <div class="batch-table"><table><thead><tr><th>{$t('Input file')}</th><th>{$t('Status')}</th><th>{$t('Elapsed')}</th><th>{$t('Actions')}</th></tr></thead><tbody>
    {#each cases as item (item.id)}<tr><td><button type="button" class="input-name" disabled={!item.attempts||busy} title={display_path(item.path)} onclick={()=>onview(item.id)}>{item.name}</button><span class="source-path" title={display_path(item.path)}>{display_path(item.path)}</span>{#if item.message}<span class="item-error" title={item.message}>{item.message}</span>{/if}</td><td><span class="state" class:failed={item.state==='failed'} class:completed={item.state==='completed'}>{$t(item.state)}</span></td><td>{elapsed(item.started,item.finished)}</td><td><button type="button" disabled={!item.attempts||busy} onclick={()=>onview(item.id)}>{$t('View results')}</button>{#if !active&&['failed','cancelled','interrupted'].includes(item.state)}<button type="button" disabled={busy} onclick={()=>oncontrol('retry',item.id)}>{$t('Retry')}</button>{/if}</td></tr>{/each}
  </tbody></table></div>
  <p class="batch-path" title={display_path(batch.directory)}>{display_path(batch.directory)}</p>
</div>
<style>
  .batch-overview{display:flex;flex-direction:column;min-height:0;flex:1;padding:22px 24px;gap:14px;}.batch-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;}.batch-heading h3{font-size:16px;margin:0;font-weight:650;}.batch-heading p{font-size:12px;color:#6b7d90;margin:5px 0 0;}button,input,select{font:inherit;font-size:13px;}button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:33px;height:auto;padding:6px 9px;border:1px solid #d7e0e8;border-radius:6px;background:#fff;color:inherit;cursor:pointer;}button:disabled{opacity:.45;cursor:default;}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #5c9bd0;outline-offset:2px;}.batch-progress{display:flex;align-items:center;gap:12px;font-size:12px;color:#61778c;}.batch-progress progress{appearance:none;height:7px;flex:1;border:0;border-radius:4px;overflow:hidden;background:#e9eff5;}.batch-progress progress::-webkit-progress-bar{background:#e9eff5;}.batch-progress progress::-webkit-progress-value{background:#447f9e;}.batch-counts{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:#647c8f;}.batch-counts strong{color:#243f55;padding-left:3px;}.batch-tools{display:flex;gap:8px;flex-wrap:wrap;}.batch-tools input,.batch-tools select{height:35px;border:1px solid #d7e0e8;border-radius:6px;padding:7px;background:#fff;color:inherit;min-width:0;}.batch-tools input{flex:1;min-width:100px;}.batch-table{min-height:0;overflow:auto;border:1px solid #dfe7ee;border-radius:8px;flex:1;}table{border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed;}th{position:sticky;top:0;background:#f6f9fc;text-align:left;color:#5d748a;font-weight:550;padding:11px 12px;border-bottom:1px solid #e1e8ef;}th:first-child{width:49%;}th:nth-child(2){width:16%;}th:nth-child(3){width:12%;}th:last-child{width:23%;}td{padding:12px;border-bottom:1px solid #edf1f6;vertical-align:top;}td:last-child button{margin:0 5px 5px 0;font-size:12px;}.input-name{border:0;background:transparent;padding:0;min-height:22px;display:block;text-align:left;font-weight:550;width:100%;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;}.source-path,.item-error{display:block;font-size:11px;color:#748799;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px;}.item-error,.batch-error,.failed{color:#ac443f;}.state{display:inline-block;padding:3px 6px;background:#f0f4f8;border-radius:5px;}.state.completed{color:#307555;background:#edf6f0;}.batch-error{font-size:12px;}.batch-path{font-size:11px;color:#75899b;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .batch-table > table { display: table; overflow: visible; }
  .batch-table tbody tr:nth-child(odd) { background: #f8fafc; }
  .batch-table th, .batch-table td { border-left: 0; border-right: 0; border-top: 0; }
</style>
