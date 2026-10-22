/**
 * issue #300 regression: a legacy ledger (no frozen FX fields) must keep the
 * load-time `freezeLegacyAmounts()` backfill through every write path instead of
 * dropping it while adopting the on-disk copy, which made pre-upgrade sessions
 * display ¥0 while their USD cost stayed intact.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ledger, localDayKey } from '../lib/store.js'
import { aggregateSessionCost, conversationRows } from '../lib/session-tree.js'
import { FX_FIELDS, fxRatesOf } from '../lib/exchange-rates.js'

const root = mkdtempSync(join(tmpdir(), 'cm-frozen-fx-'))
const now = Date.now()
const DAY = 86400000
const pastDay = localDayKey(now - 3 * DAY)
const olderDay = localDayKey(now - 5 * DAY)
const today = localDayKey(now)
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? 'amount'}: ${actual} != ${expected}`)
const read = path => JSON.parse(readFileSync(path, 'utf8'))

const stripFrozen = value => {
  if (value === null || typeof value !== 'object') return
  for (const key of FX_FIELDS) delete value[key]
  for (const child of Object.values(value)) stripFrozen(child)
}
const writeLegacyLedger = (path, days) => {
  const ledger = JSON.parse(JSON.stringify({ version: 1, config: {}, days }))
  stripFrozen(ledger)
  writeFileSync(path, JSON.stringify(ledger))
}
const sessionRow = (id, cost, apiCost, at) => ({
  id, title: id, at, input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost, apiCost,
  byProviderModel: { 'deepseek:deepseek-v4-flash': { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost, apiCost } },
})
const dayRow = (date, sessions) => {
  const sum = key => sessions.reduce((total, row) => total + row[key], 0)
  return {
    date, input: sum('input'), output: sum('output'), cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: sessions.length,
    cost: sum('cost'), apiCost: sum('apiCost'),
    byProviderModel: { 'deepseek:deepseek-v4-flash': { input: sum('input'), output: sum('output'), cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: sessions.length, cost: sum('cost'), apiCost: sum('apiCost') } },
    sessions,
  }
}
const assertFrozen = (ledgerFile, rates, label) => {
  for (const [date, row] of Object.entries(ledgerFile.days)) {
    near(row.costCny, row.cost * rates.CNY, `${label} ${date} day costCny`)
    near(row.apiCostCny, row.apiCost * rates.CNY, `${label} ${date} day apiCostCny`)
    near(row.costEur, row.cost * rates.EUR, `${label} ${date} day costEur`)
    near(row.apiCostEur, row.apiCost * rates.EUR, `${label} ${date} day apiCostEur`)
    for (const session of row.sessions) {
      near(session.costCny, session.cost * rates.CNY, `${label} ${session.id} costCny`)
      near(session.apiCostCny, session.apiCost * rates.CNY, `${label} ${session.id} apiCostCny`)
    }
    for (const [key, bucket] of Object.entries(row.byProviderModel ?? {})) {
      near(bucket.costCny, bucket.cost * rates.CNY, `${label} ${date} ${key} costCny`)
      near(bucket.apiCostCny, bucket.apiCost * rates.CNY, `${label} ${date} ${key} apiCostCny`)
    }
  }
}

try {
  // ── 1. equal(local, base): first flush of a freshly loaded legacy ledger ───────
  // 1.8.26 wrote neither frozen field; 1.8.35 backfills them in memory on load.
  const path = join(root, 'ledger.json')
  writeLegacyLedger(path, {
    [pastDay]: dayRow(pastDay, [sessionRow('legacy-a', 0.012, 0.012, now - 3 * DAY), sessionRow('legacy-b', 0.024, 0)]),
    [olderDay]: dayRow(olderDay, [sessionRow('legacy-c', 0.005, 0.005, now - 5 * DAY)]),
  })
  const ledger = Ledger.load(path)
  const rates = fxRatesOf(ledger.config)
  const loaded = aggregateSessionCost(ledger.days, 'legacy-a').own
  near(loaded.cost, 0.012)
  near(loaded.costCny, 0.012 * rates.CNY, 'load backfills the frozen FX fields in memory')
  assert.equal(loaded.costEur, 0.012 * rates.EUR)
  ledger.scheduleWrite()
  ledger.flush()
  assert.equal(ledger.pendingWrite, false, 'first flush commits')
  const first = read(path)
  assertFrozen(first, rates, 'first flush')
  near(ledger.sumDays().costCny, (0.012 + 0.024 + 0.005) * rates.CNY, 'in-memory daily totals keep the frozen amounts')
  const reloaded = Ledger.load(path)
  near(reloaded.sumDays().costCny, (0.041) * rates.CNY, 'reload preserves the flushed frozen amounts')
  near(aggregateSessionCost(reloaded.days, 'legacy-b').own.costCny, 0.024 * rates.CNY, 'reloaded session keeps frozen FX')
  reloaded.scheduleWrite()
  reloaded.flush()
  const second = read(path)
  assert.deepEqual(second.days, first.days, 'a repeated flush is idempotent for frozen amounts')
  assert.deepEqual(reloaded.sumDays().costCny, ledger.sumDays().costCny)
  ledger.close()
  reloaded.close()

  // ── 2. Legacy day that also receives a new call in the same flush ────────────
  // The day totals keep an anonymous/pruned remainder (calls > sessions) so the
  // session-total repair cannot mask a partial day-level backfill.
  const todayPath = join(root, 'today.json')
  const residualDay = dayRow(today, [sessionRow('legacy-today', 0.01, 0.01, now - 60000)])
  residualDay.calls = 3
  residualDay.cost = 0.03
  residualDay.apiCost = 0.03
  writeLegacyLedger(todayPath, { [today]: residualDay })
  const current = Ledger.load(todayPath)
  current.account({ input: 1e6, output: 1e5 }, 'deepseek-v4-flash', 'new-today', now, 'deepseek')
  current.scheduleWrite()
  current.flush()
  const todayFile = read(todayPath)
  const todayRow = todayFile.days[today]
  near(todayRow.costCny, todayRow.cost * rates.CNY, 'legacy backfill plus the new call frozen once on a shared day row with residual usage')
  const legacyToday = todayRow.sessions.find(row => row.id === 'legacy-today')
  near(legacyToday.costCny, 0.01 * rates.CNY, 'legacy session keeps its frozen baseline next to a pending account call')
  const newToday = todayRow.sessions.find(row => row.id === 'new-today')
  assert.ok(Number.isFinite(newToday.costCny) && newToday.costCny > 0, 'new session keeps its own frozen amount')
  near(newToday.costCny, newToday.cost * rates.CNY, 'new call frozen at its call-time rate')
  current.close()

  // ── 3. concurrent writer merge path, both processes loaded the legacy file ───
  const concurrentPath = join(root, 'concurrent.json')
  writeLegacyLedger(concurrentPath, { [pastDay]: dayRow(pastDay, [sessionRow('legacy-shared', 0.01, 0.01, now - 3 * DAY)]) })
  const a = Ledger.load(concurrentPath)
  const b = Ledger.load(concurrentPath)
  a.account({ input: 1e6, output: 1e5 }, 'deepseek-v4-flash', 'writer-a', now, 'deepseek')
  a.scheduleWrite(); a.flush()
  b.account({ input: 2e6, output: 2e5 }, 'deepseek-v4-flash', 'writer-b', now, 'deepseek')
  b.scheduleWrite(); b.flush()
  const merged = read(concurrentPath)
  const mergedPast = merged.days[pastDay]
  near(mergedPast.costCny, mergedPast.cost * rates.CNY, 'legacy day frozen once after the concurrent merge')
  const sharedSession = mergedPast.sessions.find(row => row.id === 'legacy-shared')
  near(sharedSession.costCny, 0.01 * rates.CNY, 'legacy session frozen once after the concurrent merge')
  const mergedToday = merged.days[today]
  near(mergedToday.costCny, mergedToday.cost * rates.CNY, 'concurrent writers neither drop nor double-count frozen amounts')
  assert.deepEqual(merged.days[today].sessions.map(row => row.id).sort(), ['writer-a', 'writer-b'])
  const mergedAgain = Ledger.load(concurrentPath)
  near(mergedAgain.sumDays().costCny, mergedAgain.sumDays().cost * rates.CNY, 'full ledger frozen amounts match USD totals after reload')
  a.scheduleWrite(); a.flush()
  b.scheduleWrite(); b.flush()
  mergedAgain.scheduleWrite(); mergedAgain.flush()
  const finalMerge = read(concurrentPath)
  near(finalMerge.days[pastDay].costCny, 0.01 * rates.CNY)
  near(finalMerge.days[today].costCny, finalMerge.days[today].cost * rates.CNY)
  a.close(); b.close(); mergedAgain.close()

  // ── 4. refresh() observing a sibling write before our own flush ──────────────
  const refreshPath = join(root, 'refresh.json')
  writeLegacyLedger(refreshPath, { [pastDay]: dayRow(pastDay, [sessionRow('legacy-refresh', 0.02, 0.02, now - 3 * DAY)]) })
  const observer = Ledger.load(refreshPath)
  const sibling = Ledger.load(refreshPath)
  observer.refresh()
  sibling.scheduleWrite(); sibling.flush()
  observer.scheduleWrite(); observer.flush()
  const refreshed = read(refreshPath)
  near(refreshed.days[pastDay].costCny, 0.02 * rates.CNY, 'refresh keeps the in-memory backfill exactly once')
  observer.close(); sibling.close()

  // ── 5. session-tree aggregation must not fabricate a finite ¥0 ─────────────
  const complete = (id, cost) => ({ id, input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost, apiCost: cost,
    costCny: cost * rates.CNY, apiCostCny: cost * rates.CNY, costEur: cost * rates.EUR, apiCostEur: cost * rates.EUR, byProviderModel: {} })
  const partialDays = {
    '2026-01-01': { date: '2026-01-01', sessions: [complete('legacy-a', 1)] },
    '2026-01-02': { date: '2026-01-02', sessions: [complete('legacy-a', 2), sessionRow('legacy-partial', 3, 3, now)] },
  }
  const partial = aggregateSessionCost(partialDays, 'legacy-partial').own
  near(partial.cost, 3)
  assert.ok(!Object.hasOwn(partial, 'costCny'), 'an incomplete frozen total stays absent instead of becoming a finite 0')
  const completeAgg = aggregateSessionCost(partialDays, 'legacy-a').own
  near(completeAgg.costCny, 3 * rates.CNY, 'complete rows still aggregate frozen FX additively')
  const rows = conversationRows(partialDays)
  const completeConversation = rows.find(row => row.id === 'legacy-a')
  near(completeConversation.costCny, 3 * rates.CNY, 'conversation rows keep complete frozen totals')
  const partialConversation = rows.find(row => row.id === 'legacy-partial')
  near(partialConversation.cost, 3)
  assert.ok(!Object.hasOwn(partialConversation, 'costCny'), 'conversation rows also omit incomplete frozen totals')

  console.log('[ok] issue #300: legacy frozen FX backfill survives load→flush, pending same-day calls, concurrent writers, refresh and partial aggregation')
} finally {
  rmSync(root, { recursive: true, force: true })
}
