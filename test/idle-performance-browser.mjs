// #284: real React with a fresh, semantically unchanged projection per render.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'
const modules = resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules'), req = createRequire(join(modules, '__idle.cjs'))
const { chromium } = req('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync)
const sources = new Map()
const state = { config: sanitizeConfig({locale:'zh', peakEnabled:false}), total: { ...zeroDay(), calls: 1 }, meta:{now:1} }
for (const mode of ['baseline','fixed']) {
 const client = readdirSync('src/client').filter(n=>n.endsWith('.js')).sort().map(name=>mode==='baseline'?execFileSync('git',['show','v1.8.29:src/client/'+name],{encoding:'utf8'}):readFileSync('src/client/'+name,'utf8')).join('').replace('exports.apply = apply','exports.preview={useSessionUsage,SessionStatisticsButton};exports.apply = apply')
 const code = `import React from ${literal(req.resolve('react'))};import {createRoot} from ${literal(req.resolve('react-dom/client'))};
 window.__ModuleLoader__={load:mod=>window.ui=mod.factory(name=>name==='react'?React:{})};${client}
 const {useSessionUsage,SessionStatisticsButton}=window.ui.preview,h=React.createElement;
 const state=${literal(state)}, projection={input:10,output:1,cacheRead:0,cacheWrite:0,reasoning:0,calls:1,cost:.01,apiCost:.01,byProviderModel:{}};
 window.counters={requests:0,renders:0,loads:0,prefetches:0};window.hiddenState=false;
 Object.defineProperty(document,'hidden',{get:()=>window.hiddenState,configurable:true});
 const Page=()=>null;Page.prefetch=()=>{window.counters.prefetches++};
 const api={loadStatistics:async()=>{window.counters.loads++;return Page},reload:async()=>{},getSessionCost:async()=>{window.counters.requests++;await new Promise(r=>setTimeout(r,5));return {own:{...projection,id:'one'},subagents:{...projection,cost:0,apiCost:0},found:true,subagentCount:0}}};
 const props={sessionId:'one',api,useProjection:()=>({...projection}),useCost:()=>({state,status:'ready'})};
 function Probe(){const value=useSessionUsage(props);window.counters.renders++;return h('output',null,value.pending?'loading':value.usage.cost)}
 function App(){const [text,setText]=React.useState(''),[revision,setRevision]=React.useState(0);window.advanceUsage=()=>{projection.input++;projection.calls++;state.total.calls++;setRevision(n=>n+1)};return h(React.Fragment,null,h('input',{'aria-label':'composer',value:text,onChange:e=>setText(e.target.value)}),h(Probe),h(SessionStatisticsButton,props))}
 window.root=createRoot(document.getElementById('root'));window.root.render(h(App));window.ready=true;`
 sources.set('/'+mode+'.js',(await build({stdin:{contents:code,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"'}})).outputFiles[0].contents)
}
const server=createServer((request,response)=>{const file=sources.get(request.url);response.setHeader('Content-Type',file?'text/javascript':'text/html');response.end(file??`<input hidden><div id="root"></div><script src="/${request.url.includes('baseline')?'baseline':'fixed'}.js"></script>`)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({executablePath,headless:true}), results={}, errors=[], external=[]
try {
 for(const mode of ['baseline','fixed']) {
  const page=await browser.newPage();page.on('pageerror',error=>{errors.push(String(error));console.error(mode+': '+error.stack)})
  await page.route('**/*',route=>{if(!route.request().url().startsWith(url)){external.push(route.request().url());return route.abort()}return route.continue()})
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
  await page.goto(url+'/'+mode);await page.waitForFunction(()=>window.ready&&window.counters.requests>0)
  const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(row=>[row.name,row.value]))
  const before=await metric();await page.waitForTimeout(1200);const idle=await page.evaluate(()=>({...window.counters})), after=await metric()
  const input=page.getByRole('textbox',{name:'composer'});await input.pressSequentially('typing without any billing change',{delay:5});await page.waitForTimeout(100)
  const typing=await page.evaluate(()=>({...window.counters}))
  await page.evaluate(()=>window.advanceUsage());await page.waitForTimeout(120);const usage=await page.evaluate(()=>({...window.counters}))
  if(mode==='fixed') {
   assert.equal(idle.requests,1,'unchanged projection objects must not loop through RPC and React')
   assert.equal(idle.loads,0,'closed cost details never load or prefetch logs')
   assert.equal(typing.requests,1,'typing is not a billing refresh signal')
   assert.equal(usage.requests,2,'new billing numbers refresh exactly once')
   await page.evaluate(()=>{window.hiddenState=true;window.advanceUsage()});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.counters.requests),2,'hidden page defers reads')
   await page.evaluate(()=>{window.hiddenState=false;document.dispatchEvent(new Event('visibilitychange'))});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.counters.requests),3)
   await page.getByRole('button',{name:'本会话费用明细'}).hover();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.counters.prefetches),1,'explicit interest still prefetches')
  } else assert.ok(idle.requests>=20,'published baseline reproduces repeated requests without any user action')
  const count=await page.evaluate(()=>{window.root.unmount();return window.counters.requests});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.counters.requests),count,'unmount stops reads')
  results[mode]={idle,typing,usage,idleTaskMs:Math.round((after.TaskDuration-before.TaskDuration)*1000)};await page.close()
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 mkdirSync('.tmp-idle-performance',{recursive:true});writeFileSync('.tmp-idle-performance/result.json',JSON.stringify({results,errors,external},null,2));console.log(JSON.stringify({results,errors,external}))
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
