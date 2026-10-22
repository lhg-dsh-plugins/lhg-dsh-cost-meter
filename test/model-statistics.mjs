import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ledger, sanitizeConfig, applyConfigPatch, localDayKey, zeroDay } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { modelStatisticsAggregate } from '../lib/model-statistics.js'
import { codexRuntimeEnabled, codexCompatStatus } from '../lib/codex-subscription-compat.js'
import { apply } from '../lib/index.js'

const key = 'custom:model-a', other = 'other-channel:model-a'
const bucket = (cost, apiCost = cost) => ({ calls: 1, input: 10, output: 5, cacheRead: 2, cacheWrite: 0, reasoning: 0, cost, apiCost,
  costCny: cost * 6, apiCostCny: apiCost * 6, costEur: cost * .8, apiCostEur: apiCost * .8 })
const a = bucket(2), b = bucket(3, 0)
const day = { ...zeroDay(localDayKey(Date.now())), ...bucket(6, 3), calls: 3, byProviderModel: { [key]: a, [other]: b }, sessions: [] }
const original = JSON.stringify(day)
let config = sanitizeConfig({ modelStatistics: { [key]: { today: false, summary: true, budget: false } } })
assert.deepEqual(config.modelStatistics[key], { today: false, summary: true, budget: false })
const today = modelStatisticsAggregate(day, config, 'today')
assert.equal(today.cost, 4, 'exclude the selected model while retaining the unassigned residual')
assert.equal(today.apiCost, 1)
assert.equal(today.costCny, 24, 'preserve the recorded currency amounts')
assert.ok(Math.abs(today.apiCostEur - .8) < 1e-12)
assert.equal(today.calls, 2)
assert.equal(today.byProviderModel, day.byProviderModel, 'original model buckets remain available in settings')
assert.equal(modelStatisticsAggregate(day, config, 'summary'), day, 'monthly/all-time switch is independent')
assert.equal(modelStatisticsAggregate(day, config, 'budget').cost, 4)
assert.equal(JSON.stringify(day), original, 'statistics never rewrite call records or prices')
const replaced = applyConfigPatch(config, { modelStatistics: {} })
assert.deepEqual(replaced.errors, [])
assert.deepEqual(replaced.config.modelStatistics, {}, 'restoring all switches removes the exclusion instead of deep-merging it back')
for (const invalid of [null, [], { bad: { today: false } }, { [key]: { today: 'false' } }, { [key]: { unknown: false } }]) {
  assert.ok(applyConfigPatch(config, { modelStatistics: invalid }).errors.length, 'invalid switches are rejected')
}
assert.deepEqual(stateSchema.shape.config.parse(config).modelStatistics, config.modelStatistics, 'strict transport retains the settings')

const entry = { options: { name: 'dsh-codex-subscription' }, disabled: false, fiber: { state: 2 } }
const ctx = { get: name => name === 'loader' ? { entries: () => [entry] } : undefined }
assert.equal(codexRuntimeEnabled(ctx), true)
for (const state of [0, 1, 3, 4, 5]) { entry.fiber.state = state; assert.equal(codexRuntimeEnabled(ctx), false) }
entry.fiber.state = 2; entry.disabled = true
assert.equal(codexRuntimeEnabled(ctx), false, 'disabled owning group also hides the integration')
entry.disabled = false; entry.options.disabled = true
assert.equal(codexRuntimeEnabled(ctx), false)
assert.equal(codexRuntimeEnabled({}), false, 'an installed package alone is insufficient')
assert.equal(codexCompatStatus({}, { installed: true }, false).promptDue, false, 'disabled peers never prompt')

const home = mkdtempSync(join(tmpdir(), 'cm-model-statistics-')), previous = process.env.DSH_HOME, disposers = []
try {
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'storages/cost-meter'), { recursive: true })
  config = sanitizeConfig({ ...config, currency: 'USD', symbol: '$', exchangeRate: 1, hideOfficialBalance: true, goQuota: { enabled: false }, budget: { enabled: true, period: 'day' } })
  const path = join(home, 'storages/cost-meter/ledger.json')
  const seed = new Ledger(config, { [day.date]: day }, path); seed.scheduleWrite(); seed.close()
  let service
  apply({ on: () => () => {}, inject() {}, get: name => name === 'settings' ? { get: () => ({}) } : undefined,
    effect: fn => { const stop = fn(); if (typeof stop === 'function') disposers.push(stop) },
    provide: (name, value) => { if (name === 'costMeter') service = value }, logger: console })
  const snapshot = await service.getLocalState()
  assert.equal(snapshot.today.cost, 4)
  assert.equal(snapshot.month.cost, 6)
  assert.equal(snapshot.total.cost, 6)
  assert.equal(snapshot.budgetUsed, 1, 'budget exclusions use the API billing basis independently')
  await service.updateConfig({ modelStatistics: { [key]: { today: true, summary: false, budget: true } } })
  const changed = await service.getLocalState()
  assert.equal(changed.today.cost, 6)
  assert.equal(changed.month.cost, 4)
  assert.equal(changed.total.cost, 4)
  assert.equal(changed.budgetUsed, 3)
  for (const stop of disposers.splice(0).reverse()) await stop()
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(saved.days[day.date].cost, 6, 'saved ledger retains the full original amount')
} finally {
  for (const stop of disposers.reverse()) await stop()
  if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
  rmSync(home, { recursive: true, force: true })
}
console.log('[ok] model statistics: independent scopes, frozen currency, unknown residuals, strict codec, persistent exclusions, unchanged ledger and active Codex runtime')
