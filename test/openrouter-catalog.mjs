import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createOpenRouterCatalog } from '../lib/openrouter-catalog.js'
import { OPENROUTER_MODELS_URL } from '../lib/pricing.js'
import { TYPERT } from '../lib/typert.host.js'

let factory
vm.runInNewContext(readFileSync(new URL('../lib/client.openrouter.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: chunk => { factory = chunk.factory } } },
})
const ui = factory(() => ({}))
const host = TYPERT.invocations.find(row => row.method === 'getOpenRouterCatalog').result.create()
let clock = Date.parse('2026-10-09T05:00:00Z'), calls = 0, mode = 'ok', signal, hold
const catalog = createOpenRouterCatalog({ now: () => clock, fetchImpl: async (url, init) => {
  assert.equal(url, OPENROUTER_MODELS_URL, 'only the public catalog endpoint is allowed')
  assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error')
  assert.deepEqual(Object.keys(init.headers).sort(), ['accept-encoding', 'user-agent'], 'no key, cookie or authorization headers')
  signal = init.signal; calls++
  if (hold) await hold
  if (mode === 'http') return new Response('', { status: 429 })
  if (mode === 'invalid') return Response.json({ data: [] })
  if (mode === 'large') return new Response(' '.repeat(4 * 1024 * 1024 + 1))
  return Response.json({ data: [
    { id: 'vendor/flash', name: 'Vendor Flash', context_length: 128000, pricing: { prompt: mode === 'higher' ? '0.000005' : '0.000001', completion: '0.000002', input_cache_read: '0', input_cache_write: '0.000003' } },
    { id: 'vendor/flash:free', pricing: { prompt: '0', completion: '0' } },
    { id: 'vendor/tiny', pricing: { prompt: '1e-13', completion: '1e-13' } },
    { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
  ] })
} })
try {
  let release
  hold = new Promise(r => { release = r })
  const first = catalog.read()
  assert.equal(catalog.read(), first, 'concurrent windows share one request')
  release(); hold = null
  const value = await first
  assert.equal(value.error, '')
  for (const parse of [v => host.parse(v), ui.parseCatalog]) {
    const parsed = parse(value)
    assert.equal(parsed.models.length, 3)
    assert.equal(parsed.models[0].input, 1); assert.equal(parsed.models[0].cachedInput, 0)
    assert.equal(parsed.models[1].cachedInput, null, 'missing cache price is not free')
    assert.equal(parsed.models[2].input, 1e-7, 'tiny positive rate is retained')
    assert.throws(() => parse({ ...value, models: [{ ...value.models[0], input: -1 }] }))
  }
  assert.equal(ui.priceText(0), '$0'); assert.equal(ui.priceText(1e-7), '$1e-7'); assert.equal(ui.priceText(null), '—')
  assert.equal(new URL(ui.modelUrl('//attacker.example/?x')).origin, 'https://openrouter.ai')
  await catalog.read(); assert.equal(calls, 1, 'rapid manual refreshes use the shared cache')
  clock += 15000; mode = 'higher'
  const higher = await catalog.read()
  assert.equal(higher.models[0].input, 5)
  assert.deepEqual([...ui.changedRates(value, higher)], ['vendor/flash'])
  for (mode of ['http', 'invalid', 'large']) {
    clock += 15000
    const stale = await catalog.read()
    assert.equal(stale.stale, true); assert.ok(stale.error)
    assert.equal(stale.fetchedAt, higher.fetchedAt, 'failure does not claim a fresh timestamp')
    assert.deepEqual(stale.models, higher.models, 'failure keeps last successful rates')
    const attempts = calls; await catalog.read(); assert.equal(calls, attempts, 'failed requests are briefly cached too')
  }
  mode = 'ok'; clock += 15000
  hold = new Promise(r => { release = r })
  const late = catalog.read(); catalog.dispose(); release()
  await assert.rejects(late, /disposed/)
  assert.equal(signal.aborted, true)
  await assert.rejects(catalog.read(), /disposed/)
} finally { catalog.dispose() }

const timed = createOpenRouterCatalog({ timeoutMs: 10, fetchImpl: async (_, init) => new Response(new ReadableStream({ start(stream) {
  init.signal.addEventListener('abort', () => stream.error(init.signal.reason), { once: true })
} })) })
const keepAlive = setTimeout(() => {}, 1000)
try {
  const result = await timed.read()
  assert.match(result.error, /timed out/); assert.equal(result.models.length, 0); assert.equal(result.fetchedAt, '')
} finally { timed.dispose(); clearTimeout(keepAlive) }
console.log('[ok] #244 public catalog: credential-free GET, prices/codecs, changes, cache, stale fallback, body bounds and cancellation')
