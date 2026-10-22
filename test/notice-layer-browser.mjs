// #371/#372: real non-modal notices inside the sidebar's lower stacking context.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'
const req = createRequire(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules', '__notice.cjs'))
const { chromium } = req('playwright-core')
const main = readdirSync('src/client').filter(n => n.endsWith('.js')).sort().map(n => readFileSync('src/client/' + n, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.test = { PeakProgressGuide, SidebarSummaryGuide, parseConfig, css }; exports.apply = apply')
const config = sanitizeConfig({ locale: 'zh', peakProgressPromptSeen: false, sidebarSummaryPromptSeen: false })
const code = `
import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};import * as ReactDOM from ${literal(req.resolve('react-dom'))};
const require=name=>name==='react'?React:name==='react-dom'?ReactDOM:{Tooltip:({children})=>children};require.async=async()=>window.peakUI;
window.__ModuleLoader__={load:mod=>window.mainUI=mod.factory(require)};${main}
window.__ModuleLoader__={load:mod=>window.peakUI=mod.factory(require)};${readFileSync('lib/client.peak.js','utf8')}
const {PeakProgressGuide,SidebarSummaryGuide,parseConfig,css}=window.mainUI.test;const params=new URL(location).searchParams;
const old=params.has('old'),kind=params.get('kind');const raw=${literal(config)};if(old){delete raw.sidebarOrder;delete raw.sidebarSummaryPromptSeen}window.saved=[];
function App(){const [config,setConfig]=React.useState(()=>parseConfig(raw));const state={config,today:${literal(zeroDay())},month:${literal(zeroDay())},total:${literal(zeroDay())},codingPlans:{}};
const api={updateConfig:async patch=>{if(old&&('sidebarOrder'in patch||'sidebarSummaryPromptSeen'in patch))throw Error('Unknown config key');window.saved.push(patch);const next={...config,...patch};setConfig(next);return{config:next}}};
return React.createElement(React.Fragment,null,React.createElement('style',null,css),React.createElement('div',{id:'sidebar-slot',style:{position:'relative',zIndex:0,pointerEvents:'none',transform:'translateX(0)',overflow:'hidden',height:80,width:180}},React.createElement(kind==='peak'?PeakProgressGuide:SidebarSummaryGuide,{useCost:()=>({state}),api})),React.createElement('div',{id:'composer',style:{position:'fixed',zIndex:1,left:200,right:0,top:0,bottom:0}},React.createElement('button',{id:'host-button',onClick:()=>window.hostClicks=(window.hostClicks||0)+1},'宿主按钮')))}
createRoot(document.getElementById('root')).render(React.createElement(App));
`
const bundled = (await build({ stdin:{contents:code,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser' })).outputFiles[0].contents
const server = createServer((req,res)=>{
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(bundled);return}
  res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><style>${readFileSync('test/fixtures/peak-theme.css','utf8')}body{margin:0;background:#151518;color:#eee;font:14px system-ui}#composer{background:rgba(60,75,80,.3)}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`)
})
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`
const browser=await chromium.launch({executablePath:process.env.CM_TEST_BROWSER??['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true})
const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort())
mkdirSync('.tmp-notice-layer',{recursive:true})
try{
  for(const kind of ['summary','peak'])for(const action of ['close','apply']){
    await page.goto(origin+'/?kind='+kind+(kind==='summary'?'&old=1':''));await page.evaluate(()=>localStorage.clear());await page.reload()
    const dialog=page.locator('dialog[open]');await dialog.waitFor()
    assert.equal(await dialog.evaluate(node=>node.parentElement===document.body&&!node.matches(':modal')),true)
    await page.locator('#host-button').click();assert.equal(await page.evaluate(()=>window.hostClicks),1)
    const button=dialog.getByRole('button',{name:action==='close'?'关闭':kind==='summary'?'使用合并卡片':'使用进度条',exact:true})
    assert.equal(await button.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),true,'button is above the composer')
    await page.screenshot({path:'.tmp-notice-layer/'+kind+'-'+action+'.png'})
    await button.click();await dialog.waitFor({state:'hidden'})
    if(action==='apply')assert.ok((await page.evaluate(()=>window.saved)).some(p=>p.peakStyle==='progress'))
    await page.reload();assert.equal(await page.locator('dialog[open]').count(),0,'dismissal persists')
  }
  assert.deepEqual(errors,[])
  console.log('[ok] Sidebar stacking/skin fixture: both notices remain non-modal, real close/apply clicks, reload persistence and old-host config keys')
}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done))}
