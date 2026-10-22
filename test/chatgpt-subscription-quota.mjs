// Quota adapters use local fixtures; no account, OAuth or model request is loaded.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import vm from 'node:vm'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'

const prefix = '/api/dsh-chatgpt-subscription/'
const plain = value => JSON.parse(JSON.stringify(value))
const quota = (windows, state = 'ready') => ({ state, buckets: [{ id: 'code-review', windows: [{ usedPercent: 99, windowDurationMins: 10080 }] }, { id: 'codex', windows }] })
const win = (usedPercent, windowDurationMins, resetsAt = 1800000000) => ({ usedPercent, windowDurationMins, resetsAt })
const reply = value => ({ ok: true, json: async () => value })
const status = windows => ({ ok: true, value: { authenticated: true, quota: quota(windows) } })
const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
function chunk(path, fetch) {
  let factory
  vm.runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { factory = value.factory } } }, AbortSignal, fetch,
  })
  return factory(() => React)
}

for (const path of ['../src/codex/index.js', '../lib/client.codex.js']) {
  const calls = []
  let value = status([win(40, 300), win(17, 10080)])
  const page = chunk(path, async (url, options) => { calls.push({ url, options }); return reply(value) })
  assert.deepEqual(plain(await page.readChatgptQuota()), {
    five: { percent: 40, resetsAt: new Date(1800000000000).toISOString() },
    weekly: { percent: 17, resetsAt: new Date(1800000000000).toISOString() },
  }, 'used percentages are preserved; other buckets are excluded')
  assert.equal(calls[0].url, prefix + 'status')
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.method, undefined)
  assert.ok(calls[0].options.signal instanceof AbortSignal)
  value = { ok: true, value: quota([win(0, 300), win(100, 10080, null)]) }
  assert.deepEqual(plain(await page.readChatgptQuota(true)), {
    five: { percent: 0, resetsAt: new Date(1800000000000).toISOString() }, weekly: { percent: 100, resetsAt: '' },
  })
  assert.equal(calls[1].url, prefix + 'quota/refresh')
  assert.equal(calls[1].options.method, 'POST')
  assert.equal(calls[1].options.headers['content-type'], 'application/json')
  assert.equal(calls[1].options.body, '{}', 'refresh carries no identity or credential')
  value = status([win(83.34, 10080, 1e30)])
  assert.deepEqual(plain(await page.readChatgptQuota()), { weekly: { percent: 83.3, resetsAt: '' } }, 'weekly-only quota never invents a 5h window or reset')
  value = status([null, win(null, 300), win(NaN, 300), win(-1, 300), win(101, 300), win('40', 300), win(40, 60)])
  assert.deepEqual(plain(await page.readChatgptQuota()), {}, 'invalid and unsupported windows are omitted')
  value = { ok: true, value: { authenticated: true, quota: quota([win(17, 10080)], 'stale') } }
  assert.equal((await page.readChatgptQuota()).weekly.percent, 17, 'the plugin can retain its last quota snapshot')
  for (const invalid of [null, { ok: false }, { ok: true }, { ok: true, value: { authenticated: false, quota: quota([win(17, 10080)]) } },
    { ok: true, value: { authenticated: true, quota: quota([win(17, 10080)], 'error') } }]) {
    value = invalid
    assert.equal(await page.readChatgptQuota(), null, 'unavailable quota permits auto fallback')
  }
  for (const fetch of [async () => ({ ok: false }), async () => ({ ok: true, json: async () => { throw Error('invalid JSON') } }), async () => { throw Error('timeout') }]) {
    assert.equal(await chunk(path, fetch).readChatgptQuota(), null)
  }
}

const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, dir), 'utf8')).join('')
function client(fetch) {
  let factory, loads = 0
  const page = chunk('../lib/client.codex.js', fetch)
  vm.runInNewContext(source.replace('exports.apply = apply', 'exports.quotaTest = { fetchCodexQuota, codexQuotaCache, parseConfig }; exports.apply = apply'), {
    window: { __ModuleLoader__: { load: value => { factory = value.factory } } }, navigator: { language: 'en' },
    console, AbortSignal, fetch, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval,
  })
  const require = name => name === 'react' ? React : {}
  require.async = async path => { assert.equal(path, './client.codex.js'); loads++; return page }
  return { ui: factory(require).quotaTest, get loads() { return loads } }
}
const calls = []
let payload = status([win(17, 10080)])
const c = client(async (url, options) => { calls.push({ url, options }); return reply(payload) })
const changed = applyConfigPatch(sanitizeConfig({}), { codexQuotaSource: 'chatgpt' })
assert.deepEqual(changed.errors, [])
assert.equal(sanitizeConfig(changed.config).codexQuotaSource, 'chatgpt')
assert.equal(stateSchema.shape.config.parse(changed.config).codexQuotaSource, 'chatgpt')
assert.equal(c.ui.parseConfig(changed.config).codexQuotaSource, 'chatgpt')
assert.ok(applyConfigPatch(sanitizeConfig({}), { codexQuotaSource: 'unknown' }).errors.length > 0)
let rpcCalls = 0
c.ui.codexQuotaCache.rpc = { call: async () => { rpcCalls++; return { ok: false } } }
await c.ui.fetchCodexQuota(false, false, 'chatgpt')
assert.equal(c.loads, 0, 'disabled quota neither loads the adapter nor queries the plugin')
await c.ui.fetchCodexQuota(false, true, 'chatgpt')
assert.equal(rpcCalls, 0, 'explicit chatgpt never queries another plugin')
assert.equal(c.ui.codexQuotaCache.windows.weekly.percent, 17)
assert.equal(c.ui.codexQuotaCache.windows.five, undefined)
await c.ui.fetchCodexQuota(false, true, 'chatgpt')
assert.equal(calls.length, 1, 'success is shared and cached')
await c.ui.fetchCodexQuota(true, true, 'chatgpt')
assert.equal(calls.at(-1).url, prefix + 'quota/refresh')
await c.ui.fetchCodexQuota(false, true, 'auto')
assert.equal(rpcCalls, 1, 'auto retains the original subscription priority')
assert.equal(calls.at(-1).url, prefix + 'status')
assert.equal(c.ui.codexQuotaCache.status, 'ok')
c.ui.codexQuotaCache.rpc = { call: async () => ({ ok: true, value: { rateLimits: [{ id: 'codex', windows: [{ windowSeconds: 604800, remainingPercent: 70 }] }] } }) }
const before = calls.length
await c.ui.fetchCodexQuota(true, true, 'auto')
assert.equal(calls.length, before, 'a working subscription source skips chatgpt and connect')
assert.equal(c.ui.codexQuotaCache.windows.weekly.percent, 30)
let finish
const delayed = client((url) => url === prefix + 'status' ? new Promise(resolve => { finish = resolve }) : Promise.resolve(reply({ status: 'signed-in', usage: { rateLimits: [{ id: 'codex', windows: [{ windowSeconds: 604800, remainingPercent: 80 }] }] } })))
const pending = delayed.ui.fetchCodexQuota(false, true, 'chatgpt')
for (let n = 0; n < 6; n++) await Promise.resolve()
await delayed.ui.fetchCodexQuota(false, true, 'connect')
finish(reply(status([win(99, 10080)])))
await pending
assert.equal(delayed.ui.codexQuotaCache.source, 'connect')
assert.equal(delayed.ui.codexQuotaCache.windows.weekly.percent, 20, 'late chatgpt replies cannot overwrite the selected source')
const fallbackCalls = []
const fallback = client(async url => { fallbackCalls.push(url); return reply(url.startsWith(prefix) ? { ok: false } : { status: 'signed-in', usage: { rateLimits: [{ id: 'codex', windows: [{ windowSeconds: 604800, remainingPercent: 75 }] }] } }) })
fallback.ui.codexQuotaCache.rpc = { call: async () => ({ ok: false }) }
await fallback.ui.fetchCodexQuota(false, true, 'auto')
assert.deepEqual(fallbackCalls, [prefix + 'status', '/plugins/dsh-openai-codex/auth/status'])
assert.equal(fallback.ui.codexQuotaCache.windows.weekly.percent, 25)
fallbackCalls.length = 0
await fallback.ui.fetchCodexQuota(true, true, 'chatgpt')
assert.deepEqual(fallbackCalls, [prefix + 'quota/refresh'])
assert.equal(fallback.ui.codexQuotaCache.status, 'unavailable', 'an explicit failed source never displays another account')

// Execute the actual published parser and HTTP route, without initializing upstream.
if (process.env.DSH_TEST_CHATGPT_PACKAGE) {
  const read = path => execFileSync('tar', ['-xOf', process.env.DSH_TEST_CHATGPT_PACKAGE, 'package/' + path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const pkg = JSON.parse(read('package.json')), original = read(pkg.main)
  assert.equal(pkg.name, '@eddyskywalker/dsh-chatgpt-subscription')
  const region = name => { const start = original.indexOf('//#region ' + name); assert.ok(start >= 0); return original.slice(start, original.indexOf('//#endregion', start)) }
  const routes = region('src/host/routes.ts').replaceAll('import.meta.url', '"file:///quota-fixture.mjs"')
  const upstream = vm.runInNewContext(region('src/host/usage-service.ts') + '\n' + routes + '\n({ parseCodexUsage, registerRoutes })', {
    Buffer, URL, structuredClone, ROUTE_PREFIX$5: prefix.slice(0, -1), codexCliCredentialPresence: async () => false,
    isSameOriginMutation: request => request.headers.origin === 'http://' + request.headers.host,
    Error, PreferenceError: class extends Error {}, publicError: () => ({ code: 'not-authenticated', message: 'Test fixture signed out' }),
  })
  let handler, authenticated = true
  const reads = []
  const dispose = upstream.registerRoutes({ webServer: { register: row => { if (row.kind === 'prefix') handler = row.handler; return () => {} } } },
    { status: async () => ({ authenticated }) }, { status: async (signedIn, force) => {
      reads.push({ signedIn, force })
      return { state: signedIn ? 'ready' : 'signed-out', ...upstream.parseCodexUsage({ rate_limit: {
        primary_window: { used_percent: 40, limit_window_seconds: 18000, reset_at: 1800000000 },
        secondary_window: { used_percent: 17, limit_window_seconds: 604800, reset_at: 1800000001 },
      } }) }
    } }, { status: () => ({}) }, undefined, undefined, undefined, undefined, undefined, { adoptPaths: [] })
  const server = createServer(handler)
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const origin = 'http://127.0.0.1:' + server.address().port
  try {
    const live = chunk('../lib/client.codex.js', (url, options) => fetch(origin + url, { ...options, headers: { ...options.headers, origin } }))
    assert.deepEqual(Object.keys(await live.readChatgptQuota()), ['five', 'weekly'])
    assert.equal((await live.readChatgptQuota(true)).weekly.percent, 17)
    assert.deepEqual(plain(reads), [{ signedIn: true, force: false }, { signedIn: true, force: true }])
    authenticated = false
    assert.equal(await live.readChatgptQuota(), null)
    assert.equal(await live.readChatgptQuota(true), null)
    console.log('[ok] published ChatGPT subscription ' + pkg.version + ': original HTTP routes, quota parser, refresh and signed-out behavior')
  } finally { dispose(); server.closeAllConnections(); await new Promise(done => server.close(done)) }
}
console.log('[ok] ChatGPT Codex quota: source/config round trip, both windows, weekly-only, errors, cache, refresh, fallback and source races')
