// Shipped guide slot: desktop titlebar hit testing, actual clicks and reload persistence.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'

const req = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules'), '__guide.cjs'))
const { chromium } = req('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
const output = resolve('.tmp-sidebar-guide-browser'); mkdirSync(output, { recursive: true })
const state = { config: sanitizeConfig({ locale: 'zh', sidebarSimplePromptSeen: false, hideOfficialBalance: true,
  balance: { display: 'off' }, quotaStrip: { promptSeen: true }, peakProgressPromptSeen: true, goQuota: { enabled: false } }),
  today: zeroDay(), month: zeroDay(), total: zeroDay(), history: [] }
const code = `
import React from ${JSON.stringify(req.resolve('react'))};import{createRoot}from ${JSON.stringify(req.resolve('react-dom/client'))};
window.__ModuleLoader__={load:mod=>window.costUI=mod.factory(name=>name==='react'?React:{Tooltip:({children})=>children})};
${readFileSync('lib/client.js', 'utf8')}
let state=${JSON.stringify(state)};const entries=new Map(),disposers=[],services={};window.saves=0;window.saveMode='reject';
services['remote.costMeter']={getLocalState:async()=>({ok:true,value:state}),getState:async()=>({ok:true,value:state}),updateConfig:async patch=>{
  window.saves++;if(window.saveMode==='pending')await new Promise(resolve=>window.finishSave=resolve);
  if(window.saveMode!=='ok')return{ok:false,error:{message:'synthetic offline'}};state={...state,config:{...state.config,...patch}};return{ok:true,value:state}}};
services.slots={entries:()=>[],inject:(name,fn)=>fn(),register:(options,component)=>{entries.set(options.name+':'+options.id,{options,component});return()=>{}}};
const context={fiber:{uid:1},remote:{$mount:async()=>()=>{}},on:()=>()=>{},inject:(names,fn)=>{if(names.every(name=>services[name]))fn(context)},get:name=>services[name],effect:fn=>{const dispose=fn();if(typeof dispose==='function')disposers.push(dispose)}};
await costUI.apply(context);await new Promise(resolve=>setTimeout(resolve,0));
const guide=entries.get('sidebar.footer.action:cost-meter-simple-guide'),injected=guide.options.inject(),store=injected.hooks.cost;
function useCost(pick){return pick(React.useSyncExternalStore(store.subscribe,store.getSnapshot))}
window.copies=1;function App(){return React.createElement(React.Fragment,null,Array.from({length:window.copies},(_,key)=>React.createElement(guide.component,{...injected,useCost,key})))}
const root=createRoot(document.getElementById('root'));let generation=0;window.remount=()=>root.render(React.createElement(App,{key:++generation}));window.remount();
window.dispose=()=>{root.unmount();for(const dispose of disposers.reverse())dispose()};
window.guideConfig=()=>store.getSnapshot().state.config;
`
const compiled = (await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'browser' })).outputFiles[0].contents
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled); return }
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#aaa;--dsw-alias-border-l1:#444;--dsw-alias-bg-layer-2:#252527;--dsw-alias-button-elevated-fill:#303033;--dsw-alias-interactive-bg-hover:#404043;--dsw-alias-state-business-primary:#6a83ff}
    html[data-env=windows],html[data-env=fullscreen]{--dsh-windows-titlebar-height:40px;--dsh-frame-chrome-top:40px;--dsh-frame-top-clearance:40px;--dsh-frame-overlay-top:60px}
    html[data-env=fullscreen]{--dsh-frame-chrome-top:0px;--dsh-frame-overlay-top:20px}
    html[data-env=darwin]{--dsh-frame-top-clearance:48px;--dsh-frame-overlay-top:68px}
    body{margin:0;background:#131315;color:#eee;font:14px/1.6 system-ui}#caption{position:fixed;inset:0 0 auto;height:40px;z-index:2147483647;-webkit-app-region:drag;background:#303033}html[data-env=darwin] #caption{height:48px}html[data-env=web] #caption,html[data-env=fullscreen] #caption{display:none}
    #root{pointer-events:none;-webkit-app-region:drag}#page-action{position:fixed;left:16px;bottom:20px}
    html[data-skin=light]{--dsw-alias-bg-layer-2:rgba(242,246,255,.2);--dsw-alias-label-primary:#172738;--dsw-alias-label-secondary:#445c73;--dsw-alias-button-elevated-fill:#eef4fa}
    html[data-skin=translucent]{--dsw-alias-bg-layer-2:rgba(25,31,48,.15);--dsw-alias-label-primary:#a6ffe3;--dsw-alias-label-secondary:#adc5df}
    html[data-skin=translucent] #root{position:absolute;left:20px;top:150px;width:240px;height:70px;overflow:hidden;contain:paint;transform:translateX(50px);filter:blur(0);opacity:.4}
    #plugin-cover{display:none;position:fixed;inset:0 0 auto;height:240px;background:#4b648055;z-index:2147483000;pointer-events:auto}html[data-skin=translucent] #plugin-cover{display:block}
    </style><div id="caption">DSH desktop titlebar</div><div id="plugin-cover"></div><button id="page-action" onclick="window.pageClicks=(window.pageClicks||0)+1">页面操作</button><div id="root"></div><script>document.documentElement.dataset.env=new URL(location).searchParams.get('env')||'windows';document.documentElement.dataset.skin=new URL(location).searchParams.get('skin')||'dark'</script><script type="module" src="/app.js"></script>`)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true })
page.setDefaultTimeout(3000)
const errors = [], external = [], cases = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort() }
  return route.continue()
})
const guide = () => page.getByRole('dialog', { name: '试试更轻巧的侧栏', exact: true })
const fresh = async (env, skin = 'dark') => {
  await page.goto(origin + '/?env=' + env + '&skin=' + skin)
  await page.evaluate(() => { localStorage.clear(); window.remount() })
  await guide().waitFor()
}
try {
  for (const skin of ['dark', 'light', 'translucent']) for (const [env, width, height] of [['windows', 1280, 800], ['windows', 900, 600], ['darwin', 1280, 800], ['fullscreen', 900, 600], ['web', 390, 700]]) {
    await page.setViewportSize({ width, height }); await fresh(env, skin)
    const close = guide().getByRole('button', { name: '关闭提示', exact: true })
    const hit = await close.evaluate(node => {
      const r = node.getBoundingClientRect(), card = node.closest('.cm-qguide'), caption = document.getElementById('caption')
      const chrome = getComputedStyle(caption).display === 'none' ? 0 : caption.getBoundingClientRect().bottom
      const points = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + r.width / 2, r.bottom - 2]]
      const canvas = document.createElement('canvas'), paint = canvas.getContext('2d')
      paint.fillStyle = getComputedStyle(card).backgroundColor; paint.fillRect(0, 0, 1, 1)
      return { top: r.top, chrome, cardTop: card.getBoundingClientRect().top, pointer: getComputedStyle(card).pointerEvents,
        appRegion: getComputedStyle(card).webkitAppRegion, popover: card.matches(':popover-open'), background: getComputedStyle(card).backgroundColor,
        backgroundAlpha: paint.getImageData(0, 0, 1, 1).data[3],
        reachable: points.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit === node || node.contains(hit) }) }
    })
    assert.ok(hit.top >= hit.chrome, env + ': the complete close button clears the native titlebar')
    assert.equal(hit.pointer, 'auto', 'slot pointer-events do not disable the guide')
    assert.equal(hit.appRegion, 'no-drag', 'the guide cannot become a native window drag region')
    assert.equal(hit.popover, true, 'top layer escapes transformed and clipped sidebar containers')
    assert.equal(hit.backgroundAlpha, 255, 'translucent theme colors become an opaque guide background')
    assert.equal(hit.reachable, true, env + ': all sampled button edges receive pointer events')
    await page.getByRole('button', { name: '页面操作', exact: true }).click()
    assert.equal(await page.evaluate(() => window.pageClicks), 1, 'the non-modal guide does not block the page')
    assert.equal(await guide().count(), 1, 'normal page clicks do not prematurely dismiss the guide')
    await page.screenshot({ path: join(output, skin + '-' + env + '-' + width + '.png') })
    // Click near the top edge, which the old desktop titlebar intercepted.
    await close.click({ position: { x: 3, y: 3 } })
    await guide().waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.saves), 0, 'dismissal is independent of a working settings RPC')
    await page.evaluate(() => window.remount()); assert.equal(await guide().count(), 0)
    await page.reload(); assert.equal(await guide().count(), 0, 'same-origin reload remembers dismissal')
    cases.push({ skin, env, width, height, ...hit })
  }
  await fresh('windows')
  await page.evaluate(() => window.saveMode = 'pending')
  await guide().getByRole('button', { name: '开启简化显示', exact: true }).click()
  await page.waitForFunction(() => window.saves === 1)
  await guide().getByRole('button', { name: '关闭提示', exact: true }).click()
  await guide().waitFor({ state: 'detached' })
  await page.evaluate(() => { window.saveMode = 'reject'; window.finishSave() })
  await page.evaluate(() => window.remount()); assert.equal(await guide().count(), 0, 'late save failure does not reopen a dismissed guide')
  await fresh('windows')
  await guide().getByRole('button', { name: '开启简化显示', exact: true }).click()
  await guide().getByRole('alert').waitFor()
  await guide().getByRole('button', { name: '关闭提示', exact: true }).click(); await guide().waitFor({ state: 'detached' })
  await fresh('windows')
  await guide().getByRole('button', { name: '关闭提示', exact: true }).focus(); await page.keyboard.press('Escape')
  await guide().waitFor({ state: 'detached' })
  await fresh('windows')
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw Error('storage unavailable') } })
  await guide().getByRole('button', { name: '关闭提示', exact: true }).click(); await guide().waitFor({ state: 'detached' })
  await fresh('windows')
  await page.evaluate(() => { window.copies = 2; window.remount() })
  await page.waitForFunction(() => document.querySelectorAll('.cm-qguide').length === 2)
  await guide().last().getByRole('button', { name: '关闭提示', exact: true }).click()
  await guide().waitFor({ state: 'detached' })
  await fresh('windows')
  await page.evaluate(() => { HTMLElement.prototype.showPopover = undefined; window.remount() })
  await guide().getByRole('button', { name: '关闭提示', exact: true }).click(); await guide().waitFor({ state: 'detached' })
  // Real floating widgets may hit-test their image coordinates at document capture,
  // regardless of which top-layer element received the actual DOM event.
  const intercept = async () => page.evaluate(() => {
    const r = document.querySelector('.cm-qguide').getBoundingClientRect()
    window.intercepted = 0
    window.interceptedTypes = []
    const capture = event => {
      const x = event.clientX ?? event.touches?.[0]?.clientX, y = event.clientY ?? event.touches?.[0]?.clientY
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return
      window.intercepted++; window.interceptedTypes.push(event.type); event.preventDefault(); event.stopPropagation()
    }
    for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart']) document.addEventListener(type, capture, { capture: true, passive: false })
  })
  for (const action of ['关闭提示', '保留当前显示', '开启简化显示']) {
    await fresh('windows'); await intercept(); await page.evaluate(() => window.saveMode = 'ok')
    await guide().getByRole('button', { name: action, exact: true }).click()
    await guide().waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.intercepted), 0, 'owned guide events do not reach the widget capture listener')
    assert.equal(await page.evaluate(() => window.saves), action === '关闭提示' ? 0 : 1, 'each action runs exactly once')
    assert.equal(await page.evaluate(() => window.guideConfig().sidebarSimple), action === '开启简化显示')
    await page.getByRole('button', { name: '页面操作', exact: true }).click()
    assert.equal(await page.evaluate(() => window.pageClicks), 1, 'unrelated page actions remain usable')
  }
  await fresh('windows'); await intercept()
  const outside = await page.getByRole('button', { name: '页面操作', exact: true }).boundingBox(), close = await guide().getByRole('button', { name: '关闭提示', exact: true }).boundingBox()
  await page.mouse.move(outside.x + outside.width / 2, outside.y + outside.height / 2); await page.mouse.down()
  await page.mouse.move(close.x + close.width / 2, close.y + close.height / 2); await page.mouse.up()
  assert.ok((await page.evaluate(() => window.interceptedTypes)).includes('pointerup'), 'a drag started outside the guide still delivers its pointerup to the other plugin')
  assert.equal(await guide().count(), 1, 'releasing an outside drag does not activate a guide button')
  await guide().getByRole('button', { name: '关闭提示', exact: true }).click(); await guide().waitFor({ state: 'detached' })
  await fresh('windows'); await intercept()
  await guide().getByRole('button', { name: '关闭提示', exact: true }).tap(); await guide().waitFor({ state: 'detached' })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  const result = { cases, pendingSaveDismissal: true, failedSaveDismissal: true, escapeDismissal: true, unavailableStorageDismissal: true, duplicateSlotDismissal: true, legacyPopoverFallback: true, captureConflictActions: 3, outsideDragPreserved: true, touchDismissal: true, browserErrors: errors.length, externalRequests: external.length }
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log('[ok]', JSON.stringify(result))
} catch (error) { await page.screenshot({ path: join(output, 'failure.png') }); throw error }
finally { await page.evaluate(() => window.dispose?.()).catch(() => {}); await browser.close(); await new Promise(done => server.close(done)) }
