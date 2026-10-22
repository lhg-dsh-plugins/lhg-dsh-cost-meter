// Real cost aggregation and real React/browser interaction, using synthetic local events.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig } from '../lib/store.js'
import { getSessionTrajectory } from '../lib/trajectory.js'
import { trajectoryQuerySchema, trajectorySchema } from '../lib/typert.host.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const req = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules'), '__cost_views.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules'), '__cost_views.cjs'))
const { chromium } = browserReq('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
assert.ok(executablePath)
const at = Date.parse('2026-10-14T09:00:00Z')
const toolNames = ['read_file', 'grep', 'apply_patch', 'exec_command', 'web_search', 'web_fetch', 'send_message', ...Array.from({ length: 9 }, (_, i) => 'tool_' + i)]
const eventsOf = (id, count) => {
  const records = [{ type: 'turn/start', seq: 0, time: at, data: { turn: 1 } }]
  for (let i = 0; i < count; i++) {
    const model = i % 11 === 0 ? 'plan-model' : id === 'root' && i === 1 ? 'free-model' : id === 'root' && i === 2 ? 'unpriced-model' : 'api-model', step = i + 1
    records.push({ type: 'request/header', seq: records.length, time: at + i * 10, data: { header: { config: { provider: 'fixture', model } } } },
      { type: 'step/start', seq: records.length + 1, time: at + i * 10 + 1, data: { turn: 1, step } },
      { type: 'assistant/message', seq: records.length + 2, time: at + i * 10 + 2, data: { turn: 1, step, usage: { inputTokens: i === 15 ? 7000 : 40 + i % 9 * 10, outputTokens: 20, cacheReadTokens: 120 }, message: { content: 'PRIVATE-BODY' } } },
      { type: 'tool/call', seq: records.length + 3, time: at + i * 10 + 3, data: { turn: 1, step, callId: 'tool-' + i, name: toolNames[i % toolNames.length] } })
  }
  return records
}
const headers = [{ id: 'root', title: '测试对话' }, { id: 'child-a', title: '资料收集', origin: 'subagent', parentSession: 'root' }, { id: 'child-b', title: '核对数据', origin: 'subagent', parentSession: 'child-a' }]
const records = new Map([['root', eventsOf('root', 90)], ['child-a', eventsOf('child-a', 400)], ['child-b', eventsOf('child-b', 380)]])
const config = sanitizeConfig({ includeSubagentCost: true, planBilling: { models: { 'fixture:plan-model': 'plan' } }, prices: { providers: { fixture: { models: {
  'api-model': { input: 1, cachedInput: .1, output: 4, billingMode: 'flat' }, 'plan-model': { input: 1, cachedInput: .1, output: 4, billingMode: 'flat' },
  'free-model': { input: 0, cachedInput: 0, output: 0, billingMode: 'flat' },
} } } } })
const ledger = { config, days: {} }
const ctx = { get: name => name === 'sessionQuery' ? { listSessions: async () => headers }
  : name === 'sessions' ? { get: id => ({ header: { ...headers.find(row => row.id === id), createdAt: at }, snapshotEvents: () => records.get(id) }) } : undefined }
const initial = await getSessionTrajectory(ledger, ctx, { sessionId: 'root', basis: 'total', order: 'cost' })
assert.equal(initial.totalSteps, 870)
assert.equal(initial.groups.filter(row => row.kind === 'tool').length, 5)
assert.equal(initial.operations.length, 8)
assert.ok(Math.abs(initial.operations.reduce((sum, row) => sum + row.cost, 0) - initial.cost) < 1e-10)
assert.ok(initial.operationGroups.some(row => row.kind === 'other-tools'))
const client = readFileSync('src/statistics/index.js', 'utf8').replace('return { mount, prefetchStatistics,', 'return { StepCosts, css, feeRectangles, parseTrajectory, mount, prefetchStatistics,')
const code = `
import React from ${literal(req.resolve('react'))};
import {createRoot} from ${literal(req.resolve('react-dom/client'))};
window.__ModuleLoader__={load:mod=>window.costViews=mod.factory(()=>React)};
${client}
window.callRequests=[];
const api={getSessionTrajectory:async query=>window.costViews.parseTrajectory(await (await fetch('/trajectory?query='+encodeURIComponent(JSON.stringify(query)))).json()),getCallInspection:async query=>{window.callRequests.push(query);const marker=query.sessionId+':'+query.seq;return {found:true,kind:'model',input:'输入 '+marker,injected:'',skills:'',precedingTools:'',output:'输出 '+marker,reasoning:'推理 '+marker,truncated:false,totalTools:1,offset:0,tools:[{seq:query.seq,step:1,name:'read_file',callId:'call-'+marker,atMs:query.atMs,durationMs:12,arguments:'参数 '+marker,result:'结果 '+marker,truncated:false,status:'complete'}]}}};
const root=createRoot(document.getElementById('root'));
window.queries=[];window.basis='total';window.version=0;
window.render=()=>root.render(React.createElement('div',{className:'cm-stat'},React.createElement('style',null,window.costViews.css),React.createElement(window.costViews.StepCosts,{api,sessionId:'root',basis:window.basis,revision:window.basis+':'+window.version,detailed:true,text:(zh,en)=>zh,money:value=>'¥'+(value*7.2).toFixed(8)})));
window.chooseBasis=value=>{window.basis=value;window.render()};window.refreshCosts=()=>{window.version++;window.render()};window.render();
`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'iife' })
const html = '<!doctype html><html><head><meta charset="utf-8"><style>:root{--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#fff;--dsw-alias-label-primary:#25262b;--dsw-alias-label-tertiary:#858a94;--dsw-alias-border-l3:#e5e7eb;--dsw-alias-state-business-primary:#4d6bfe;--dsw-alias-interactive-bg-hover:#f0f1f4}html[data-theme=dark]{color-scheme:dark;--dsw-alias-bg-base:#202022;--dsw-alias-bg-layer-1:#29292c;--dsw-alias-bg-layer-2:#29292c;--dsw-alias-label-primary:#ececee;--dsw-alias-label-tertiary:#a6a6ad;--dsw-alias-border-l3:#38383c;--dsw-alias-interactive-bg-hover:#38383c}body{margin:0;padding:14px;background:var(--dsw-alias-bg-base);font:13px/1.5 system-ui}#root{max-width:1100px;margin:auto}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
const requests = [], sizes = [], errors = [], external = []
let delayOperation = ''
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled.outputFiles[0].contents) }
    else if (url.pathname === '/trajectory') {
      const query = trajectoryQuerySchema.parse(JSON.parse(url.searchParams.get('query')))
      requests.push(query)
      if (delayOperation && query.operation === delayOperation && !query.stepKey) await new Promise(resolve => setTimeout(resolve, 400))
      const data = trajectorySchema.parse(await getSessionTrajectory(ledger, ctx, query)), json = JSON.stringify(data)
      assert.doesNotMatch(json, /PRIVATE-BODY/)
      sizes.push(Buffer.byteLength(json)); response.setHeader('content-type', 'application/json'); response.end(json)
    } else { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html) }
  } catch (error) {
    console.error(error)
    response.statusCode = 500
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ error: 'Test fixture request failed' }))
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1180, height: 900 } })
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin !== new URL(url).origin) { external.push(route.request().url()); return route.abort() }
  return route.continue()
})
try {
  await page.goto(url)
  const chart = page.locator('.cm-fee-views')
  const popup = page.getByRole('dialog', { name: '费用详细信息', exact: true })
  const closePopup = async () => { await popup.getByRole('button', { name: '关闭详细信息', exact: true }).click(); await popup.waitFor({ state: 'detached' }) }
  const assertStepInspection = async step => {
    const exact = await getSessionTrajectory(ledger, ctx, { sessionId: 'root', basis: 'total', stepKey: step.key })
    assert.ok(exact.steps[0]?.callRefs?.length, 'a selected step carries exact call references')
    const call = exact.steps[0].callRefs[0], marker = call.sessionId + ':' + call.logSeq
    await popup.getByText('输出 ' + marker, { exact: true }).waitFor()
    const request = await page.evaluate(key => [...window.callRequests].reverse().find(row => row.sessionId + ':' + row.seq === key), marker)
    assert.deepEqual(request, { sessionId: call.sessionId, seq: call.logSeq, atMs: call.atMs, offset: 0 }, 'inspection resolves the exact billed event and owning agent')
    await popup.getByRole('button', { name: '输入记录', exact: true }).click()
    await popup.getByText('输入 ' + marker, { exact: true }).waitFor()
    await popup.getByRole('button', { name: '工具调用 · 1', exact: true }).click()
    await popup.getByText('结果 ' + marker, { exact: true }).waitFor()
    return request
  }
  await chart.getByRole('button', { name: '归类占比', exact: true }).waitFor()
  assert.equal(await chart.getByRole('button', { name: '矩形分布', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await chart.getByRole('button', { name: '按用途', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await chart.locator('.cm-fee-category').count(), initial.operations.length)
  assert.doesNotMatch(await chart.innerText(), /其余\s*\d+\s*步/)
  assert.match(await chart.innerText(), /读取文件/)
  assert.match(await chart.innerText(), /文件修改/)
  assert.match(await chart.innerText(), /命令执行/)
  assert.match(await chart.innerText(), /网页抓取/)
  await chart.getByRole('button', { name: '归类占比', exact: true }).click()
  const groups = chart.locator('.cm-cost-key')
  assert.equal(await groups.count(), initial.operations.length)
  assert.match(await chart.innerText(), /读取文件/)
  assert.match(await chart.innerText(), /本地检索/)
  assert.match(await chart.innerText(), /其他工具/)
  const groupColors = await groups.locator('.cm-plan-dot').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))
  assert.equal(new Set(groupColors).size, groupColors.length, 'cost categories have distinct colors')
  assert.equal(await page.locator('.cm-fee-bin').count(), initial.distribution.length)
  assert.equal(await page.locator('[data-step-key]').count(), 0)
  assert.equal(await page.evaluate(() => window.callRequests.length), 0, 'opening charts does not read any call content')
  await page.locator('.cm-individual-steps>summary').click()
  await page.locator('[data-step-key]').first().waitFor()
  assert.equal(await page.locator('[data-step-key]').count(), 20, 'large histories render a bounded initial ranking')
  const amounts = await page.locator('[data-step-key]').evaluateAll(nodes => nodes.map(node => +node.dataset.stepAmount))
  assert.ok(amounts.every((value, i) => !i || amounts[i - 1] >= value))
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '展开更多步骤', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-step-key]').length === 120)
  assert.equal(requests.at(-1).offset, 100)
  const paged = await page.locator('[data-step-key]').evaluateAll(nodes => nodes.map(node => ({ key: node.dataset.stepKey, amount: +node.dataset.stepAmount })))
  assert.equal(new Set(paged.map(row => row.key)).size, 120)
  assert.ok(paged.every((row, i) => !i || paged[i - 1].amount >= row.amount))
  delayOperation = 'read'
  await groups.filter({ hasText: '读取文件' }).click()
  await popup.waitFor()
  assert.equal(await popup.locator('.cm-fee-popup-step').count(), 0, 'new group popup does not reuse the previous ranking as its records')
  await popup.locator('.cm-fee-popup-step').first().waitFor()
  const readRows = await getSessionTrajectory(ledger, ctx, { sessionId: 'root', basis: 'total', order: 'cost', operation: 'read' })
  await assertStepInspection(readRows.steps[0])
  delayOperation = ''
  assert.ok(requests.some(query => query.operation === 'read' && !query.stepKey))
  await closePopup()
  await page.getByRole('combobox', { name: '步骤排序', exact: true }).selectOption('time')
  await page.waitForFunction(() => document.querySelector('[data-step-key]')?.dataset.stepKey.includes('root:'))
  assert.equal(requests.at(-1).order, 'time')
  await page.getByRole('combobox', { name: '步骤排序', exact: true }).selectOption('cost')
  await page.locator('.cm-step-name').first().click()
  await popup.locator('.cm-step-rates').waitFor()
  assert.match(await popup.locator('.cm-step-rates').innerText(), /单价 \/ 百万/)
  await assertStepInspection(initial.steps[0])
  await closePopup()
  await page.locator('.cm-individual-steps>summary').click()

  for (const [width, theme] of [[1180, 'light'], [1180, 'dark'], [390, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width, height: 900 }); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    for (const view of ['归类占比', '矩形分布', '父子归属', '步骤热力图']) {
      await chart.getByRole('button', { name: view, exact: true }).click()
      assert.equal(await chart.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, `${view} fits ${width}/${theme}`)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      if (view === '矩形分布') {
        await page.locator('.cm-fee-tile').first().waitFor()
        const geometry = await page.locator('.cm-fee-map svg').evaluate(node => {
          const view = node.viewBox.baseVal
          return [...node.querySelectorAll('rect')].every(rect => { const box = rect.getBBox(); return box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width + 1 && box.y + box.height <= view.height + 1 })
        })
        assert.ok(geometry, 'nested rectangles stay within the map')
      }
      if (view === '步骤热力图') {
        await page.locator('[data-grid-step]').first().waitFor()
        assert.ok(await page.locator('[data-grid-step]').count() < 870, 'only visible step cells mount')
        assert.equal(await page.locator('.cm-grid-viewport').evaluate(node => node.scrollWidth > node.clientWidth + 1), false)
      }
    }
  }
  await page.setViewportSize({ width: 1180, height: 900 })
  await chart.getByRole('button', { name: '父子归属', exact: true }).click()
  const tree = page.locator('.cm-fee-tree')
  assert.equal(await tree.locator('[data-fee-agent="child-b"]').count(), 0, 'descendant is hidden while its parent is collapsed')
  await tree.locator('[data-fee-agent="child-a"] .cm-fee-tree-toggle').click()
  await tree.locator('[data-fee-agent="child-b"]').waitFor()
  assert.ok(await tree.evaluate(node => node.getBoundingClientRect().width / node.closest('.cm-step-costs,.cm-step-cards').getBoundingClientRect().width) > .9, 'ownership tree uses the full available chart width')
  await tree.locator('[data-fee-agent="child-a"] .cm-fee-link').click()
  await popup.locator('.cm-fee-popup-step').first().waitFor()
  assert.ok(requests.some(query => query.agent === 'child-a' && !query.stepKey))
  const agentRows = await getSessionTrajectory(ledger, ctx, { sessionId: 'root', basis: 'total', order: 'cost', agent: 'child-a' })
  assert.equal(agentRows.matchingSteps, 780)
  await assertStepInspection(agentRows.steps[0])
  const secondStep = popup.locator('.cm-fee-popup-step').nth(1)
  await secondStep.click()
  await assertStepInspection(agentRows.steps[1])
  await closePopup()
  await chart.getByRole('button', { name: '矩形分布', exact: true }).click()
  await chart.getByRole('button', { name: '按代理', exact: true }).click()
  const agentHeader = page.locator('.cm-fee-category-head').filter({ has: page.locator('title', { hasText: '子代理 1 · 资料收集' }) }).first()
  await agentHeader.click()
  await page.waitForFunction(() => document.querySelector('.cm-fee-breadcrumb')?.textContent.includes('子代理 1'))
  assert.equal(await page.locator('.cm-fee-category').count(), 1, 'category zoom fills the map')
  assert.equal(await page.locator('[data-fee-operation]').count(), initial.hierarchy.find(row => row.id === 'child-a').operations.length, 'agent leaves cover its complete own operation costs')
  const ownRead = initial.hierarchy.find(row => row.id === 'child-a').operations.find(row => row.key === 'read')
  await page.locator('[data-fee-operation="read"]').click()
  await popup.locator('.cm-fee-popup-step').first().waitFor()
  const ownReadRows = await getSessionTrajectory(ledger, ctx, { sessionId: 'root', basis: 'total', order: 'cost', agent: 'child-a', operation: 'read', ownOnly: true })
  assert.equal(ownReadRows.matchingSteps, ownRead.steps)
  await assertStepInspection(ownReadRows.steps[0])
  assert.ok(requests.some(query => query.agent === 'child-a' && query.operation === 'read'))
  await closePopup()
  assert.match(await page.locator('.cm-fee-breadcrumb').innerText(), /当前对话.*子代理 1/s)
  await page.locator('.cm-fee-map svg').hover()
  await page.mouse.move(0, 0)
  assert.equal((await page.locator('.cm-fee-map-status').innerText()).trim(), '', 'hover inspection clears when the mouse leaves')
  await page.locator('.cm-fee-breadcrumb').getByRole('button', { name: '当前对话', exact: true }).click()
  await chart.getByRole('button', { name: '按用途', exact: true }).click()
  const readHeader = page.locator('.cm-fee-category-head').filter({ has: page.locator('title', { hasText: '读取文件' }) }).first()
  await readHeader.click()
  assert.equal(await page.locator('.cm-fee-category').count(), 1)
  await page.locator('[data-fee-operation]').first().click()
  await popup.locator('.cm-fee-popup-step').first().waitFor()
  assert.ok(requests.some(query => query.operation === 'read' && query.operationGroup))
  await popup.locator('.cm-call-content').waitFor()
  await closePopup()

  // A cell remains one exact step even beyond the 400-row metadata page boundary.
  await chart.getByRole('button', { name: '步骤热力图', exact: true }).click()
  await page.locator('[data-grid-step]').first().waitFor()
  const grid = page.locator('.cm-step-grid')
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.evaluate(() => { document.getElementById('root').style.maxWidth = '1400px' })
  await page.waitForFunction(() => document.querySelectorAll('.cm-step-cell').length > 800)
  await page.waitForFunction(() => document.querySelectorAll('.cm-step-cell:disabled').length === 0)
  assert.ok(requests.some(query => query.detail === 'map' && query.offset === 400), 'a wide viewport loads the middle metadata page too')
  await page.evaluate(() => { document.getElementById('root').style.maxWidth = '' })
  await page.setViewportSize({ width: 1180, height: 900 })
  const timeRows = (await getSessionTrajectory(ledger, ctx, { sessionId: 'root', detail: 'map', offset: 400 })).steps
  await grid.getByRole('spinbutton', { name: '定位步骤序号', exact: true }).fill('450')
  await grid.getByRole('button', { name: '定位', exact: true }).click()
  const lateCell = grid.locator('[data-grid-index="449"][data-grid-step]')
  await lateCell.waitFor()
  assert.equal(await lateCell.getAttribute('data-grid-step'), timeRows[49].key)
  assert.ok(requests.some(query => query.detail === 'map' && query.offset === 400))
  await lateCell.hover()
  assert.match(await grid.locator('.cm-fee-map-status').innerText(), /步骤/)
  await page.mouse.move(0, 0)
  assert.equal((await grid.locator('.cm-fee-map-status').innerText()).trim(), '')
  await lateCell.click()
  await popup.locator('.cm-step-rates').waitFor()
  assert.equal(requests.at(-1).stepKey, timeRows[49].key)
  assert.match(await popup.innerText(), /输入|缓存读取/)
  await assertStepInspection(timeRows[49])
  await closePopup()
  assert.equal(await lateCell.evaluate(node => document.activeElement === node), true, 'closing step details restores the selected cell focus')
  await grid.getByRole('combobox', { name: '热力图排序', exact: true }).selectOption('cost')
  await page.waitForFunction(key => document.querySelector('[data-grid-index="0"]')?.dataset.gridStep === key, initial.steps[0].key)
  assert.ok(requests.some(query => query.detail === 'map' && query.order === 'cost'))
  await grid.getByRole('combobox', { name: '步骤类别', exact: true }).selectOption('read')
  await page.waitForFunction(count => document.querySelector('.cm-grid-caption')?.textContent.includes(count + ' 步'), initial.operations.find(row => row.key === 'read').steps)
  await grid.getByRole('combobox', { name: '步骤代理', exact: true }).selectOption('child-a')
  await page.waitForFunction(count => document.querySelector('.cm-grid-caption')?.textContent.includes(count + ' 步'), ownRead.steps)
  const filteredCells = await grid.locator('[data-grid-step]').evaluateAll(nodes => nodes.map(node => ({ key: node.dataset.gridStep, label: node.getAttribute('aria-label') })))
  assert.ok(filteredCells.every(row => row.key.startsWith('child-a:') && row.label.includes('read_file')))
  await grid.getByRole('combobox', { name: '步骤类别', exact: true }).selectOption('')
  await page.waitForFunction(() => document.querySelector('.cm-grid-caption')?.textContent.includes('400 步'))
  assert.ok(requests.some(query => query.detail === 'map' && query.agent === 'child-a' && query.ownOnly === true && !query.operation), 'agent selector shows only that agent\'s own steps')
  await grid.getByRole('combobox', { name: '步骤代理', exact: true }).selectOption('')
  await grid.getByRole('combobox', { name: '热力图排序', exact: true }).selectOption('time')
  await page.waitForFunction(() => document.querySelector('.cm-grid-caption')?.textContent.includes('870 步'))
  const freeKey = 'root:' + JSON.stringify(['model', 1, 2, null]), unpricedKey = 'root:' + JSON.stringify(['model', 1, 3, null])
  await page.waitForFunction(key => [...document.querySelectorAll('[data-grid-step]')].some(node => node.dataset.gridStep === key), freeKey)
  assert.ok(await grid.locator('[data-grid-step]').evaluateAll((nodes, key) => nodes.some(node => node.dataset.gridStep === key && /· ¥0 ·/.test(node.getAttribute('aria-label'))), freeKey), 'zero-cost steps remain visible')
  assert.ok(await grid.locator('[data-grid-step]').evaluateAll((nodes, key) => nodes.some(node => node.dataset.gridStep === key && node.dataset.unpriced === 'true'), unpricedKey), 'unpriced steps remain visible and marked')
  await chart.getByRole('button', { name: '归类占比', exact: true }).click()
  await page.evaluate(() => window.chooseBasis('api'))
  await page.waitForFunction(() => document.querySelector('.cm-fee-stats')?.textContent.includes('789'))
  const apiValue = await getSessionTrajectory(ledger, ctx, { sessionId: 'root', basis: 'api' })
  assert.equal(apiValue.totalSteps, 789)
  await page.evaluate(() => window.chooseBasis('plan'))
  await page.waitForFunction(() => document.querySelector('.cm-fee-stats')?.textContent.includes('81'))
  assert.equal((await getSessionTrajectory(ledger, ctx, { sessionId: 'root', basis: 'plan' })).totalSteps, 81)
  // A new billed event is reflected without clearing the map or reopening the page.
  await page.evaluate(() => window.chooseBasis('total'))
  await page.waitForFunction(() => document.querySelector('.cm-fee-stats')?.textContent.includes('870'))
  records.get('root').push({ type: 'assistant/message', seq: 9999, time: at + 9999, data: { turn: 1, step: 999, usage: { inputTokens: 300, outputTokens: 10 } } })
  await page.evaluate(() => window.refreshCosts())
  assert.equal(await page.locator('.cm-fee-placeholder').count(), 0, 'cached fees remain visible through a background update')
  await page.waitForFunction(() => document.querySelector('.cm-fee-stats')?.textContent.includes('871'))
  assert.equal(await page.locator('.cm-fee-placeholder').count(), 0)
  assert.equal(await page.locator('.cm-fee-updating').count(), 0, 'the UI automatically receives the completed background calculation')
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  assert.ok(Math.max(...sizes) < 262144)
  console.log(JSON.stringify({ steps: 870, views: 4, themes: 2, widths: [1600, 1180, 390], rankPage: 120, hierarchyFilter: 780, gridAgentOwnSteps: 400, exactGridStep: 450, zeroAndUnpriced: true, maxResponseBytes: Math.max(...sizes), browserErrors: errors.length, externalRequests: external.length }))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
