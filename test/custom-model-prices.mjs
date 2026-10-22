import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeConfig, applyConfigPatch, Ledger } from '../lib/store.js'
import { providerPriceEntryFor, normalizeCustomPrice, buildPriceCatalog, costOf } from '../lib/pricing.js'
import { stateSchema } from '../lib/typert.host.js'
import { pricingConfigAt } from '../lib/billing-history.js'

const source = readFileSync('src/client/02-validators-helpers-sidebar.js', 'utf8')
const start = source.indexOf('function priceEntryFor(modelId, table)'), end = source.indexOf('function makeStore(initial,')
const client = new Function(source.slice(start, end) + '\nreturn { resolveClientPrice, cnyRateOfLocal }')()
assert.equal(client.cnyRateOfLocal({ currency: 'USD', exchangeRate: 1, fxRates: { CNY: 7 } }), 7)
assert.equal(client.cnyRateOfLocal({ currency: 'EUR', exchangeRate: .9, fxRates: { CNY: 7 } }), 7)
assert.equal(client.cnyRateOfLocal({ currency: 'CNY', exchangeRate: 8, fxRates: { CNY: 7 } }), 8)
const a = 'channel-a:shared/model', b = 'channel-b:shared/model'
const usd = { cacheMiss: 1, cacheHit: .1, output: 2, cacheWrite: 1.25, currency: 'USD' }
const cny = { cacheMiss: 7, cacheHit: .7, output: 14, currency: 'CNY' }
const base = sanitizeConfig({ prices: { providers: { official: { models: { 'shared/model': { input: 20, output: 40 } } } } } })
const patch = { priceOverrides: { [a]: '__custom__', [b]: '__custom__' }, prices: { custom: { [a]: usd, [b]: cny } } }
const applied = applyConfigPatch(base, patch)
assert.deepEqual(applied.errors, [])
let config = applied.config
for (const currency of ['USD', 'CNY']) for (const [provider, entry] of [['channel-a', usd], ['llm-channel-a', usd], ['channel-b', cny]]) {
  const cfg = { ...config, prices: { ...config.prices, currency } }
  const server = providerPriceEntryFor(provider, 'shared/model', cfg.prices, { overrides: cfg.priceOverrides })
  const browser = client.resolveClientPrice(provider, 'shared/model', cfg)
  assert.equal(server.priced, true); assert.equal(browser.priced, true)
  for (const result of [server, browser]) {
    assert.equal(result.currency, entry.currency)
    assert.equal(result.entry.cacheMiss, entry.cacheMiss)
    assert.equal(result.entry.cacheHit, entry.cacheHit)
    assert.equal(result.entry.output, entry.output)
    assert.equal(result.billingMode, 'flat')
  }
}
assert.deepEqual(config.prices.providers.official, base.prices.providers.official)
assert.equal(providerPriceEntryFor('other-channel', 'shared/model', config.prices).entry.cacheMiss, 20, 'custom quotes never enter fallback matching')
const wire = stateSchema.shape.config.parse(config)
assert.deepEqual(wire.prices.custom[a], config.prices.custom[a], 'strict wire retains per-model currency and all fields')
assert.deepEqual(sanitizeConfig(config).prices.custom, config.prices.custom, 'restart retains both channels')
const reset = applyConfigPatch(config, { priceOverrides: {} }).config
assert.equal(providerPriceEntryFor('channel-a', 'shared/model', reset.prices, { overrides: reset.priceOverrides }).entry.cacheMiss, 20)
assert.deepEqual(reset.prices.custom, config.prices.custom, 'automatic matching retains inactive custom quotes')
assert.deepEqual(applyConfigPatch(config, { prices: { custom: {} } }).config.prices.custom, {}, 'explicit removal uses replacement semantics')
for (const raw of [{ ...usd, cacheMiss: -1 }, { ...usd, output: Infinity }, { ...usd, cacheHit: '1' }, { ...usd, currency: 'EUR' }, { ...usd, cacheWrite: -1 }]) {
  assert.equal(normalizeCustomPrice(raw), null)
  assert.ok(applyConfigPatch(config, { prices: { custom: { [a]: raw } } }).errors.length)
}
assert.deepEqual(sanitizeConfig({ prices: { custom: { [a]: { ...usd, output: -1 } } } }).prices.custom, {})
const free = { ...config, prices: { ...config.prices, custom: { [a]: { cacheMiss: 0, cacheHit: 0, output: 0, currency: 'USD' } } } }
assert.equal(providerPriceEntryFor('channel-a', 'shared/model', free.prices, { overrides: free.priceOverrides }).priced, true)
const missing = { ...config, prices: { ...config.prices, custom: {} } }
assert.equal(providerPriceEntryFor('channel-a', 'shared/model', missing.prices, { overrides: missing.priceOverrides }).priced, false, 'missing quote never falls back to another catalog')
for (const [settings, expectedInput, expectedOutput] of [[{ multiplier: .8 }, .8, 1.6],
  [{ multiplier: .8, separateMultipliers: true, multipliers: { 'base.output': .3 } }, .8, .6], [{ multiplier: 0 }, 0, 0]]) {
  const cfg = { ...config, prices: { ...config.prices, custom: { [a]: { ...usd, ...settings } } } }
  const server = providerPriceEntryFor('channel-a', 'shared/model', cfg.prices, { overrides: cfg.priceOverrides })
  const browser = client.resolveClientPrice('channel-a', 'shared/model', cfg)
  for (const entry of [server.entry, browser.entry]) {
    assert.equal(entry.cacheMiss, 1, 'original quote is never repeatedly multiplied')
    assert.equal(costOf({ input: 1e6 }, entry, Date.now()), expectedInput)
    assert.equal(costOf({ output: 1e6 }, entry, Date.now()), expectedOutput)
  }
  assert.equal(stateSchema.shape.config.parse(cfg).prices.custom[a].multiplier, settings.multiplier)
}

const root = mkdtempSync(join(tmpdir(), 'cm-custom-price-')), file = join(root, 'ledger.json')
let ledger
try {
  ledger = new Ledger(config, {}, file)
  const at = Date.now() - 2000
  ledger.account({ input: 1e6, cacheRead: 0, output: 0, cacheWrite: 0, reasoning: 0 }, 'shared/model', 'a', at, 'channel-a')
  const before = Object.values(ledger.days).reduce((sum, day) => sum + day.cost, 0)
  config = applyConfigPatch(ledger.config, { prices: { custom: { ...config.prices.custom, [a]: { ...usd, cacheMiss: 9 } } } }).config
  ledger.config = config; ledger.scheduleWrite()
  assert.equal(Object.values(ledger.days).reduce((sum, day) => sum + day.cost, 0), before)
  assert.equal(pricingConfigAt(ledger.config, at).prices.custom[a].cacheMiss, 1, 'history keeps the original custom quote')
  ledger.close(); ledger = Ledger.load(file)
  assert.equal(ledger.config.prices.custom[a].cacheMiss, 9)
  assert.equal(pricingConfigAt(ledger.config, at).prices.custom[a].cacheMiss, 1, 'history keeps the original quote after reload')
} finally { ledger?.close(); rmSync(root, { recursive: true, force: true }) }

const catalog = buildPriceCatalog('USD'), stepfun = Object.values(catalog.stepfun).flatMap(models => Object.entries(models))
assert.equal(stepfun.length, 5)
for (const [id] of stepfun) {
  const price = providerPriceEntryFor('stepfun', id, sanitizeConfig({}).prices)
  assert.equal(price.priced, true); assert.equal(price.currency, 'USD')
}
assert.equal(providerPriceEntryFor('stepfun', 'stepfun/step-3.5-flash', sanitizeConfig({}).prices).entry.cacheMiss, .1)
assert.equal(providerPriceEntryFor('stepfun', 'gpt-6.1-sol', sanitizeConfig({}).prices).priced, false)
console.log('[ok] channel/model custom quotes: isolation, currencies, strict wire, validation, switches, restart, historical rates; 5 sourced StepFun models')
