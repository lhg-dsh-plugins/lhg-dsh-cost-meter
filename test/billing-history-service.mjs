import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { apply } from '../lib/index.js'
import { replaySessionRecords } from '../lib/backfill.js'
import { TYPERT } from '../lib/typert.host.js'

const root = mkdtempSync(join(tmpdir(), 'cm-history-service-')), home = process.env.DSH_HOME
const originalFetch = globalThis.fetch, originalTimer = globalThis.setTimeout, disposers = []
let requests = 0, service
const path = join(root, 'storages', 'cost-meter', 'ledger.json'), time = Date.now() - 60000
const rates = { cacheMiss: 2, cacheHit: .2, output: 8 }
const config = sanitizeConfig({ legacyAutoImportedAt: time, hideOfficialBalance: true,
  balance: { display: 'off' }, goQuota: { enabled: false }, prices: { providers: { fixture: { models: { model: rates } } } } })
const records = [
  { type: 'session', id: 'original', createdAt: time - 1 },
  { type: 'request/header', time, data: { header: { config: { provider: 'fixture', model: 'model' } } } },
  { type: 'step/start', seq: 1, time, data: { turn: 0, step: 0 } },
  { type: 'assistant/message', seq: 2, time: time + 1, data: { turn: 0, step: 0, usage: { inputTokens: 100000, outputTokens: 20000 } } },
]
const total = data => Object.values(data.days).reduce((sum, day) => sum + day.cost, 0)
try {
  process.env.DSH_HOME = root
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected network access') }
  const ledger = new Ledger(config, {}, path)
  ledger.account({ input: 100000, output: 20000 }, 'model', 'original', time, 'fixture')
  ledger.close()
  const old = total(JSON.parse(readFileSync(path, 'utf8')))
  const directory = join(root, 'sessions', 'project', 'original')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'session.jsonl'), records.map(row => JSON.stringify(row)).join('\n') + '\n')
  // Keep unrelated startup migration/network timers out of this RPC test.
  globalThis.setTimeout = (fn, delay, ...args) => originalTimer(fn, delay === 3000 ? 3600000 : delay, ...args)
  apply({ on: () => () => {}, inject() {}, logger: console,
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    provide: (name, value) => { if (name === 'costMeter') service = value },
    get: key => key === 'settings' ? { get: () => ({}) } : undefined })
  globalThis.setTimeout = originalTimer
  const state = await service.getLocalState()
  const prices = structuredClone(state.config.prices)
  prices.providers.fixture.models.model.cacheMiss = 4
  prices.providers.fixture.models.model.output = 16
  await service.updateConfig({ prices })
  assert.equal(total(JSON.parse(readFileSync(path, 'utf8'))), old, 'saving prices does not reprice recorded amounts')
  await assert.rejects(service.repriceHistory(false), /confirmation/)
  await assert.rejects(service.repriceHistory(), /confirmation/)
  assert.equal(readdirSync(join(root, 'storages', 'cost-meter')).filter(name => name.includes('before-reprice')).length, 0)
  assert.deepEqual(await service.getRepricingHistory(), [])
  const run = await service.repriceHistory(true)
  assert.equal(run.ok, true)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  assert.ok(Math.abs(total(saved) - old * 2) < 1e-10)
  const backups = readdirSync(join(root, 'storages', 'cost-meter')).filter(name => name.includes('before-reprice'))
  assert.equal(backups.length, 1)
  assert.equal(total(JSON.parse(readFileSync(join(root, 'storages', 'cost-meter', backups[0]), 'utf8'))), old)
  const history = await service.getRepricingHistory()
  assert.equal(history.length, 1); assert.equal(history[0].before, old); assert.equal(history[0].after, old * 2)
  const descriptor = TYPERT.invocations.find(item => item.method === 'getRepricingHistory')
  descriptor.result.schema.parse(history)
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  const reopened = Ledger.load(path)
  const details = replaySessionRecords(records, reopened.config, null)
  assert.ok(Math.abs(Object.values(details.days).flatMap(Object.values).reduce((sum, bucket) => sum + bucket.cost, 0) - old * 2) < 1e-10)
  reopened.close()
  assert.equal(requests, 0)
  console.log('[ok] pricing service: confirmation, immutable edit, original backup, original amount records, RPC and restart; no network')
} finally {
  for (const dispose of disposers.reverse()) await dispose()
  globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimer
  if (home === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = home
  rmSync(root, { recursive: true, force: true })
}
