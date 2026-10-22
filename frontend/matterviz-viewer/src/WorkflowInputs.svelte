<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { FolderPlus, Files, X, RefreshCw, Trash2 } from '@lucide/svelte'
  import { t } from './i18n'
  import { create_workflow_client, display_path, type BatchInputSet, type BatchRoot, type BatchPlan, type WorkflowStatus } from './workflows'
  export let initial: BatchInputSet
  export let script = ''
  export let parameters: Record<string,string> = {}
  export let bindings: Record<string,string> = {}
  export let variables: string[] = []
  export let onclose: () => void
  export let onselected: (status: WorkflowStatus) => void
  const client=create_workflow_client()
  let dialog: HTMLDialogElement
  let roots: BatchRoot[]=initial.roots.map(root=>({...root,patterns:[...root.patterns]}))
  let explicitFiles=[...(initial.explicitFiles ?? (roots.length?[]:initial.files))]
  let excluded=[...(initial.excluded ?? [])]
  let inputs: BatchPlan['inputs']=initial.files.map(path=>({path,name:display_path(path).split(/[\\/]/).at(-1) ?? path,bindings:{},errors:[]}))
  let chosen=[...initial.files]
  let search=''
  let error=''
  let busy=false
  let valid=true
  let combinations=1
  let previous: HTMLElement | null=null
  let destroyed=false
  $: visible=inputs.filter(item=>display_path(item.path).toLowerCase().includes(search.toLowerCase()))
  const invalidate=():void=>{valid=false}
  const refresh=async():Promise<void>=>{
    busy=true;error='';valid=false
    try {
      const result=await client.batchPlan({script,parameters,variables,bindings,files:explicitFiles,roots})
      if(destroyed)return
      inputs=result.inputs;combinations=result.combinations
      chosen=inputs.filter(item=>!excluded.includes(item.path)&&!item.errors.length).map(item=>item.path)
      valid=true
    }catch(reason){if(!destroyed)error=reason instanceof Error?reason.message:String(reason)}
    finally{if(!destroyed)busy=false}
  }
  const pick=async(kind:'files'|'folder'):Promise<void>=>{
    busy=true;error=''
    try {
      const paths=await client.batchPick(kind)
      if(paths && !destroyed){
        if(kind==='files')explicitFiles=[...new Set([...explicitFiles,...paths])]
        else roots=[...roots,...paths.map(path=>({path,patterns:['*.fch','*.fchk','*.mwfn','*.wfn','*.wfx'],recursive:false}))]
        await refresh()
      }
    }catch(reason){if(!destroyed)error=reason instanceof Error?reason.message:String(reason)}
    finally{if(!destroyed)busy=false}
  }
  const select=(path:string,checked:boolean):void=>{
    chosen=checked?[...chosen,path]:chosen.filter(value=>value!==path)
    excluded=checked?excluded.filter(value=>value!==path):[...new Set([...excluded,path])]
  }
  const apply=async():Promise<void>=>{
    if(!valid||!chosen.length)return
    busy=true
    try {const status=await client.batchSelect({files:chosen,roots,explicitFiles,excluded});if(!destroyed)onselected(status)}
    catch(reason){if(!destroyed)error=reason instanceof Error?reason.message:String(reason)}
    finally{if(!destroyed)busy=false}
  }
  onMount(()=>{previous=document.activeElement instanceof HTMLElement?document.activeElement:null;dialog.showModal();if(initial.files.length)void refresh()})
  onDestroy(()=>{destroyed=true;dialog?.close();queueMicrotask(()=>{if(previous?.isConnected)previous.focus()})})
</script>

<dialog bind:this={dialog} class="input-modal" aria-labelledby="input-title" oncancel={event=>{event.preventDefault();if(!busy)onclose()}}>
  <header><div><h2 id="input-title">{$t('Batch input files')}</h2><p>{$t('Match files, review the list, then select the inputs to run.')}</p></div><button type="button" class="icon" aria-label={$t('Close input selection')} disabled={busy} onclick={onclose}><X size={19}/></button></header>
  <div class="sources">
    <div class="actions"><button type="button" disabled={busy} onclick={()=>pick('files')}><Files size={16}/>{$t('Add files')}</button><button type="button" disabled={busy} onclick={()=>pick('folder')}><FolderPlus size={16}/>{$t('Add folder rule')}</button><button type="button" disabled={busy||(!roots.length&&!explicitFiles.length)} onclick={refresh}><RefreshCw size={15}/>{$t('Refresh matches')}</button></div>
    {#each roots as root,index}
      <div class="root-rule"><span title={display_path(root.path)}>{display_path(root.path)}</span><input aria-label={$t('Filename patterns')} value={root.patterns.join('; ')} placeholder={$t('Blank uses the script wfn pattern')} disabled={busy} oninput={event=>{root.patterns=event.currentTarget.value.split(';').map(s=>s.trim()).filter(Boolean);invalidate()}}/><label><input type="checkbox" bind:checked={root.recursive} disabled={busy} onchange={invalidate}/>{$t('Subfolders')}</label><button class="icon" type="button" aria-label={$t('Remove folder rule')} disabled={busy} onclick={()=>{roots=roots.filter((_,i)=>i!==index);invalidate()}}><Trash2 size={15}/></button></div>
    {/each}
    {#if explicitFiles.length}<p class="explicit">{$t('{count} individually selected files',{count:explicitFiles.length})}<button type="button" disabled={busy} onclick={()=>{explicitFiles=[];void refresh()}}>{$t('Clear individual files')}</button></p>{/if}
  </div>
  <div class="list-tools"><label><input type="checkbox" aria-label={$t('Select all matching inputs')} disabled={busy||!valid} checked={inputs.length>0&&chosen.length===inputs.filter(i=>!i.errors.length).length} onchange={event=>{for(const item of inputs.filter(i=>!i.errors.length))select(item.path,event.currentTarget.checked)}}/>{$t('Select all')}</label><input aria-label={$t('Search input files')} placeholder={$t('Search input files')} bind:value={search}/><span>{$t('{selected} / {total} selected',{selected:chosen.length,total:inputs.length})}</span></div>
  <div class="input-list" aria-busy={busy}>
    {#each visible as item (item.path)}
      <label class="input-entry" class:invalid={item.errors.length>0}><input type="checkbox" aria-label={`${$t('Select input')}: ${item.name}`} checked={chosen.includes(item.path)} disabled={busy||!valid||item.errors.length>0} onchange={event=>select(item.path,event.currentTarget.checked)}/><span><strong>{item.name}</strong><span class="path" title={display_path(item.path)}>{display_path(item.path)}</span>{#if item.errors.length}<span class="input-error">{item.errors.join('\n')}</span>{/if}{#each Object.entries(item.bindings) as [id,path]}<span class="path" title={display_path(path)}>{id.split('/').at(-1)}: {display_path(path)}</span>{/each}</span></label>
    {/each}
    {#if !inputs.length}<div class="input-empty"><Files size={30}/><p>{$t('Add files or a folder rule to build the input list.')}</p></div>{/if}
  </div>
  <footer><span role="status" class:error={!!error}>{error?$t(error):busy?$t('Matching files…'):!valid?$t('Refresh matches after changing a rule.'):$t('{count} variable combinations per input',{count:combinations})}</span><button type="button" disabled={busy} onclick={onclose}>{$t('Cancel')}</button><button type="button" class="primary" disabled={busy||!valid||!chosen.length} onclick={apply}>{$t('Use selected files')}</button></footer>
</dialog>

<style>
  .input-modal {width:min(1000px,94vw);height:min(800px,90vh);max-width:none;max-height:none;border:1px solid #d6e0e9;border-radius:13px;padding:0;color:#263b50;background:#fff;overflow:hidden;box-shadow:0 20px 80px #152b4c44;}.input-modal[open]{display:flex;flex-direction:column;}.input-modal::backdrop{background:#172a4366;}header,footer{display:flex;align-items:center;gap:10px;padding:16px 20px;flex-shrink:0;}header{border-bottom:1px solid #e1e8ef;justify-content:space-between;}h2{font-size:18px;font-weight:650;margin:0;}header p{margin:5px 0 0;color:#687b8d;font-size:13px;}button,input{font:inherit;font-size:13px;}button{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:auto;min-height:34px;padding:7px 11px;border:1px solid #d7e0e8;border-radius:6px;background:white;color:inherit;cursor:pointer;}button:disabled{opacity:.45;cursor:default;}button.primary{background:#24618b;color:#fff;border-color:#24618b;}button.icon{border:0;padding:5px;}input{height:35px;padding:7px;border:1px solid #d7e0e8;border-radius:6px;background:white;min-width:0;color:inherit;}input[type=checkbox]{height:15px;width:15px;accent-color:#24618b;flex-shrink:0;}button:focus-visible,input:focus-visible{outline:2px solid #5b9bd0;outline-offset:2px;}.sources{padding:16px 20px;background:#f7f9fc;border-bottom:1px solid #e1e8ef;max-height:280px;overflow:auto;flex-shrink:0;}.actions{display:flex;gap:8px;flex-wrap:wrap;}.root-rule{display:grid;grid-template-columns:minmax(100px,1fr) minmax(160px,1fr) auto auto;gap:10px;align-items:center;margin-top:12px;font-size:13px;}.root-rule>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.root-rule label,.list-tools label{display:flex;align-items:center;gap:7px;}.explicit{display:flex;align-items:center;gap:10px;font-size:12px;color:#667b8e;margin:12px 0 0;}.explicit button{font-size:12px;min-height:28px;padding:3px 8px;}.list-tools{display:flex;align-items:center;gap:15px;padding:12px 20px;font-size:13px;}.list-tools>input{flex:1;}.list-tools>span{color:#647b90;}.input-list{min-height:0;flex:1;overflow:auto;border-top:1px solid #e3e9ef;}.input-entry{display:flex;align-items:flex-start;gap:12px;padding:12px 20px;border-bottom:1px solid #edf1f5;cursor:pointer;font-size:13px;}.input-entry>input{margin-top:3px;}.input-entry>span{display:grid;gap:3px;min-width:0;}.input-entry strong{font-weight:550;}.path{color:#6c7e91;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.invalid{background:#fff8f5;}.input-error{color:#b14c3e;white-space:pre-line;font-size:12px;}.input-empty{display:grid;justify-items:center;gap:12px;padding:50px 20px;color:#7a8fa4;font-size:13px;}footer{border-top:1px solid #e1e8ef;}footer>span{flex:1;font-size:12px;color:#6b7f92;}footer>span.error{color:#b1433e;}@media(max-width:650px){.root-rule{grid-template-columns:minmax(0,1fr) auto;}.root-rule>input{grid-column:1;grid-row:2;}.list-tools{flex-wrap:wrap;}}
</style>
