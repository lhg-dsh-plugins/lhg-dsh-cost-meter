import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
const req = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules'), '__list.cjs'))
const { chromium } = req('playwright-core')
const browserPath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(existsSync)
const state = { config: sanitizeConfig({ locale: 'zh', sessionListCosts: false, includeSubagentCost: false, peakEnabled: false, balance: { display: 'off' } }), today: zeroDay(), month: zeroDay(), total: zeroDay(), history: [] }
const code = `
import React from ${JSON.stringify(req.resolve('react'))};import{createRoot}from ${JSON.stringify(req.resolve('react-dom/client'))};
const modules={};const req=name=>name==='react'?React:{Tooltip:({children})=>children};req.async=async name=>modules[name.slice(2)];
window.__ModuleLoader__={load:mod=>modules[mod.chunk??'client.js']=mod.factory(req)};
${readFileSync('lib/client.js','utf8')}
${readFileSync('lib/client.session-list.js','utf8')}
let state=${JSON.stringify(state)},source,root,wide=true;const entries=new Map(),cleanups=[];window.requests=[];
const services={remote:{$mount:async()=>()=>{}},'remote.costMeter':{
getLocalState:async()=>({ok:true,value:state}),getState:async()=>({ok:true,value:state}),
updateConfig:async patch=>{state={...state,config:{...state.config,...patch}};return{ok:true,value:state}},
getSessionListCosts:async query=>{window.requests.push(query);return{ok:true,value:query.sessionIds.map(id=>({id,found:id!=='missing',input:1000,output:200,cacheRead:500,cacheWrite:0,calls:1,cost:query.period==='today'?1:2,apiCost:query.period==='today'?1:2,costCny:query.period==='today'?7:14,apiCostCny:query.period==='today'?7:14}))}}}};
const context={remote:services.remote,fiber:{uid:1},get:name=>services[name],on:()=>()=>{},inject:(names,fn)=>{if(names.every(name=>services[name]))fn(context)},effect:fn=>{const cleanup=fn();if(typeof cleanup==='function')cleanups.push(cleanup)}};
services.slots={entries:()=>[],inject:(_,fn)=>fn(),register:(options,component)=>{entries.set(options.name+':'+options.id,{options,component});if(root)render();return()=>entries.delete(options.name+':'+options.id)}};
await modules['client.js'].apply(context);await new Promise(r=>setTimeout(r,0));
const injected=entries.get('sidebar.footer.action:cost-meter').options.inject();source=injected.hooks.cost;
window.configure=patch=>injected.api.updateConfig(patch);window.rail=()=>{wide=false;render()};
const ids=['one','two','missing'];
function App(){const item=entries.get('sidebar.workspaces.session.row.action:cost-meter-session-list');return React.createElement('div',{className:'host-list'},...(wide?ids:[]).map(id=>React.createElement('div',{key:id,className:'host-row',role:'treeitem'},React.createElement('span',{className:'title'},'A long conversation title '+id),React.createElement('span',{className:'time'},'18:00'),React.createElement('span',{className:'host-actions'},React.createElement('button',{'aria-label':'Menu '+id},'···'),item?React.createElement(item.component,{sessionId:id}):null))))}
root=createRoot(document.getElementById('root'));function render(){root.render(React.createElement(App))}render();window.ready=true;
window.dispose=()=>{root.unmount();for(const stop of cleanups.reverse())stop()};
`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'browser' })
const html = '<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;margin:0;--dsw-alias-label-secondary:#666}#root{width:100%}.host-row{display:flex;align-items:center;gap:8px;padding:8px}.title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.time{flex:none;font-size:11px}.host-actions{display:none;flex:none;gap:10px;align-items:center}.host-row:hover .host-actions{display:inline-flex}.host-row:hover .time{display:none}</style><div id="root"></div><script type="module" src="/app.js"></script>'
const server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/app.js'?'text/javascript':'text/html');response.end(request.url==='/app.js'?compiled.outputFiles[0].contents:html)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({executablePath:browserPath,headless:true}),page=await browser.newPage(),errors=[]
page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort())
try{
 await page.goto(origin);await page.waitForFunction(()=>window.ready);assert.equal(await page.evaluate(()=>window.requests.length),0)
 await page.evaluate(()=>configure({sessionListCosts:true}));await page.locator('.cm-session-list-price').first().waitFor()
 await page.waitForFunction(()=>document.querySelector('.cm-session-list-price')?.textContent==='¥14')
 assert.equal(await page.evaluate(()=>window.requests.length),1,'visible rows share a single RPC')
 assert.equal(await page.locator('.cm-session-list-price').nth(2).innerText(),'—')
 for(const width of [200,280,324]){await page.setViewportSize({width,height:600});await page.mouse.move(0,550);assert.ok(await page.locator('.cm-session-list-price').first().isVisible());assert.equal(await page.locator('.host-row').first().evaluate(n=>n.scrollWidth<=n.clientWidth),true)}
 assert.match(await page.locator('.cm-session-list-price').first().getAttribute('title'),/输入 1K.*缓存 500.*输出 200/)
 await page.evaluate(()=>configure({sessionListCostPeriod:'today'}));await page.waitForFunction(()=>document.querySelector('.cm-session-list-price')?.textContent==='¥7')
 await page.evaluate(()=>configure({locale:'en',currency:'USD',symbol:'$',exchangeRate:1}));await page.waitForFunction(()=>document.querySelector('.cm-session-list-price')?.textContent==='$1')
 assert.match(await page.locator('.cm-session-list-price').first().getAttribute('title'),/Today.*\nInput/)
 mkdirSync('.tmp-session-list-browser',{recursive:true});await page.screenshot({path:'.tmp-session-list-browser/session-list.png'})
 await page.evaluate(()=>configure({sessionListCosts:false}));await page.waitForFunction(()=>!document.querySelector('.cm-session-list-price'));const count=await page.evaluate(()=>window.requests.length)
 await page.evaluate(()=>rail());assert.equal(await page.locator('.cm-session-list-price').count(),0);assert.equal(await page.evaluate(()=>window.requests.length),count)
 assert.deepEqual(errors,[]);await page.evaluate(()=>dispose());console.log('[ok] #332 shipped main/lazy chunk: defaults, batch RPC, 200/280/324px rows, tokens, periods, currency, language, disable and rail')
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
