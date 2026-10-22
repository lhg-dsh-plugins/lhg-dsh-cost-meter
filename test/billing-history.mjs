import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'
import { replaySessionRecords, recomputeLedgerPricingBasis } from '../lib/backfill.js'
import { costFromSamples, turnCostFromRecords } from '../lib/turn-cost.js'
import { pricingConfigAt, pricingHistoryFingerprint } from '../lib/billing-history.js'
import { __testProjection } from '../lib/index.js'
import { PROVIDER_PRICES_2026_10_03 } from '../lib/provider-prices.js'
import { providerPriceEntryFor } from '../lib/pricing.js'

const root = mkdtempSync(join(tmpdir(), 'cm-price-history-'))
const path = join(root, 'ledger.json'), at = Date.parse('2026-10-15T08:00:00Z')
const clock = Date.now
let now = at, ledger
Date.now = () => now
const tokens = { input: 100000, output: 20000, cacheRead: 50000, cacheWrite: 10000, reasoning: 2000 }
const usage = Object.fromEntries(Object.entries(tokens).map(([key, n]) => [key + 'Tokens', n]))
const rates = { cacheMiss: 2, output: 8, cacheHit: .5, cacheWrite: 3, reasoning: 1 }
const config = sanitizeConfig({ prices: { providers: { fixture: { models: { model: rates } } } }, peakEnabled: false, exchangeRate: 7 })
const records = (id, time, step = 0) => [
  { type: 'session', id, createdAt: time - 100 },
  { type: 'request/header', seq: 0, time, data: { header: { config: { provider: 'fixture', model: 'model' } } } },
  { type: 'turn/start', seq: 1, time, data: { turn: 0 } },
  { type: 'step/start', seq: 2, time, data: { turn: 0, step } },
  { type: 'assistant/message', seq: 3, time: time + 10, data: { turn: 0, step, usage } },
  { type: 'turn/end', seq: 4, time: time + 11, data: { turn: 0 } },
]
const detail = (rows, cfg = ledger.config) => costFromSamples(replaySessionRecords(rows, cfg, null, true).samples, cfg)
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
try {
  // A pre-versioning file must keep its pre-migration rates through the first flush.
  const legacyPath = join(root, 'legacy.json')
  writeFileSync(legacyPath, JSON.stringify({ version: 1, config: sanitizeConfig({ prices: { providers: PROVIDER_PRICES_2026_10_03 } }), days: {}, migrations: ['provider-catalog-2026-10-03'] }))
  let upgraded = Ledger.load(legacyPath)
  const sonnetRead = cfg => providerPriceEntryFor('anthropic', 'claude-sonnet-5-5', cfg.prices).entry.cacheHit
  near(sonnetRead(upgraded.config), .1)
  near(sonnetRead(pricingConfigAt(upgraded.config, at - 10000)), .2)
  upgraded.scheduleWrite(); upgraded.close(); upgraded = Ledger.load(legacyPath)
  near(sonnetRead(pricingConfigAt(upgraded.config, at - 10000)), .2)
  upgraded.close()

  ledger = new Ledger(config, {}, path)
  const oldRecords = records('old', at)
  ledger.account(tokens, 'model', 'old', at, 'fixture')
  const original = detail(oldRecords), oldTotal = Object.values(ledger.days).reduce((sum, day) => sum + day.cost, 0)
  const originalRates = original.rows.map(row => row.rate)
  ledger.flush()
  now += 1000
  const next = structuredClone(ledger.config)
  for (const key of ['cacheMiss', 'cacheHit', 'cacheWrite', 'output', 'reasoning']) next.prices.providers.fixture.models.model[key] *= 10
  ledger.config = next
  ledger.scheduleWrite()
  near(Object.values(ledger.days).reduce((sum, day) => sum + day.cost, 0), oldTotal)
  near(detail(oldRecords).cost, original.cost)
  assert.deepEqual(detail(oldRecords).rows.map(row => row.rate), originalRates)
  now += 100
  ledger.account(tokens, 'model', 'new', now, 'fixture')
  near(detail(records('new', now)).cost, original.cost * 10)
  // One replay crosses price versions for the same model: a per-replay lookup
  // cache must retain the catalog/override identity, not just provider + model.
  const mixed = [...records('mixed', at, 1), ...records('mixed', now, 2).filter(row => row.type !== 'session')]
  const mixedDetail = detail(mixed)
  assert.equal(mixedDetail.calls.length, 2)
  near(mixedDetail.calls[0].cost, original.cost)
  near(mixedDetail.calls[1].cost, original.cost * 10)
  near(Object.values(ledger.days).reduce((sum, day) => sum + day.cost, 0), oldTotal * 11)

  // A call starting before an edit and ending after it retains its start price.
  const crossing = records('crossing', at + 900)
  crossing[4].time = at + 1200; crossing[5].time = at + 1201
  near(detail(crossing).cost, original.cost)
  near(turnCostFromRecords(crossing, ledger.config, 1, 4).cost, original.cost)
  const projection = __testProjection.makeCostUsageProjection(ledger)
  const state = crossing.slice(1).reduce((state, event) => projection.apply(state, event), projection.init({ id: 'crossing', createdAt: at }, 0))
  near(projection.view(state).cost, original.cost)

  const versionCount = Object.keys(ledger.pricingHistory.versions).length
  ledger.config = { ...ledger.config, locale: 'en', balance: { ...ledger.config.balance, apiKey: 'fixture-secret-must-not-be-copied' } }
  assert.equal(Object.keys(ledger.pricingHistory.versions).length, versionCount)
  assert.ok(!JSON.stringify(ledger.pricingHistory).includes('fixture-secret'))
  ledger.scheduleWrite(); ledger.close()
  ledger = Ledger.load(path)
  near(detail(oldRecords).cost, original.cost)
  assert.deepEqual(detail(oldRecords).rows.map(row => row.rate), originalRates)

  // Currency changes and remapping affect new calls only.
  now += 1000
  const switched = structuredClone(ledger.config)
  switched.prices.currency = 'CNY'
  switched.prices.providers.fixture.models.model.cny = { cacheMiss: 700, cacheHit: 70, output: 700, cacheWrite: 70 }
  switched.exchangeRate = 9
  ledger.config = switched
  near(detail(oldRecords).cost, original.cost)
  ledger.config = { ...ledger.config, priceOverrides: { 'fixture:model': '__local__' } }
  near(detail(oldRecords).cost, original.cost)
  now += 100
  assert.equal(detail(records('zero', now)).cost, 0)

  // Explicit repricing preserves old amounts and versions; incomplete logs remain untouched.
  now += 1000
  ledger.config = next
  const sessions = join(root, 'sessions')
  for (const [id, rows] of [['old', oldRecords], ['new', records('new', at + 1100)]]) {
    const directory = join(sessions, 'project', id); mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'session.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  }
  ledger.account(tokens, 'model', 'missing-log', now, 'fixture')
  const missingCost = ledger.days[localDayKey(now)].sessions.find(row => row.id === 'missing-log').cost
  const fingerprint = pricingHistoryFingerprint(ledger.config)
  const changed = await recomputeLedgerPricingBasis(ledger, sessions, undefined, null, true)
  assert.equal(changed.recostedSessions, 2)
  assert.equal(changed.skippedSessions, 1)
  near(detail(oldRecords).cost, original.cost * 10)
  near(ledger.days[localDayKey(now)].sessions.find(row => row.id === 'missing-log').cost, missingCost)
  assert.notEqual(pricingHistoryFingerprint(ledger.config), fingerprint)
  const revision = Object.values(ledger.pricingHistory.revisions).find(row => row.sessionId === 'old')
  near(revision.before.cost, original.cost); near(revision.after.cost, original.cost * 10)
  assert.ok(Object.keys(ledger.pricingHistory.versions).length >= versionCount)
  ledger.scheduleWrite(); ledger.flush()
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  assert.ok(Object.values(saved.pricingHistory.revisions).some(row => row.before.cost === revision.before.cost))
  ledger.close(); ledger = Ledger.load(path)
  near(detail(oldRecords).cost, original.cost * 10)
  now += 1000
  ledger.config = { ...ledger.config, prices: config.prices }
  near(detail(oldRecords).cost, original.cost * 10, 'later edits cannot undo an explicit recalculation')

  now += 1000
  await recomputeLedgerPricingBasis(ledger, sessions, undefined, null, true)
  near(detail(oldRecords).cost, original.cost)
  const oldRevisions = Object.values(ledger.pricingHistory.revisions).filter(row => row.sessionId === 'old')
  assert.equal(oldRevisions.length, 2, 'repeated recalculations append records instead of replacing the original')
  assert.deepEqual(oldRevisions[0], revision, 'the very first amount and price reference remain intact')

  // Independent writers keep both price versions and the same original baseline.
  ledger.scheduleWrite(); ledger.flush()
  const other = Ledger.load(path)
  now += 1000
  ledger.config = { ...ledger.config, exchangeRate: 8 }
  ledger.scheduleWrite(); ledger.flush()
  now += 1000
  other.config = { ...other.config, priceMatch: 'exact' }
  other.scheduleWrite(); other.flush(); other.close()
  ledger.refresh()
  assert.equal(pricingConfigAt(ledger.config, at).exchangeRate, 7)
  near(detail(oldRecords).cost, original.cost)
  console.log('[ok] historical pricing: edits, new calls, stream boundaries, restart, currencies, mappings, explicit recalculation, original amounts and concurrent writers')
} finally {
  ledger?.close(); Date.now = clock
  rmSync(root, { recursive: true, force: true })
}
