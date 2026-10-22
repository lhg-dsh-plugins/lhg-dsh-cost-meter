import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'
import { BILLION_FEEDBACK_GROUP, BILLION_FEEDBACK_ISSUE } from '../lib/billion-context-compatibility.js'

const req = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES), '__billion_notice.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES), '__billion_notice.cjs'))
const { chromium } = browserReq('playwright-core')
const client = readdirSync('src/client').filter(file => file.endsWith('.js')).sort().map(file => readFileSync('src/client/' + file, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.preview = { BillionCompatibilityGuide }; exports.apply = apply')
const code = `
import React from ${literal(req.resolve('react'))};
import { createRoot } from ${literal(req.resolve('react-dom/client'))};
window.parts = {};
window.__ModuleLoader__ = { load: mod => { window.parts[mod.chunk || 'main'] = mod.factory(name => name === 'react' ? React : {}); } };
${readFileSync('lib/client.statistics.js', 'utf8')}
${client}
const listeners = new Set();let config=await window.readSavedConfig(); let snapshot = { state: { config: { ...config,locale: 'zh' }, billionContext: { compatibility: 'ready', noticeId: '' } } };
window.setMeter = (meter, locale = 'zh') => { snapshot = { state: { config: { ...config,locale }, billionContext: meter } }; for (const listener of listeners) listener(); };
window.loads = 0;
const Page = () => null; Page.BillionCompatibilityNotice = window.parts['client.statistics.js'].BillionCompatibilityNotice;
const api = { loadStatistics: async () => { window.loads++; return Page; }, updateConfig:async patch=>{config=await window.saveNoticeConfig(patch);snapshot={state:{...snapshot.state,config:{...snapshot.state.config,...config}}};for(const listener of listeners)listener();return snapshot.state} };window.configure=patch=>api.updateConfig(patch);
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const useCost = () => React.useSyncExternalStore(subscribe, () => snapshot);
createRoot(document.getElementById('root')).render(React.createElement(window.parts.main.preview.BillionCompatibilityGuide, { useCost, api }));
window.ready = true;
`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'browser' })
const server = createServer((request, response) => {
  response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : 'text/html; charset=utf-8')
  response.end(request.url === '/app.js' ? compiled.outputFiles[0].contents : '<!doctype html><html><head><meta charset="utf-8"></head><body><dialog id="other"><button>Other</button></dialog><div id="root"></div><script type="module" src="/app.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({ executablePath: process.env.CM_TEST_BROWSER, headless: true })
let noticeConfig={billionContextNoticeEnabled:true,billionContextNoticesSeen:[]};
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [], external = []
await page.exposeFunction('readSavedConfig',()=>noticeConfig);await page.exposeFunction('saveNoticeConfig',patch=>{noticeConfig={...noticeConfig,...patch};return noticeConfig});
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => { if (new URL(route.request().url()).origin !== url) { external.push(route.request().url()); return route.abort() }; return route.continue() })
try {
  await page.goto(url); await page.waitForFunction(() => window.ready)
  assert.equal(await page.locator('.cm-billion-notice[open]').count(), 0)
  assert.equal(await page.evaluate(() => window.loads), 0, 'normal billing does not load a popup chunk')
  await page.evaluate(() => window.setMeter({ version: '0.1.180', compatibility: 'needs_update', noticeId: 'needs_update:0.1.180' }))
  const dialog = page.getByRole('dialog', { name: 'billion-context 计费兼容提醒' })
  await dialog.waitFor({ state: 'visible' })
  assert.equal(await dialog.getByRole('button', { name: '知道了' }).evaluate(node => node === document.activeElement), true)
  assert.match(await dialog.innerText(), /0\.1\.180.*0\.1\.181/s)
  assert.equal(await dialog.getByRole('link', { name: '加入交流群' }).getAttribute('href'), BILLION_FEEDBACK_GROUP)
  assert.equal(await dialog.getByRole('link', { name: '提交 issue' }).getAttribute('href'), BILLION_FEEDBACK_ISSUE)
  assert.equal(await dialog.evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth }), true)
  mkdirSync('.tmp-billion-notice-browser', { recursive: true })
  await page.screenshot({ path: '.tmp-billion-notice-browser/old-version.png' })
  await dialog.getByRole('button', { name: '知道了' }).click()
  await page.evaluate(() => { window.setMeter({ compatibility: 'ready', noticeId: '' }); window.setMeter({ version: '0.1.180', compatibility: 'needs_update', noticeId: 'needs_update:0.1.180' }) })
  assert.equal(await page.locator('.cm-billion-notice[open]').count(), 0, 'an acknowledged version does not keep interrupting')
  await page.evaluate(() => { document.getElementById('other').showModal(); window.setMeter({ version: '0.1.999', compatibility: 'changed', noticeId: 'changed:0.1.999' }, 'en') })
  assert.equal(await page.locator('.cm-billion-notice[open]').count(), 0, 'wait for an existing dialog to close')
  await page.evaluate(() => document.getElementById('other').close())
  const changed = page.getByRole('dialog', { name: 'billion-context billing compatibility' })
  await changed.waitFor({ state: 'visible' })
  assert.match(await changed.innerText(), /interface has changed/)
  await page.screenshot({ path: '.tmp-billion-notice-browser/changed.png' })
  await page.keyboard.press('Escape')
  await changed.waitFor({ state: 'detached' })
  await page.evaluate(()=>localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.ready)
  await page.evaluate(() => window.setMeter({ version: '0.1.999', compatibility: 'changed', noticeId: 'changed:0.1.999' }, 'en'))
  assert.equal(await page.locator('.cm-billion-notice[open]').count(), 0, 'dismissal survives reload')
  await page.evaluate(() => window.setMeter({ version: '1.0.0', compatibility: 'bridge_missing', noticeId: 'bridge_missing:1.0.0' }))
  await dialog.waitFor({ state: 'visible' })
  assert.match(await dialog.innerText(), /原版 billion-context.*自动计费/)
  assert.doesNotMatch(await dialog.innerText(), /安装.*兼容包/)
  await dialog.getByRole('button',{name:'不再弹出此提醒'}).click();await dialog.waitFor({state:'detached'});assert.equal(noticeConfig.billionContextNoticeEnabled,false);
  await page.evaluate(()=>localStorage.clear());await page.reload();await page.waitForFunction(()=>window.ready);
  await page.evaluate(()=>window.setMeter({version:'1.1.0',compatibility:'changed',noticeId:'changed:1.1.0'}));assert.equal(await page.locator('.cm-billion-notice[open]').count(),0,'global mute survives reload and another compatibility reason');
  await page.evaluate(()=>window.configure({billionContextNoticeEnabled:true}));await dialog.waitFor({state:'visible'});
  await page.evaluate(() => window.setMeter({ version: '1.0.0', compatibility: 'ready', noticeId: '' }))
  await dialog.waitFor({ state: 'detached' })
  await page.evaluate(() => window.setMeter({ version: '0.1.204', compatibility: 'ready', unresolved: 1, noticeId: 'usage_missing:1' }))
  await dialog.waitFor({ state: 'visible' })
  assert.match(await dialog.innerText(), /用量.*缺失|缺失.*用量/s)
  assert.match(await dialog.innerText(), /重复|叠加/)
  await dialog.getByRole('button', { name: '知道了' }).click()
  await page.evaluate(() => window.setMeter({ version: '0.1.204', compatibility: 'ready', unresolved: 0, noticeId: '' }))
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  const report = { upgrade: true, changed: true, missingUsage: true, groupAndIssueLinks: true, deduplicated: true, restored: true, browserErrors: errors.length, externalRequests: external.length }
  writeFileSync('.tmp-billion-notice-browser/report.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
