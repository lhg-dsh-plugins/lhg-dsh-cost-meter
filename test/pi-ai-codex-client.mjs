import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'

const directory = new URL('../src/client/', import.meta.url)
const source = readdirSync(directory).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, directory), 'utf8')).join('')
let factory, reads = 0
const fixture = { status: 'ok', message: '', windows: { weekly: { percent: 17, resetsAt: '' } } }
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.quota = { fetchCodexQuota, resetCodexQuota, codexQuotaCache, parseConfig, descriptors: CONTRIBUTION.descriptors }; exports.apply = apply'), {
  window: { __ModuleLoader__: { load: mod => { factory = mod.factory } } }, navigator: { language: 'en' },
  AbortSignal: { timeout: () => AbortSignal.timeout(20) }, console, crypto: globalThis.crypto,
  setTimeout, clearTimeout, setInterval, clearInterval, fetch: () => { throw Error('unexpected HTTP fallback') },
})
const require = () => ({})
require.async = () => { throw Error('unexpected plugin fallback') }
const ui = factory(require).quota, plain = value => JSON.parse(JSON.stringify(value))
const changed = applyConfigPatch(sanitizeConfig({}), { codexQuotaSource: 'pi-ai' })
assert.deepEqual(changed.errors, [])
assert.equal(ui.parseConfig(changed.config).codexQuotaSource, 'pi-ai')
assert.equal(stateSchema.shape.config.parse(changed.config).codexQuotaSource, 'pi-ai')
const codec = ui.descriptors.find(row => row.method === 'getPiAiCodexQuota').result.schema
assert.deepEqual(plain(codec.parse(fixture)), fixture)
assert.throws(() => codec.parse({ ...fixture, windows: { weekly: { percent: 101, resetsAt: '' } } }))
const keepAlive = setInterval(() => {}, 1000)
try {
  ui.resetCodexQuota({ call: () => new Promise(() => {}) }, async () => { reads++; return { ok: true, value: fixture } })
  await ui.fetchCodexQuota(true, true, 'auto')
  assert.equal(reads, 1, 'an unresponsive subscription RPC times out and reaches native login')
  assert.equal(ui.codexQuotaCache.status, 'ok'); assert.equal(ui.codexQuotaCache.inFlight, null)
  assert.deepEqual(plain(ui.codexQuotaCache.windows), fixture.windows)
  ui.resetCodexQuota({}, () => new Promise(() => {}))
  await ui.fetchCodexQuota(true, true, 'pi-ai')
  assert.equal(ui.codexQuotaCache.status, 'unavailable'); assert.equal(ui.codexQuotaCache.inFlight, null)
  let release
  ui.resetCodexQuota({}, () => new Promise(resolve => { release = resolve }))
  const stale = ui.fetchCodexQuota(true, true, 'pi-ai')
  await new Promise(resolve => setTimeout(resolve, 0))
  ui.resetCodexQuota({}, async () => ({ ok: true, value: fixture }))
  await ui.fetchCodexQuota(true, true, 'pi-ai')
  release({ ok: true, value: { status: 'error', message: 'stale connection', windows: {} } })
  await stale
  assert.equal(ui.codexQuotaCache.status, 'ok', 'an old connection cannot overwrite the replacement connection')
  assert.equal(ui.codexQuotaCache.inFlight, null)
} finally { clearInterval(keepAlive) }
console.log('[ok] pi-ai client: config/descriptor codec, stalled RPC fallback, timeout retry and stale connection isolation')
