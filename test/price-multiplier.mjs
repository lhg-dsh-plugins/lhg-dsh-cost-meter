import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizePrice, tierFor, costOf, providerPriceEntryFor } from '../lib/pricing.js'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { createPricingHistory, advancePricingHistory, bindPricingHistory, pricingConfigAt, normalizePricingHistory } from '../lib/billing-history.js'

const source = readFileSync(new URL('../src/client/02-validators-helpers-sidebar.js', import.meta.url), 'utf8')
const client = new Function(source.slice(source.indexOf('function priceEntryFor(modelId, table)'), source.indexOf('function makeStore(initial,'))
  + '\nreturn { normalizeClientPrice, tierFor, resolveClientPrice, costOfBuckets }')()
const base = { cacheMiss: 2, cacheHit: .5, cacheWrite: 3, output: 8, reasoning: 1 }
const entry = { ...base, multiplier: .8, offPeak: { ...base, output: 4 }, peak: { ...base, output: 16 },
  legacyBase: { ...base, output: 2 }, longContext: { ...base, aboveInputTokens: 200000 },
  cny: { cacheMiss: 20, cacheHit: 5, cacheWrite: 30, output: 80 },
  rateHistory: [{ ...base, output: 6, before: '2026-09-01T00:00:00Z' }] }
const near = (a, b) => assert.ok(Math.abs(a-b) < 1e-10, `${a} != ${b}`)
const now = Date.parse('2026-10-15T08:00:00Z')
const peak = { enabled: true, effectiveAtMs: Date.parse('2026-08-16T16:00:00Z'), windows: [{ start: 6, end: 10 }], holidays: [] }
const normalized = normalizePrice(entry)
assert.equal(normalized.cacheMiss, 2, 'stored unit rate stays original')
assert.deepEqual(normalizePrice(normalized), normalized, 'normalization never compounds the factor')
for (const [time, cfg, output] of [[now, undefined, 6.4], [now, peak, 12.8], [now + 4*3600000, peak, 3.2], [Date.parse('2026-08-01T00:00Z'), peak, 1.6], [Date.parse('2026-08-25T00:00Z'), undefined, 4.8]]) {
  const back = tierFor(normalized, time, cfg), front = client.tierFor(client.normalizeClientPrice(entry), time, cfg)
  near(back.output, output); assert.deepEqual(front, back)
}
const tokens = { input: 100000, cacheRead: 50000, cacheWrite: 10000, output: 20000, reasoning: 2000 }
near(costOf(tokens, normalized, now), costOf(tokens, normalizePrice({ ...entry, multiplier: 1 }), now) * .8)
near(costOf({ input: 1e6 }, normalized, now), 1.6)
assert.equal(tierFor(normalized, now).longContext.aboveInputTokens, 200000, 'threshold is not multiplied')
near(costOf({ input: 1e6 }, normalizePrice({ ...base, multiplier: 0 }), now), 0)
near(costOf({ cacheWrite: 1e6 }, normalizePrice({ cacheMiss: 2, cacheHit: .5, output: 8, multiplier: .8 }), now), .4)

const separate = { ...entry, separateMultipliers: true, multipliers: { 'base.cacheMiss': .3, 'base.output': 2, 'peak.output': .25, 'longContext.cacheMiss': .2, 'cny.output': .5 } }
near(tierFor(normalizePrice(separate), now).cacheMiss, .6)
near(tierFor(normalizePrice(separate), now).output, 16)
near(tierFor(normalizePrice(separate), now, peak).output, 4)
near(costOf({ input: 1e6 }, normalizePrice(separate), now), .4)
near(tierFor(normalizePrice({ ...separate, separateMultipliers: false }), now).output, 6.4)
const config = sanitizeConfig({ prices: { currency: 'CNY', models: { 'test-deepseek': separate }, default: separate, providers: { fixture: { models: { model: separate } } } } })
const selected = providerPriceEntryFor('fixture', 'model', config.prices)
assert.equal(selected.currency, 'CNY')
near(costOf({ output: 1e6 }, selected.entry, now), 40)
near(costOf({ input: 1e6 }, selected.entry, now), 16)
const front = client.resolveClientPrice('fixture', 'model', config)
assert.deepEqual(front.entry, selected.entry)
const codec = stateSchema.shape.config.parse(config)
assert.deepEqual(codec.prices.models['test-deepseek'].multipliers, separate.multipliers)
assert.equal(codec.prices.default.multiplier, .8)
assert.deepEqual(codec.prices.providers.fixture.models.model.multipliers, separate.multipliers)
for (const bad of [{ multiplier: -1 }, { multiplier: Infinity }, { multiplier: '0.5' }, { multiplier: 1e308 },
  { separateMultipliers: 'true' }, { multipliers: null }, { multipliers: [] }, { multipliers: { 'bad.path': 2 } },
  { multipliers: { 'base.output': -2 } }, { separateMultipliers: true, multipliers: { 'peak.output': 1e308 } }]) {
  assert.equal(normalizePrice({ ...entry, ...bad }), null)
  assert.ok(applyConfigPatch(config, { prices: { providers: { fixture: { models: { model: { ...entry, ...bad } } } } } }).errors.length)
}

// Editing a multiplier creates a new price version. Existing calls and serialized history keep theirs.
const original = sanitizeConfig({ prices: { providers: { fixture: { models: { model: { ...base, multiplier: 1 } } } } } })
const history = createPricingHistory(original)
const patch = applyConfigPatch(original, { prices: { providers: { fixture: { models: { model: separate } } } } })
assert.deepEqual(patch.errors, [])
assert.equal(advancePricingHistory(history, patch.config, now), true)
const restored = normalizePricingHistory(JSON.parse(JSON.stringify(history)), patch.config)
bindPricingHistory(patch.config, restored)
for (const [at, expected] of [[now - 1, 8], [now + 1, 16]]) {
  const cfg = pricingConfigAt(patch.config, at)
  const price = providerPriceEntryFor('fixture', 'model', cfg.prices).entry
  near(tierFor(price, at).output, expected)
}
const changed = structuredClone(patch.config)
changed.prices.providers.fixture.models.model.multipliers['base.output'] = .4
assert.equal(advancePricingHistory(restored, changed, now + 100), true, 'individual factor changes create a distinct price version')
console.log('[ok] Price multipliers: raw rates, tiers, currencies, client parity, validation, immutable history')
