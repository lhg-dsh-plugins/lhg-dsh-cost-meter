// #261: real settings layout and billing selection with long model names.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
import { PLAN_PROVIDER_IDS } from '../lib/plan-billing.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const uiModules = resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES ?? '.tmp-context-host/node_modules')
const req = createRequire(join(uiModules, '__pricing_theme.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? uiModules), '__pricing_theme.cjs'))
const { chromium } = browserReq('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync)
assert.ok(executablePath, 'a local Chromium browser is required')
const baseline = process.argv.includes('--baseline') ? process.argv[process.argv.indexOf('--baseline') + 1] : null
const readSource = file => baseline
  ? execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' })
  : readFileSync(file, 'utf8')
const client = readdirSync('src/client').filter(name => name.endsWith('.js')).sort()
  .map(name => readSource('src/client/' + name)).join('')
  .replace('exports.apply = apply', 'exports.preview = { CostSection, parseConfig }; exports.apply = apply')
const longKey = 'workbuddy-xdpool:deepseek-v4.1-flash-' + 'very-long-model-'.repeat(6)
const unicodeKey = 'provider:模型名称'.repeat(8)
const day = { ...zeroDay('2026-10-12'), byProviderModel: {
  [longKey]: { input: 10000, output: 2000, cacheRead: 100, calls: 3, cost: 1.5 },
  [unicodeKey]: { input: 1000, output: 200, cacheRead: 100, calls: 3, cost: .5 },
  'deepseek:deepseek-v4-flash': { input: 1, output: 1, calls: 1, cost: .001 },
} }
const initialState = { config: sanitizeConfig({ locale: 'zh', planBilling: { models: { [longKey]: 'plan' } } }), today: day, month: day, total: day, history: [day], meta: { dayKey: '2026-10-12' }, balance: {} }
const code = `
import React from ${literal(req.resolve('react'))};
import {createRoot} from ${literal(req.resolve('react-dom/client'))};
window.__ModuleLoader__={load:mod=>window.costUI=mod.factory(name=>name==='react'?React:{Tooltip:({children})=>children})};
${client}
const {CostSection,parseConfig}=window.costUI.preview;
const state=${literal(initialState)};state.config=parseConfig(state.config,'config');state.config.hideTodayCost=new URLSearchParams(location.search).has('hide-today');
window.patches=[];
const api={loadOpenRouter:async()=>()=>null,updateConfig:async patch=>{window.patches.push(patch)}};
createRoot(document.getElementById('root')).render(React.createElement(CostSection,{useCost:()=>({state,status:'ready'}),api}));
window.fixtureReady=true;
`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
// Token values copied from the published skin source, with provenance pinned.
// https://github.com/RevolutionLA/dsh-dream-skin/blob/86761e4106874f3c0646c74f95a1a2d252c4b9ce/lib/client.js
const light = { '--dsw-alias-label-primary': '#25262b', '--dsw-alias-label-secondary': '#737780', '--dsw-alias-label-tertiary': '#858a94', '--dsw-alias-bg-base': '#fff', '--dsw-alias-bg-layer-1': '#f7f8fa', '--dsw-alias-border-l1': '#e5e7eb', '--dsw-alias-button-elevated-fill': '#fff', '--dsw-alias-state-business-primary': '#4d6bfe' }
const midnight = { '--dsw-alias-label-primary': '#eff0f1', '--dsw-alias-label-secondary': '#c0c1c2', '--dsw-alias-label-tertiary': '#a3a4a5', '--dsw-alias-bg-base': '#0b0b0c', '--dsw-alias-bg-layer-1': '#141415', '--dsw-alias-border-l1': 'rgba(255,255,255,.062)', '--dsw-alias-button-elevated-fill': '#141415', '--dsw-alias-state-business-primary': '#889ef6' }
const dark = { ...midnight, '--dsw-alias-label-primary': '#ececee', '--dsw-alias-bg-base': '#202022', '--dsw-alias-bg-layer-1': '#29292c' }
const html = '<!doctype html><html style="color-scheme:light"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.5 system-ui}#root{max-width:900px;margin:auto}</style></head><body><div id="root"></div><select id="host-control"><option>Host control</option><option>Other plugin</option></select><script src="/app.js"></script></body></html>'
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled.outputFiles[0].contents) }
  else if (request.url.split('?')[0] === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html) }
  else { response.statusCode = 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })

const errors = [], external = [], checks = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin !== new URL(url).origin) { external.push(route.request().url()); return route.abort() }
  return route.continue()
})
const output = resolve('.tmp-model-stats-browser')
mkdirSync(output, { recursive: true })
try {
  for (const hidden of [false, true]) {
    await page.goto(url + (hidden ? '?hide-today=1' : ''))
    await page.locator('.cm-overview-grid .cm-card').first().waitFor()
    await page.evaluate(tokens => { for (const [key,value] of Object.entries(tokens)) document.documentElement.style.setProperty(key,value) }, light)
    for (const width of [900, 560, 390]) {
      await page.locator('#root').evaluate((node, width) => { node.style.maxWidth = width + 'px' }, width)
      const layout = await page.locator('.cm-overview-grid .cm-card').evaluateAll(cards => cards.map(node => ({ top: node.getBoundingClientRect().top, width: node.getBoundingClientRect().width, scroll: node.scrollWidth, client: node.clientWidth })))
      assert.equal(layout.length, hidden ? 2 : 3)
      if (width > 460) {
        assert.ok(layout.every(card => Math.abs(card.top-layout[0].top)<1), 'overview cards share one row at '+width)
        assert.ok(layout.every(card => Math.abs(card.width-layout[0].width)<1), 'overview cards fill the available row equally')
      } else assert.equal(new Set(layout.map(card => card.top)).size, layout.length, 'narrow overview stacks all cards without a partial row')
      assert.ok(layout.every(card => card.scroll<=card.client+1), 'card text stays inside the card')
      checks.push({overview:true,width,hidden,cards:layout.length,sameRow:layout.every(card=>Math.abs(card.top-layout[0].top)<1)})
      await page.screenshot({path:join(output,`overview-${hidden?'two':'three'}-${width}.png`)})
    }
  }
  await page.goto(url)
  await page.getByRole('tab', { name: '用量', exact: true }).click()
  await page.getByRole('button', { name: '按模型统计(token 与费用)', exact: true }).click()
  for (const [theme, tokens] of [['light', light], ['dark', dark]]) {
    await page.evaluate(tokens => {
      for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value)
    }, tokens)
    for (const width of [1100, 555, 360]) {
      await page.setViewportSize({ width, height: 900 })
      for (const period of ['今日', '近 90 天']) {
        await page.getByRole('button', { name: period, exact: true }).click()
        const selectors = page.locator('.cm-mstats-row select')
        assert.equal(await selectors.count(), 3)
        for (const select of await selectors.all()) {
          await select.scrollIntoViewIfNeeded()
          const geometry = await select.evaluate(node => {
            const box = node.getBoundingClientRect()
            const row = node.closest('.cm-mstats-row').getBoundingClientRect()
            const points = [[box.left + 8, box.top + box.height / 2], [box.right - 8, box.top + box.height / 2], [(box.left + box.right) / 2, (box.top + box.bottom) / 2]]
            return { width: box.width, rowWidth: row.width, inside: box.left >= row.left && box.right <= row.right && box.right <= innerWidth, clickable: points.every(([x,y]) => node.contains(document.elementFromPoint(x,y))) }
          })
          assert.ok(geometry.width >= 80 && geometry.inside && geometry.clickable, JSON.stringify({ theme, width, period, geometry }))
          await select.click()
          await page.keyboard.press('Escape')
        }
        const chip = page.locator('.cm-mstats-row .cm-plan-tag').filter({ hasText: 'Plan 订阅' }).first()
        await chip.scrollIntoViewIfNeeded()
        assert.equal(await chip.evaluate(node => {
          const box = node.getBoundingClientRect()
          return box.width > 0 && box.right <= innerWidth && node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
        }), true, 'Plan chip stays visible outside the truncated name')
        checks.push({ theme, width, period, selectors: 3 })
      }
      await page.locator('.cm-mstats-row').first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(output, `${theme}-${width}.png`) })
    }
  }
  const select = page.locator('.cm-mstats-row select').first()
  assert.deepEqual(await select.locator('option[value^="plan:"]').evaluateAll(options => options.map(option => option.value.slice(5)).sort()),
    [...PLAN_PROVIDER_IDS].sort(), 'selectable subscription families match server billing classification')
  await select.selectOption('plan:volcengine')
  await page.waitForFunction(() => window.patches.length === 1)
  assert.deepEqual(await page.evaluate(() => window.patches[0]), { planBilling: { ...initialState.config.planBilling, models: { [longKey]: 'plan' }, modelPlans: { [longKey]: 'volcengine' } } })
  assert.equal(await select.inputValue(), 'plan:volcengine')
  await select.selectOption('plan:minimax')
  await page.waitForFunction(() => window.patches.length === 2)
  assert.deepEqual(await page.evaluate(() => window.patches[1]), { planBilling: { ...initialState.config.planBilling, models: { [longKey]: 'plan' }, modelPlans: { [longKey]: 'minimax' } } })
  await select.selectOption('api')
  await page.waitForFunction(() => window.patches.length === 3)
  assert.deepEqual(await page.evaluate(() => window.patches[2]), { planBilling: { ...initialState.config.planBilling, models: { [longKey]: 'api' }, modelPlans: {} } })
  await select.selectOption('auto')
  await page.waitForFunction(() => window.patches.length === 4)
  assert.deepEqual(await page.evaluate(() => window.patches[3]), { planBilling: { ...initialState.config.planBilling, models: {}, modelPlans: {} } })
  for (const [i, id] of ['codex', 'volcengine-agent', 'tencent-coding', 'tencent-token', 'baidu-coding', 'opendesign'].entries()) {
    await select.selectOption('plan:' + id)
    await page.waitForFunction(count => window.patches.length === count, 5 + i)
    assert.equal(await select.inputValue(), 'plan:' + id)
    assert.deepEqual(await page.evaluate(() => window.patches.at(-1)), { planBilling: { ...initialState.config.planBilling, models: { [longKey]: 'plan' }, modelPlans: { [longKey]: id } } })
  }
  assert.deepEqual(external, [])
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'report.json'), JSON.stringify({ checks, errors, external, billingChangesSaved: true }, null, 2) + '\n')
  console.log(JSON.stringify({ checks, browserErrors: errors.length, externalRequests: external.length, billingChangesSaved: true }))
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve))
}
