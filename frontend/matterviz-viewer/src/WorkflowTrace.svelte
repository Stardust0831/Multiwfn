<script lang="ts">
  import {onDestroy} from 'svelte'
  import {ChevronDown, ChevronRight, ExternalLink, GitBranch, RotateCcw, Terminal} from '@lucide/svelte'
  import {t} from './i18n'
  import {create_workflow_client, display_path, workflow_active, type WorkflowJob, type WorkflowScope, type WorkflowTrace, type WorkflowStepLog} from './workflows'
  export let job: WorkflowJob
  export let scope: WorkflowScope | undefined = undefined
  const client=create_workflow_client()
  let trace:WorkflowTrace|undefined
  let selectedGroup=''
  let manualGroup=false
  let selectedStep:number|null=null
  let logSource:'driver'|'multiwfn'='driver'
  let stepLog:WorkflowStepLog|undefined
  let error=''
  let expanded=true
  let loading=false
  let generation=0
  let graphGeneration=0
  let logGeneration=0
  let timer:ReturnType<typeof setTimeout>|undefined
  let destroyed=false
  let identity=''
  let width=760
  let viewer:HTMLPreElement|undefined
  $: group=trace?.groups.find(group=>group.id===selectedGroup)
  $: nodes=group?.nodes??[]
  $: columns=Math.max(1,Math.min(3,Math.floor((width+24)/210)))
  $: cardWidth=(width-(columns-1)*24)/columns
  const cardHeight=100,rowGap=30
  $: graphHeight=Math.ceil(nodes.length/columns)*(cardHeight+rowGap)-rowGap
  const position=(index:number,cols:number,cw:number):{x:number;y:number}=>{const row=Math.floor(index/cols),column=row%2?cols-1-index%cols:index%cols;return{x:column*(cw+24),y:row*(cardHeight+rowGap)}}
  const edge=(index:number,cols:number,cw:number):string=>{
    const a=position(index,cols,cw),b=position(index+1,cols,cw)
    if(a.y!==b.y)return `M${a.x+cw/2},${a.y+cardHeight} V${b.y-6}`
    const right=b.x>a.x
    return `M${a.x+(right?cw:0)},${a.y+cardHeight/2} H${b.x+(right?-6:cw+6)}`
  }
  const stateLabel=(state:string):string=>state==='not-run'?'Not run':state
  const phases:Record<string,string>={multiwfn:'Multiwfn calculation',command:'Shell command',grep:'Text extraction',collect:'Collect outputs',rebase:'Change startup file',builtin:'Builtin analysis',citations:'Citations',validation:'Validation',tracking:'Track outputs'}
  const phaseLabel=(phase:string):string=>phases[phase]??phase
  const elapsed=(started:number|null,finished:number|null):string=>started?`${Math.max(0,Math.round(((finished??Date.now())-started)/1000))} s`:''
  const groupLabel=(value:NonNullable<WorkflowTrace>['groups'][number]):string=>{
    const name=display_path(value.file).split(/[\\/]/).at(-1)
    const vars=Object.entries(value.variables).map(([k,v])=>`${k}=${v}`).join(', ')
    return [name,`${value.combination} / ${value.combinations}`,vars].filter(Boolean).join(' · ')
  }
  const loadLog=async(scroll=false):Promise<void>=>{
    if(selectedStep===null||!selectedGroup)return
    const own=++logGeneration
    loading=true;error=''
    try{
      const next=await client.stepLog(job.directory,selectedGroup,selectedStep,logSource,scope)
      if(destroyed||own!==logGeneration)return
      stepLog=next
      if(scroll)viewer?.scrollTo({top:0,left:0})
    }catch(reason){if(!destroyed&&own===logGeneration)error=reason instanceof Error?reason.message:String(reason)}
    finally{if(own===logGeneration)loading=false}
  }
  const choose=(index:number):void=>{selectedStep=index;logSource='driver';stepLog=undefined;void loadLog(true)}
  const clearLog=():void=>{selectedStep=null;stepLog=undefined;error='';loading=false;logGeneration++}
  const refresh=async(own:number):Promise<void>=>{
    const request=++graphGeneration
    if(timer)clearTimeout(timer)
    try{
      const next=await client.trace(job.directory,scope)
      if(destroyed||own!==generation||request!==graphGeneration)return
      trace=next
      if(!manualGroup||!next.groups.some(group=>group.id===selectedGroup)){
        const preferred=workflow_active(job)?next.groups.at(-1):next.groups.find(group=>group.nodes.some(node=>node.state==='failed'))??next.groups.at(-1)
        if(preferred&&selectedGroup!==preferred.id){selectedGroup=preferred.id;clearLog()}
      }
      if(selectedStep!==null)await loadLog()
    }catch(reason){if(!destroyed&&own===generation&&request===graphGeneration)error=reason instanceof Error?reason.message:String(reason)}
    finally{if(!destroyed&&own===generation&&request===graphGeneration&&workflow_active(job))timer=setTimeout(()=>void refresh(own),900)}
  }
  $: {
    const next=JSON.stringify([job.directory,scope?.batch,scope?.item,scope?.attempt])
    if(next!==identity){identity=next;generation++;trace=undefined;manualGroup=false;selectedGroup='';clearLog();void refresh(generation)}
  }
  // Fetch terminal observations once more when the parent sees process exit.
  let previousState=''
  $: if(job.state!==previousState){previousState=job.state;void refresh(generation)}
  onDestroy(()=>{destroyed=true;generation++;logGeneration++;if(timer)clearTimeout(timer)})
</script>

<div class="trace-view">
  {#if trace?.available}
    <section class="trace-graph" aria-label={$t('Workflow DAG')}>
      <div class="trace-heading">
        <button type="button" class="trace-collapse" aria-expanded={expanded} onclick={()=>expanded=!expanded}>{#if expanded}<ChevronDown size={15}/>{:else}<ChevronRight size={15}/>{/if}<GitBranch size={16}/>{$t('Workflow DAG')}<span>{$t('Execution order')}</span></button>
        {#if group?.nodes.some(node=>node.state==='failed')}<button type="button" class="find-failure" onclick={()=>choose(nodes.findIndex(node=>node.state==='failed'))}>{$t('Locate failed step')}</button>{/if}
      </div>
      {#if expanded}
        {#if trace.groups.length>1}<select class="trace-group" aria-label={$t('Variable combination')} value={selectedGroup} onchange={event=>{selectedGroup=event.currentTarget.value;manualGroup=true;clearLog()}}>{#each trace.groups as value}<option value={value.id}>{groupLabel(value)}</option>{/each}</select>{/if}
        {#if trace.truncated}<p class="trace-note">{$t('Showing recent execution groups.')}</p>{/if}
        <div class="trace-scroll">
          <div class="trace-canvas" bind:clientWidth={width} style:height={`${Math.max(0,graphHeight)}px`}>
            <svg width="100%" height={Math.max(0,graphHeight)} aria-hidden="true"><defs><marker id="trace-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L6,3.5 L0,7" fill="#a7b7c6"/></marker></defs>{#each nodes.slice(0,-1) as _,index}<path d={edge(index,columns,cardWidth)} fill="none" stroke="#a7b7c6" stroke-width="1.5" marker-end="url(#trace-arrow)"/>{/each}</svg>
            {#each nodes as node,index}
              {@const step=trace.steps[index]}
              {@const pos=position(index,columns,cardWidth)}
              <button type="button" class="trace-node" class:failed={node.state==='failed'} class:completed={node.state==='completed'} class:running={node.state==='running'} class:chosen={selectedStep===index} disabled={node.start===null||node.start<0} aria-label={$t('Step {number}: {name}',{number:index+1,name:step.label})} title={[step.label,step.sections.join(' · '),step.command,step.origin].filter(Boolean).join('\n')} style:left={`${pos.x}px`} style:top={`${pos.y}px`} style:width={`${cardWidth}px`} style:height={`${cardHeight}px`} onclick={()=>choose(index)}>
                <span class="node-top"><span class="node-number">{index+1}</span><span>{$t(phaseLabel(step.kind))}</span><span class="node-time">{elapsed(node.started,node.finished)}</span></span>
                <strong>{step.label}</strong>
                {#if step.sections.length||step.command}<span class="node-sections">{step.sections.length?step.sections.join(' · '):step.command}</span>{/if}
                <span class="node-bottom"><span class="state-dot"></span>{$t(stateLabel(node.state))}{#if node.failedPhase}<span>· {$t(phaseLabel(node.failedPhase))}</span>{:else if node.state==='running'&&node.phase}<span>· {$t(phaseLabel(node.phase))}</span>{/if}<ExternalLink size={12}/></span>
              </button>
            {/each}
          </div>
          {#if !nodes.length}<p class="trace-note">{$t('Waiting for execution steps…')}</p>{/if}
        </div>
      {/if}
    </section>
  {:else if trace}<div class="trace-unavailable">{$t('No step record is available for this run.')}</div>{/if}
  {#if selectedStep!==null}
    <div class="step-log-heading"><Terminal size={14}/><span>{$t('Step {number}',{number:selectedStep+1})} · {trace?.steps[selectedStep]?.label}</span><select aria-label={$t('Step log source')} bind:value={logSource} onchange={()=>{stepLog=undefined;void loadLog(true)}}><option value="driver">{$t('Workflow log')}</option>{#if nodes[selectedStep]?.output}<option value="multiwfn">{$t('Multiwfn output')}</option>{/if}</select><button type="button" onclick={clearLog}><RotateCcw size={13}/>{$t('All logs')}</button></div>
    {#if stepLog}<p class="step-log-file">{stepLog.file}{#if stepLog.truncated}<span>{$t('Showing the last 256 KiB of this step.')}</span>{/if}</p>{/if}
  {/if}
  {#if error}<p class="trace-error" role="alert">{$t(error)}</p>{/if}
  <pre class="workflow-log step-log" bind:this={viewer} aria-label={$t(selectedStep===null?'Workflow log':'Step log')} aria-busy={loading}>{selectedStep===null?job.log:stepLog?.text??(loading?$t('Loading log…'):'')}</pre>
</div>

<style>
  .trace-view{display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden;}
  .trace-graph{flex-shrink:0;display:flex;flex-direction:column;min-height:0;max-height:55%;border-bottom:1px solid #dce5ed;background:#f8fafc;}
  button,select{font:inherit;color:inherit;}button{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #d7e2ec;border-radius:6px;padding:5px 8px;font-size:12px;cursor:pointer;}button:focus-visible,select:focus-visible{outline:2px solid #407d9b;outline-offset:2px;}
  .trace-heading{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;gap:10px;}
  .trace-collapse{border:0;background:transparent;padding:0;font-weight:600;}.trace-collapse span{font-size:11px;color:#718397;font-weight:400;margin-left:5px;}.find-failure{color:#ac3935;border-color:#e8c5c1;flex-shrink:0;}
  .trace-group{margin:0 18px 10px;padding:5px 8px;border:1px solid #d4e0ea;border-radius:5px;background:#fff;min-width:0;font-size:12px;}
  .trace-scroll{overflow:auto;min-height:0;padding:2px 18px 15px;}.trace-canvas{position:relative;min-width:0;}.trace-canvas svg{position:absolute;inset:0;pointer-events:none;}
  .trace-node{position:absolute;display:flex;flex-direction:column;gap:4px;text-align:left;align-items:stretch;padding:9px 11px;box-sizing:border-box;border:1px solid #d7e1eb;background:#fff;color:#3b5063;overflow:hidden;}
  .trace-node:disabled{cursor:default;opacity:.65;}.trace-node.running{border-color:#70acc3;background:#f1f9fc;}.trace-node.failed{border-color:#dfa09a;background:#fff5f3;color:#a73b35;}.trace-node.completed{border-color:#b3d4c2;}.trace-node.chosen{box-shadow:0 0 0 2px #3e7c9b;}
  .node-top{display:flex;align-items:center;gap:7px;font-size:10px;color:#6c8195;}.node-number{border-radius:4px;background:#edf2f7;min-width:17px;height:16px;text-align:center;padding:0 2px;}.node-time{margin-left:auto;}.trace-node strong{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.node-sections{font-size:10px;color:#72869a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .node-bottom{display:flex;align-items:center;gap:5px;font-size:10px;margin-top:auto;white-space:nowrap;}.node-bottom :global(svg){margin-left:auto;flex-shrink:0;}.state-dot{width:6px;height:6px;border-radius:50%;background:#aab8c5;flex-shrink:0;}.completed .state-dot{background:#519273;}.failed .state-dot{background:#c75043;}.running .state-dot{background:#2a8cae;}
  .trace-note,.trace-unavailable{font-size:11px;color:#718398;margin:0;padding:8px 18px;}.trace-error{font-size:12px;color:#b5423d;margin:0;padding:8px 18px;}.step-log-heading{display:flex;gap:8px;align-items:center;padding:9px 18px;border-bottom:1px solid #e5ebf0;flex-shrink:0;font-size:12px;min-width:0;}.step-log-heading>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1;}.step-log-heading select{font-size:12px;border:1px solid #d8e1e9;background:#fff;border-radius:4px;max-width:145px;padding:4px;}.step-log-file{font-size:10px;margin:0;padding:6px 18px;color:#6c8195;}.step-log-file span{margin-left:10px;}
  .step-log{flex:1;min-height:90px;margin:0;padding:16px 20px;overflow:auto;white-space:pre;font:12px/1.65 'Cascadia Code',Consolas,monospace;background:#fff;color:#294258;tab-size:4;}
</style>
