import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1300,height:900},locale:'zh-CN'})
page.setDefaultTimeout(15000)
const artifacts=process.env.ARTIFACT_DIR || '/tmp/banewfn-batch-ui'
await mkdir(artifacts,{recursive:true})
const errors=[];page.on('pageerror',error=>errors.push(error.message))
const paths=[String.raw`D:\cases\a\same.fch`,String.raw`D:\cases\b\same.fch`,String.raw`D:\cases\fail.fch`]
const status={format:'multiwfn-workflows',version:1,available:true,runner:'runner',multiwfn:'engine',library:'scripts',wavefunction:paths[0],results:String.raw`D:\cases\results`,scripts:[{id:'analysis.bwc',name:'analysis.bwc'}],selectedScript:'analysis.bwc',catalogError:null,job:null,batch:null,inputSet:{files:[],roots:[]}}
let lastPlan,selectedSet,inspected,sent,rendered,lastControl
const controls=[]
const basename=path=>path.split(/[\\/]/).at(-1)
await page.route('**/api/workflows/**',async route=>{
 const request=route.request(),url=new URL(request.url()),action=url.pathname.split('/').at(-1)
 assert.equal(url.searchParams.get('cap'),'batch-cap')
 let value=status
 if(action==='preview')value={id:'analysis.bwc',source:'state=(1 2)\n[excit]\nlogfile ?\n%process\nnto\nend\n'}
 if(action==='inspect'){
  inspected=request.postDataJSON()
  value={version:1,runnable:true,diagnostics:[],tasks:[{task:0,module:'excit',commands:'18\n'+(inspected.parameters['0/main/logfile'] || '?')+'\nq\n'}],fields:[{id:'0/main/logfile',name:'logfile',group:'1 · excit / main [main]',label:'Calculation output',labels:{zh:'计算输出文件',en:'Calculation output'},type:'file',value:inspected.parameters['0/main/logfile'] || '?',source:'placeholder',options:[]}]}
 }
 if(action==='batch-pick')value={paths:request.postDataJSON().kind==='folder'?[String.raw`D:\cases`]:[paths[0]]}
 if(action==='batch-plan'){
  lastPlan=request.postDataJSON()
  const files=lastPlan.roots?.length?paths:lastPlan.files || []
  value={version:1,combinations:2,inputs:files.map(path=>({path,name:basename(path),errors:[],bindings:Object.fromEntries(Object.keys(lastPlan.bindings || {}).map(id=>[id,path.replace(/\.fch$/,'.log')]))}))}
 }
 if(action==='batch-select'){
  selectedSet=request.postDataJSON();status.inputSet=selectedSet;status.wavefunction=selectedSet.files[0]
 }
 if(action==='batch-start'){
  sent=request.postDataJSON()
  status.batch={id:'batch-1',directory:String.raw`D:\cases\results\batch-1`,state:'running',script:'analysis.bwc',combinations:2,created:Date.now(),message:'',counts:{completed:1,running:1},cases:status.inputSet.files.map((path,index)=>({id:String(index+1).padStart(4,'0'),name:basename(path),path,state:index?'running':'completed',attempts:1,started:Date.now()-2000,finished:index?null:Date.now(),message:''}))}
 }
 if(action==='batch-detail'){
  const scope=request.postDataJSON(),item=status.batch.cases.find(item=>item.id===scope.item),attempt=scope.attempt || item.attempts
  const directory=status.batch.directory+`\\${item.id}\\attempt-${attempt}`
  value={item:{id:item.id,name:item.name,path:item.path,attempt,attempts:item.attempts},job:{directory,state:item.state,exitCode:item.state==='completed'?0:null,message:'',log:`${item.id} / ${attempt} log`,files:['same_den.cub','same_kcal_esp.cub','report.txt'],cubes:[{file:'same_den.cub',kind:'density',unit:null,orbital:null},{file:'same_kcal_esp.cub',kind:'esp',unit:'kcal/mol',unitDeclared:true,orbital:null,density:'same_den.cub'}]}}
 }
 if(action==='open-result'){rendered=request.postDataJSON();value={opened:true}}
 if(action==='open-path')value={opened:true}
 if(action==='batch-control'){
  lastControl=request.postDataJSON();controls.push(lastControl)
  if(lastControl.action==='pause')status.batch.state='paused'
  if(lastControl.action==='resume')status.batch.state='running'
  if(lastControl.action==='retry'){status.batch.state='running';status.batch.cases[1].state='running';status.batch.cases[1].attempts++;status.batch.counts={completed:1,running:1}}
  if(lastControl.action==='cancel'){status.batch.state='cancelled';status.batch.cases[1].state='cancelled'}
 }
 if(action==='batch-load')status.batch={...status.batch,id:'batch-archived',state:'completed',counts:{completed:2},cases:status.batch.cases.map(item=>({...item,state:'completed'}))}
 await route.fulfill({contentType:'application/json',body:JSON.stringify(value)})
})
try{
 await page.goto(`${process.env.PREVIEW_URL || 'http://127.0.0.1:5303/'}?workbench=1&cap=batch-cap`)
 await page.getByRole('button',{name:'批量文件',exact:true}).click()
 const modal=page.getByRole('dialog',{name:'批量启动文件',exact:true})
 await modal.getByRole('button',{name:'添加目录规则',exact:true}).click()
 await modal.getByRole('checkbox',{name:'选择输入: same.fch',exact:true}).first().waitFor()
 await modal.getByLabel('文件名模式',{exact:true}).fill('*.fch')
 assert.equal(await modal.getByRole('button',{name:'使用所选文件',exact:true}).isEnabled(),false)
 await modal.getByRole('button',{name:'刷新匹配',exact:true}).click()
 await modal.getByRole('checkbox',{name:'选择输入: fail.fch',exact:true}).uncheck()
 await page.screenshot({path:`${artifacts}/inputs-zh.png`})
 await modal.getByRole('button',{name:'使用所选文件',exact:true}).click()
 await page.getByText('已选择 2 个启动文件',{exact:true}).waitFor()
 assert.deepEqual(selectedSet.files,paths.slice(0,2))
 await page.getByLabel('文件绑定: 计算输出文件',{exact:true}).selectOption('matched')
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('运行批次')&&!b.disabled))
 assert.equal(inspected.parameters['0/main/logfile'],paths[0].replace('.fch','.log'))
 await page.getByLabel('预览输入',{exact:true}).selectOption(paths[1])
 await page.waitForTimeout(400)
 assert.equal(inspected.wavefunction,paths[1])
 assert.equal(inspected.parameters['0/main/logfile'],paths[1].replace('.fch','.log'))
 await page.getByRole('button',{name:'运行批次',exact:true}).click()
 await page.getByRole('heading',{name:'批次总览',exact:true}).waitFor()
 assert.deepEqual(sent.bindings,{'0/main/logfile':'${input}.log'})
 assert.deepEqual(sent.parameters,{})
 assert.equal(await page.getByRole('tab').count(),3)
 assert.equal(await page.locator('.batch-table table').evaluate(node=>getComputedStyle(node).display),'table')
 await page.screenshot({path:`${artifacts}/overview-running-zh.png`})
 await page.getByRole('button',{name:'查看结果',exact:true}).first().click()
 await page.getByRole('button',{name:'结果文件',exact:true}).click()
 const render=page.getByRole('button',{name:'一键渲染',exact:true})
 await render.waitFor();assert.equal(await render.isEnabled(),true,'finished input can render while batch is running')
 await render.click();await page.waitForTimeout(100)
 assert.equal(rendered.batch,'batch-1');assert.equal(rendered.item,'0001');assert.equal(rendered.attempt,1)
 assert.deepEqual(rendered.files,['same_den.cub','same_kcal_esp.cub'])
 await page.getByLabel('结果输入',{exact:true}).selectOption('0002')
 await page.waitForTimeout(150)
 assert.equal(await render.isEnabled(),false,'running input waits before rendering')
 assert.equal(await page.getByRole('button',{name:'打开文件：report.txt',exact:true}).isEnabled(),true)
 await page.getByRole('button',{name:'批次总览',exact:true}).click()
 await page.getByRole('button',{name:'暂停队列',exact:true}).click()
 await page.getByRole('button',{name:'继续队列',exact:true}).waitFor()
 await page.getByRole('button',{name:'继续队列',exact:true}).click()
 status.batch.state='partial';status.batch.cases[1].state='failed';status.batch.counts={completed:1,failed:1}
 await page.getByRole('button',{name:'重试失败或未完成项',exact:true}).waitFor()
 await page.getByRole('button',{name:'重试',exact:true}).click()
 assert.equal(lastControl.action,'retry');assert.equal(lastControl.item,'0002')
 assert.equal(status.batch.cases[0].attempts,1);assert.equal(status.batch.cases[1].attempts,2)
 await page.getByRole('button',{name:'English',exact:true}).click()
 await page.getByRole('heading',{name:'Batch overview',exact:true}).waitFor()
 await page.getByRole('button',{name:'View results',exact:true}).nth(1).click()
 await page.getByLabel('Run attempt',{exact:true}).selectOption('1')
 await page.waitForTimeout(150)
 assert.equal(await page.getByLabel('Run attempt',{exact:true}).inputValue(),'1')
 await page.getByRole('button',{name:'Batch overview',exact:true}).click()
 await page.screenshot({path:`${artifacts}/overview-en.png`})
 await page.getByRole('button',{name:'Cancel batch',exact:true}).click()
 await page.getByRole('button',{name:'Open batch',exact:true}).click()
 await page.getByRole('heading',{name:'Batch overview',exact:true}).waitFor()
 assert.equal(status.batch.id,'batch-archived')
 assert.ok(controls.some(value=>value.action==='pause')&&controls.some(value=>value.action==='resume'))
 assert.deepEqual(errors,[])
 console.log('PASS: batch file selection/freeze, companion binding and sample preview, per-input results/render scope, queue controls, attempts and bilingual history')
}catch(error){await page.screenshot({path:`${artifacts}/failure.png`});throw error}
finally{await browser.close()}
