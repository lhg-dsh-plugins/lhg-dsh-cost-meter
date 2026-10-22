import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import vm from 'node:vm'

const req = createRequire(resolve(process.argv[2] ?? process.env.DSH_TEST_NODE_MODULES, '__catalog.cjs'))
const { JSDOM } = req('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true })
const saved = Object.getOwnPropertyDescriptors(globalThis)
for (const key of ['window', 'document', 'navigator', 'HTMLElement']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = req('react'), { createRoot } = req('react-dom/client'), { act, Simulate } = req('react-dom/test-utils')
let hidden = false, tick, stopped = false, factory, calls = 0, failure = false, release
Object.defineProperty(document, 'hidden', { get: () => hidden })
vm.runInNewContext(readFileSync(new URL('../lib/client.openrouter.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: chunk => { factory = chunk.factory } } }, document,
  setInterval: (fn, ms) => { assert.equal(ms, 60000); tick = fn; return 1 }, clearInterval: () => { stopped = true },
})
const ui = factory(() => React)
const model = (id, input = 1) => ({ id, name: id, contextLength: 128000, input, output: 3, cachedInput: null, cacheWrite: 0 })
let next = { fetchedAt: '2026-10-09T05:00:00Z', stale: false, error: '', models: [model('google/flash'), model('google/flash:free', 0), ...Array.from({ length: 60 }, (_, i) => model('vendor/model-' + i))] }
let wait = null
const api = { getOpenRouterCatalog: async () => { calls++; if (wait) await wait; if (failure) throw new Error('offline fixture'); return structuredClone(next) } }
const root = createRoot(document.getElementById('root'))
const render = async locale => { await act(async () => root.render(React.createElement(ui.PriceBrowser, { api, state: { config: { locale } }, resolveLocale: c => c.locale }))) }
const reopen = async locale => { await act(async () => root.render(null)); await render(locale) }
const button = label => [...document.querySelectorAll('button')].find(b => b.textContent === label)
try {
  await render('en')
  assert.equal(calls, 1); assert.equal(document.querySelectorAll('tbody tr').length, 50)
  assert.match(document.body.textContent, /No API key or inference charges/)
  await act(async () => button('Next').click())
  assert.equal(document.querySelectorAll('tbody tr').length, 12)
  await reopen('en')
  assert.equal(calls, 1, 'reopening a fresh catalog reuses its snapshot without a request')
  assert.equal(document.querySelectorAll('tbody tr').length, 12, 'reopening keeps the current page')
  const input = document.querySelector('input')
  await act(async () => Simulate.change(input, { target: { value: 'FLASH' } }))
  assert.equal(document.querySelectorAll('tbody tr').length, 2)
  assert.match(document.querySelector('tbody').textContent, /\$0/)
  await act(async () => Simulate.change(document.querySelector('select'), { target: { value: 'input' } }))
  assert.match(document.querySelector('tbody tr').textContent, /flash:free/)
  assert.equal(document.querySelector('tbody a').getAttribute('target'), '_blank')
  await reopen('en')
  assert.equal(calls, 1, 'search and sorting survive closing without refreshing')
  assert.equal(document.querySelector('input').value, 'FLASH')
  assert.equal(document.querySelector('select').value, 'input')
  assert.match(document.querySelector('tbody tr').textContent, /flash:free/)
  wait = new Promise(r => { release = r })
  await act(async () => { button('Refresh prices').click() })
  assert.equal(document.querySelectorAll('tbody tr').length, 2, 'refresh keeps existing rows')
  assert.equal(button('Refreshing…').disabled, true)
  const pendingCalls = calls
  await reopen('en')
  assert.equal(calls, pendingCalls, 'reopening shares an in-flight refresh')
  assert.equal(document.querySelectorAll('tbody tr').length, 2, 'cached rows stay visible during a shared refresh')
  assert.equal(button('Refreshing…').disabled, true)
  next = { ...next, fetchedAt: '2026-10-09T05:01:00Z', models: [model('google/flash', 5)] }
  await act(async () => { release(); await wait }); wait = null
  assert.match(document.body.textContent, /Price changed/)
  assert.match(document.querySelector('tbody').textContent, /\$5/)
  failure = true
  await act(async () => { await tick() })
  assert.match(document.querySelector('[role=alert]').textContent, /offline fixture/)
  assert.equal(document.querySelectorAll('tbody tr').length, 1, 'failed refresh keeps last catalog')
  hidden = true
  const beforeHidden = calls
  await act(async () => { await tick(); document.dispatchEvent(new window.Event('visibilitychange')) })
  assert.equal(calls, beforeHidden, 'hidden pages do not poll')
  hidden = false; failure = false
  await act(async () => document.dispatchEvent(new window.Event('visibilitychange')))
  assert.equal(calls, beforeHidden + 1, 'return to the foreground refreshes')
  next = { fetchedAt: '', stale: true, error: 'empty failed fixture', models: [] }
  await act(async () => button('Refresh prices').click())
  assert.match(document.querySelector('[role=alert]').textContent, /empty failed fixture/)
  assert.equal(document.querySelectorAll('tbody tr').length, 1, 'an empty error result retains the last usable catalog')
  const beforeReopen = calls
  await reopen('en')
  assert.equal(calls, beforeReopen, 'failed refresh is cached briefly instead of retrying on every visit')
  assert.match(document.querySelector('tbody').textContent, /\$5/)
  await render('zh')
  assert.match(document.body.textContent, /无需 API Key，不产生模型调用费用/)
  assert.ok(button('刷新价格')); assert.equal(calls, beforeReopen, 'language changes do not query')
  await act(async () => root.unmount())
  assert.equal(stopped, true)
  const beforeClose = calls
  document.dispatchEvent(new window.Event('visibilitychange')); await tick()
  assert.equal(calls, beforeClose, 'unmount removes listeners and prevents late requests')
} finally {
  dom.window.close()
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
    if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key]
  }
}
console.log('[ok] OpenRouter UI: cached reopen, retained search/sort/page, shared refresh, failed/empty response retention, foreground polling, bilingual copy and cleanup')
