import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Ledger } from '../lib/store.js'
import { replaySessionRecords, recomputeLedgerPricingBasis } from '../lib/backfill.js'
import { turnCostFromRecords } from '../lib/turn-cost.js'
import { __testProjection } from '../lib/index.js'
import { normalizePricingHistory, advancePricingHistory, encodePricingHistory, bindPricingHistory } from '../lib/billing-history.js'
import { snapshotLedger } from './fixtures/ollama-snapshots-1.9.16/ledger.mjs'

if (process.env.TZ !== 'UTC') {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8' })
  process.stdout.write(child.stdout); process.stderr.write(child.stderr)
  assert.equal(child.status, 0, 'snapshot upgrade regression')
} else {
  for (const alias of [false, true]) for (const timeline of ['versioned', 'missing', 'mixed', 'invalid']) await scenario(alias, timeline)
}

async function scenario(alias, timeline) {
  const root = mkdtempSync(join(tmpdir(), 'cm-snapshot-upgrade-')), path = join(root, 'ledger.json')
  const sessionsRoot = join(root, 'sessions'), sessionDir = join(sessionsRoot, 'project', 'snapshot')
  const model = 'deepseek-v4.1-flash:1017', key = 'ollama-cloud:' + model
  const sibling = 'deepseek-official:deepseek-v4.1-flash', oldCost = alias ? .30 : 0
  const morning = Date.parse('2026-10-19T07:00:00Z'), oldNow = Date.now
  const records = [
    { type: 'session', id: 'snapshot', version: 0, createdAt: morning - 1000 },
    { type: 'turn/start', seq: 0, time: morning - 1, data: { turn: 1 } },
    ...[['ollama-cloud', model], ['deepseek-official', 'deepseek-v4.1-flash']].flatMap(([provider, model], i) => [
      { type: 'request/header', seq: 3 * i + 1, time: morning + i * 60000, data: { header: { config: { provider, model } } } },
      { type: 'step/start', seq: 3 * i + 2, time: morning + i * 60000, data: { turn: 1, step: i + 1 } },
      { type: 'assistant/message', seq: 3 * i + 3, time: morning + i * 60000 + 1, data: { turn: 1, step: i + 1, usage: { inputTokens: 1e6 } } },
    ]),
    { type: 'turn/end', seq: 7, time: morning + 60002, data: { turn: 1 } },
  ]
  const near = (got, want) => assert.ok(Math.abs(got - want) < 1e-10, `${alias}/${timeline}: ${got} != ${want}`)
  let ledger
  const check = cost => {
    near(ledger.days['2026-10-19'].byProviderModel[key].cost, cost)
    near(replaySessionRecords(records, ledger.config, null).days['2026-10-19'][key].cost, cost)
    near(turnCostFromRecords(records, ledger.config, 0, 7).calls.find(c => c.model === model).cost, cost)
    const projection = __testProjection.makeCostUsageProjection(ledger)
    const projected = records.slice(1).reduce((state, event) => projection.apply(state, event), projection.init({ id: 'snapshot', createdAt: morning - 1000 }, 0))
    near(projected.byProviderModel[key].cost, cost)
    near(ledger.days['2026-10-19'].byProviderModel[sibling].cost, .30)
  }
  try {
    Date.now = () => Date.parse('2026-10-20T00:00:00Z')
    const saved = snapshotLedger(alias)
    const initial = saved.pricingHistory.changes.initial.version
    const decoded = normalizePricingHistory(saved.pricingHistory, saved.config, undefined, true)
    assert.equal(decoded.changes.initial?.version, initial, 'valid legacy fixture must decode without recovery')
    assert.equal(decoded.versions[initial].prices.ollamaPeak, true)
    assert.equal(decoded.versions[initial].prices.snapshotTags, false)
    if (timeline === 'missing') delete saved.pricingHistory
    if (timeline === 'invalid') saved.pricingHistory.changes = {}
    if (timeline === 'mixed') {
      // The newer activation boundary survives, but the initial row was lost.
      const history = normalizePricingHistory(saved.pricingHistory, saved.config, undefined, true)
      advancePricingHistory(history, saved.config, Date.now())
      saved.pricingHistory = encodePricingHistory(history)
      for (const [id, row] of Object.entries(saved.pricingHistory.changes)) if (row.at === 0) delete saved.pricingHistory.changes[id]
      const recovered = normalizePricingHistory(saved.pricingHistory, saved.config, undefined, true)
      const recoveredConfig = bindPricingHistory({ ...saved.config }, recovered)
      near(turnCostFromRecords(records, recoveredConfig, 0, 7).calls.find(c => c.model === model).cost, oldCost)
      const later = records.map(row => ({ ...row, ...(row.time ? { time: row.time + 86400000 } : {}) }))
      near(turnCostFromRecords(later, recoveredConfig, 0, 7).calls.find(c => c.model === model).cost, .15)
    }
    writeFileSync(path, JSON.stringify(saved))
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'session.jsonl'), records.map(row => JSON.stringify(row)).join('\n') + '\n')
    ledger = Ledger.load(path)
    check(oldCost)
    await recomputeLedgerPricingBasis(ledger, sessionsRoot, null)
    check(oldCost)
    assert.deepEqual(ledger.days['2026-10-19'].byProviderModel, saved.days['2026-10-19'].byProviderModel, 'automatic replay leaves old buckets untouched')

    const newAt = Date.parse('2026-10-20T13:00:00Z')
    ledger.account({ input: 1e6 }, model, 'new-call', newAt, 'ollama-cloud')
    near(ledger.days['2026-10-20'].byProviderModel[key].cost, .30)
    ledger.close(); ledger = Ledger.load(path)
    check(oldCost)
    const beforeSibling = structuredClone(ledger.days['2026-10-19'].byProviderModel[sibling])
    Date.now = () => Date.parse('2026-10-21T00:00:00Z')
    ledger.config = { ...ledger.config, exchangeRate: 9 }
    ledger.scheduleWrite()
    ledger.flush()
    const result = await recomputeLedgerPricingBasis(ledger, sessionsRoot, null, null, true, key)
    assert.equal(result.recostedSessions, 1, 'explicitly recost the matching session')
    check(.15)
    near(ledger.days['2026-10-19'].byProviderModel[key].costCny, (.15) * 7)
    assert.deepEqual(ledger.days['2026-10-19'].byProviderModel[sibling], beforeSibling, 'other provider untouched')
    ledger.scheduleWrite()
    ledger.close(); ledger = Ledger.load(path)
    check(.15)
    near(ledger.days['2026-10-20'].byProviderModel[key].cost, .30)
  } finally {
    ledger?.close()
    Date.now = oldNow
    rmSync(root, { recursive: true, force: true })
  }
  console.log(`[ok] snapshot upgrade ${alias ? 'alias' : 'unpriced'}/${timeline}: recorded amounts, replay/detail/projection, new calls, explicit correction, FX and restart`)
}
