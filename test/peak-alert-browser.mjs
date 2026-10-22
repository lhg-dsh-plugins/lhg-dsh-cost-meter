// Shipped peak reminders must escape skinned sidebar stacking/clipping and remain clickable.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'

const req = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules'), '__peak.cjs'))
const { chromium } = req('playwright-core')
const output = resolve('.tmp-peak-alert-browser'); mkdirSync(output, { recursive: true })
const skinRoot = process.env.DSH_TEST_DEEP_WHALE_DIR
const skins = skinRoot ? ['maid-atelier', 'orca-link'] : ['default', 'glass']
const state = { config: sanitizeConfig({ locale: 'zh', peakEnabled: true, peakAlertEnabled: false, peakProgressPromptSeen: true,
  peakEffectiveAt: '2026-01-01T00:00:00+08:00', peakWindows: [{ start: 1, end: 10 }], peakHolidays: [],
  sidebarSimplePromptSeen: true, quotaStrip: { promptSeen: true }, balance: { display: 'off' } }),
today: zeroDay(), month: zeroDay(), total: zeroDay(), history: [] }
const code = `
import * as ReactDOMPortal from ${JSON.stringify(req.resolve('react-dom'))};import React from ${JSON.stringify(req.resolve('react'))};import{createRoot}from ${JSON.stringify(req.resolve('react-dom/client'))};
const disposers=[];const mainRequire=n=>n==='react'?React:{Tooltip:({children})=>children};mainRequire.async=async()=>window.peakUI;window.__ModuleLoader__={load:m=>window.costUI=m.factory(mainRequire)};
${readFileSync('lib/client.js', 'utf8')}
window.__ModuleLoader__={load:m=>window.peakUI=m.factory(name=>name==='react-dom'?ReactDOMPortal:React)};
${readFileSync('lib/client.peak.js', 'utf8')}
let state=${JSON.stringify(state)};const entries=new Map(),services={};window.saves=0;
services['remote.costMeter']={getLocalState:async()=>({ok:true,value:state}),getState:async()=>({ok:true,value:state}),updateConfig:async patch=>{window.saves++;state={...state,config:{...state.config,...patch}};return{ok:true,value:state}}};
services.slots={entries:()=>[],inject:(name,fn)=>fn(),register:(o,c)=>{entries.set(o.id,{o,c});return()=>{}}};
const context={fiber:{uid:1},remote:{$mount:async()=>()=>{}},on:()=>()=>{},inject:(names,fn)=>{if(names.every(n=>services[n]))fn(context)},get:n=>services[n],effect:fn=>{const d=fn();if(typeof d==='function')disposers.push(d)}};
await costUI.apply(context);await new Promise(r=>setTimeout(r,0));
const entry=entries.get('cost-meter-peak-alert'),injected=entry.o.inject(),store=injected.hooks.cost;
function useCost(pick){return pick(React.useSyncExternalStore(store.subscribe,store.getSnapshot))}
const root=createRoot(document.getElementById('mount'));root.render(React.createElement(entry.c,{...injected,useCost}));
window.configure=patch=>injected.api.updateConfig(patch);window.dispose=()=>{root.unmount();for(const d of disposers.reverse())d()};
window.skinReady=false;const skin=new URL(location).searchParams.get('skin');
if(${!!skinRoot}){
 window.__ModuleLoader__={load:m=>window.skinUI=m.factory(n=>n==='react'?React:{})};
 await new Promise((yes,no)=>{const s=document.createElement('script');s.src='/skin/'+skin+'.js';s.onload=yes;s.onerror=no;document.head.append(s)});
 const skinContext={effect:fn=>{const d=fn();if(typeof d==='function')disposers.push(d);return d},get:()=>undefined,inject:()=>()=>{},on:()=>()=>{}};
 await window.skinUI.apply(skinContext);
}
window.skinReady=true;
`
const compiled = (await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'browser' })).outputFiles[0].contents
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://fixture').pathname
  if (path === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled); return }
  const skin = path.match(/^\/skin\/(maid-atelier|orca-link)\.js$/)
  if (skin && skinRoot) { response.setHeader('content-type', 'text/javascript'); response.end(readFileSync(join(skinRoot, skin[1], 'package/lib/client.js'))); return }
  if (path.startsWith('/skin-assets/')) { response.writeHead(204); response.end(); return }
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{--dsw-alias-bg-layer-2:#252527;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#aaa;--dsw-alias-border-l1:#444;--dsw-alias-button-elevated-fill:#353538;--dsw-alias-state-warn-primary:#ffce80;--dsh-frame-chrome-top:40px}
  body{margin:0;background:#131315;color:#eee;font:14px/1.6 system-ui}#root{position:relative;height:100vh}.frame{display:flex;height:100%}.sidebarCol{width:240px;flex:none;position:relative;z-index:1}.sidebarCol>div{height:100%;overflow:hidden}.centerCol{position:relative;z-index:2;flex:1;background:#192b40;padding:24px}#mount{pointer-events:none;-webkit-app-region:drag}.glass [data-slot="sidebar.footer.action"]{transform:translateZ(0);contain:paint;opacity:.45;overflow:hidden;height:60px}
  #page-action{position:fixed;left:12px;top:60px;z-index:3}#caption{position:fixed;inset:0 0 auto;height:40px;background:#303033;z-index:2147483647;-webkit-app-region:drag}
  </style><div id="caption">DSH titlebar</div><div id="root"><div data-slot="root" class="frame"><aside class="sidebarCol"><div><section><div data-slot="sidebar.footer.action"><div id="mount"></div></div><div data-slot="sidebar.settings"></div></section></div><button id="page-action" onclick="window.pageClicks=(window.pageClicks||0)+1">页面操作</button></aside><main class="centerCol"><div data-phase="active"><div data-conversation-scroll><article data-chat-flow><h2>页面内容</h2><p>文字不应穿过峰谷提醒。</p></article></div></div></main></div></div><script>
  const p=new URL(location).searchParams;document.body.classList.toggle('glass',p.get('skin')==='glass');document.body.toggleAttribute('data-ds-dark-theme',p.get('theme')==='dark');
  if(p.get('mode')==='real')Date.now=()=>Date.parse('2026-10-19T08:59:00+08:00');
  </script><script type="module" src="/app.js"></script>`)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true })
page.setDefaultTimeout(4000)
const errors = [], external = [], cases = []
page.on('pageerror', e => errors.push(e.message))
await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()))
const alert = () => page.locator('.cm-peak-alert')
const open = async (skin, theme, position, kind = 'peak', mode = 'preview') => {
  await page.goto(origin + '/?skin=' + skin + '&theme=' + theme + '&mode=' + mode)
  await page.waitForFunction(() => window.skinReady && window.__cmPeakAlertLive)
  await page.evaluate(async ({ position, kind, mode }) => { await window.configure({ peakAlertPosition: position, peakAlertEnabled: mode === 'real' }); if (mode !== 'real') window.cmPeakAlertPreview(kind) }, { position, kind, mode })
  await alert().waitFor(); await page.waitForTimeout(250)
}
try {
  for (const skin of skins) for (const theme of ['light', 'dark']) for (const [width, position] of [[1280, 'center'], [900, 'corner'], [390, 'center'], [390, 'corner']]) {
    await page.setViewportSize({ width, height: 800 }); await open(skin, theme, position)
    const hit = await alert().evaluate(card => {
      const b=card.querySelector('button'),r=b.getBoundingClientRect(),c=card.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,style=getComputedStyle(card)
      const canvas=document.createElement('canvas'),paint=canvas.getContext('2d');paint.fillStyle=style.backgroundColor;paint.fillRect(0,0,1,1)
      const node=document.elementFromPoint(x,y)
      return { popover:card.matches(':popover-open'),pointer:style.pointerEvents,alpha:paint.getImageData(0,0,1,1).data[3],reachable:node===b||b.contains(node),left:c.left,right:c.right,top:c.top,bottom:c.bottom,appRegion:style.webkitAppRegion }
    })
    writeFileSync(join(output,'latest-hit.json'),JSON.stringify({skin,theme,width,position,...hit},null,2))
    assert.equal(hit.reachable,true,'the real button must receive the click above skinned sidebar and conversation content')
    assert.equal(hit.popover,true); assert.equal(hit.pointer,'auto'); assert.equal(hit.appRegion,'no-drag'); assert.equal(hit.alpha,255)
    assert.ok(hit.left>=0&&hit.right<=width&&hit.top>=40&&hit.bottom<=800,'popup fits the viewport and clears titlebar')
    await page.getByRole('button',{name:'页面操作',exact:true}).click(); assert.equal(await page.evaluate(()=>window.pageClicks),1)
    await page.screenshot({path:join(output,skin+'-'+theme+'-'+width+'-'+position+'.png')})
    await alert().getByRole('button',{name:'知道了',exact:true}).click(); await alert().waitFor({state:'detached'})
    assert.equal(await page.evaluate(()=>window.saves),1,'dismissal makes no settings or billing request')
    cases.push({skin,theme,width,position,...hit})
  }
  await open(skins[0],'dark','center','offpeak')
  await page.evaluate(()=>{const consume=e=>{if(e.target.closest?.('.cm-peak-alert')){window.swallowed=(window.swallowed||0)+1;e.preventDefault();e.stopPropagation()}};for(const t of ['pointerdown','pointerup','touchstart','click'])document.addEventListener(t,consume,{capture:true,passive:false})})
  await alert().getByRole('button',{name:'知道了',exact:true}).tap();await alert().waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.swallowed||0),0)
  await open(skins[0],'dark','center','peak','real')
  await alert().getByRole('button',{name:'知道了',exact:true}).click();await alert().waitFor({state:'detached'})
  await page.evaluate(()=>window.configure({peakAlertPosition:'corner'}));assert.equal(await alert().count(),0,'a closed real transition stays dismissed on re-render')
  await open(skins[0],'dark','center'); await alert().getByRole('button',{name:'知道了',exact:true}).focus();await page.keyboard.press('Enter');await alert().waitFor({state:'detached'})
  await page.setViewportSize({width:1280,height:800});await open(skins[0],'dark','corner');await page.addStyleTag({content:'.sidebarCol,.centerCol{z-index:auto!important}'});await page.evaluate(()=>{HTMLElement.prototype.showPopover=undefined;window.cmPeakAlertPreview('offpeak')})
  // Remount the notification to exercise the old-browser fallback.
  await alert().getByRole('button',{name:'知道了',exact:true}).click();await alert().waitFor({state:'detached'})
  await page.evaluate(()=>window.cmPeakAlertPreview('peak'));await alert().waitFor();await alert().getByRole('button',{name:'知道了',exact:true}).click();await alert().waitFor({state:'detached'})
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  const result={cases,realTransitionDismissal:true,touchCaptureDismissal:true,keyboardDismissal:true,legacyFallback:true,browserErrors:errors.length,externalRequests:external.length}
  writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log('[ok]',JSON.stringify(result))
} catch(error){await page.screenshot({path:join(output,'failure.png')});throw error}
finally{await page.evaluate(()=>window.dispose?.()).catch(()=>{});await browser.close();await new Promise(done=>server.close(done))}

