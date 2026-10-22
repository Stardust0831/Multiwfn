import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1320,height:920},locale:'zh-CN'})
page.setDefaultTimeout(12000)
const artifacts=process.env.ARTIFACT_DIR||'/tmp/banewfn-trace-browser'
await mkdir(artifacts,{recursive:true})
const errors=[];page.on('pageerror',error=>errors.push(error.message))
const directory='D:/cases/results/workflow-1'
const job={directory,state:'failed',exitCode:1,message:'',log:'FULL WORKFLOW LOG\nall steps\n',files:['grid_sample.out','workflow.log']}
const status={format:'multiwfn-workflows',version:1,available:true,runner:'runner',multiwfn:'engine',library:'scripts',wavefunction:'D:/cases/sample.fch',results:'D:/cases/results',scripts:[{id:'ESP.bwc',name:'ESP.bwc'}],selectedScript:'ESP.bwc',catalogError:null,job,batch:null}
const steps=[
 {label:'grid',kind:'multiwfn',sections:['electron'],origin:'',command:''},
 {label:'grid',kind:'multiwfn',sections:['esp'],origin:'',command:''},
 {label:'%command',kind:'command',sections:[],origin:'',command:'mv -- totesp.cub ${input}_kcal_esp.cub'},
 {label:'collect(ESP)',kind:'collect',sections:[],origin:''},
 {label:'wfn_rebase=next.mwfn',kind:'rebase',sections:[],origin:''},
 {label:'bond_order',kind:'multiwfn',sections:['mayer'],origin:''},
]
const nodes=steps.map((step,index)=>({index,state:index===1?'failed':'completed',phase:'',failedPhase:index===1?'multiwfn':'',start:index*20,end:index*20+20,started:1000,finished:3000,output:step.kind==='multiwfn'?{file:'grid_sample.out',start:0,end:20}:null}))
const trace={available:true,truncated:false,steps,groups:[{id:'1-1',file:'sample.fch',combination:1,combinations:2,variables:{state:'1'},nodes},{id:'1-2',file:'sample.fch',combination:2,combinations:2,variables:{state:'2'},nodes:nodes.map(node=>({...node,state:'completed',failedPhase:''}))}]}
let lastLog
await page.route('**/api/workflows/**',async route=>{
 const url=new URL(route.request().url()),action=url.pathname.split('/').at(-1)
 let value=status
 if(action==='preview')value={id:'ESP.bwc',source:'[grid]\n%process\nelectron\nend\n'}
 if(action==='inspect')value={version:1,runnable:true,diagnostics:[],tasks:[],fields:[]}
 if(action==='trace'){
  const body=route.request().postDataJSON();assert.equal(body.directory,directory);assert.equal(url.searchParams.get('cap'),'trace-cap')
  if(body.group){lastLog=body;value={file:body.source==='driver'?'workflow.log':'grid_sample.out',text:`SELECTED ${body.group} STEP ${body.step} ${body.source}\nError: ESP fixture\n`,truncated:false,start:0,end:50,step:body.step,group:body.group,source:body.source}}
  else value=trace
 }
 await route.fulfill({contentType:'application/json',body:JSON.stringify(value)})
})
try{
 await page.goto(`${process.env.PREVIEW_URL||'http://127.0.0.1:5304/'}?workbench=1&cap=trace-cap`)
 await page.getByRole('tab',{name:'结果页',exact:true}).click()
 await page.getByRole('region',{name:'步骤 DAG',exact:true}).waitFor()
 assert.equal(await page.locator('.trace-node').count(),6)
 assert.equal(await page.locator('.trace-node.failed').count(),1)
 assert.equal(await page.locator('.trace-canvas>svg>path').count(),5)
 await page.getByRole('button',{name:'定位失败步骤',exact:true}).click()
 await page.getByLabel('步骤日志',{exact:true}).getByText('Error: ESP fixture',{exact:false}).waitFor()
 assert.equal(lastLog.step,1);assert.equal(lastLog.group,'1-1')
 assert.ok(!(await page.getByLabel('步骤日志',{exact:true}).innerText()).includes('FULL WORKFLOW'))
 await page.getByLabel('步骤日志来源',{exact:true}).selectOption('multiwfn')
 await page.waitForFunction(()=>document.querySelector('.step-log').textContent.includes('multiwfn'))
 assert.equal(lastLog.source,'multiwfn')
 await page.screenshot({path:`${artifacts}/dag-zh-failure.png`})
 await page.getByLabel('变量组合',{exact:true}).selectOption('1-2')
 assert.equal(await page.locator('.trace-node.failed').count(),0)
 await page.getByRole('button',{name:'第 3 步：%command',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('.step-log').textContent.includes('STEP 2'))
 assert.equal(lastLog.group,'1-2')
 await page.getByRole('button',{name:'全部日志',exact:true}).click()
 assert.ok((await page.getByLabel('工作流日志',{exact:true}).innerText()).includes('FULL WORKFLOW'))
 await page.getByRole('button',{name:'English',exact:true}).click()
 await page.getByRole('region',{name:'Workflow DAG',exact:true}).waitFor()
 assert.equal(await page.getByText('Shell command',{exact:true}).count(),1)
 await page.setViewportSize({width:980,height:800})
 await page.waitForTimeout(100)
 const bounds=await page.locator('.trace-canvas').boundingBox()
 for(const node of await page.locator('.trace-node').all()){const box=await node.boundingBox();assert.ok(box.x>=bounds.x-1&&box.x+box.width<=bounds.x+bounds.width+1)}
 await page.screenshot({path:`${artifacts}/dag-en-laptop.png`})
 await page.getByRole('button',{name:'Workflow DAG Execution order',exact:false}).click()
 assert.equal(await page.locator('.trace-node').count(),0)
 assert.deepEqual(errors,[])
 console.log('PASS: task DAG, conf section labels, real failure phase, step/native log navigation, array groups, return to full log, bilingual and laptop layout')
}catch(error){await page.screenshot({path:`${artifacts}/failure.png`});throw error}
finally{await browser.close()}
