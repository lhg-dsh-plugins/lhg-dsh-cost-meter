import assert from 'node:assert/strict'
import { getSessionListCosts } from '../lib/session-tree.js'
import { sanitizeConfig, applyConfigPatch, localDayKey } from '../lib/store.js'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const row = (id, cost) => ({ id, input: 10, output: 2, cacheRead: 3, cacheWrite: 4, calls: 1, cost, apiCost: cost / 2, costCny: cost * 7, apiCostCny: cost * 3.5, costEur: cost * .9, apiCostEur: cost * .45 })
const today = localDayKey(Date.now()), ledger = { config: sanitizeConfig({ includeSubagentCost: true }), days: {
  '2020-01-01': { sessions: [row('parent', 1)] }, [today]: { sessions: [row('parent', 2), row('child', 3), row('fork', 10)] },
} }
const ctx = { get: name => name === 'sessions' ? { list: () => [{ id: 'parent' }, { id: 'child', parentSession: 'parent', origin: 'subagent' }, { id: 'fork', parentSession: 'parent', origin: 'fork' }] } : undefined }
const before = JSON.stringify(ledger)
const all = await getSessionListCosts(ledger, ctx, { sessionIds: ['parent', 'child', 'missing'], period: 'total' })
assert.equal(all[0].cost, 6); assert.equal(all[0].costCny, 42); assert.equal(all[0].apiCost, 3)
assert.equal(all[1].cost, 3); assert.equal(all[2].found, false)
assert.equal((await getSessionListCosts(ledger, ctx, { sessionIds: ['parent'], period: 'today' }))[0].cost, 5)
assert.equal(JSON.stringify(ledger), before)
assert.equal(applyConfigPatch(ledger.config, { sessionListCosts: true, sessionListCostPeriod: 'today' }).errors.length, 0)
assert.ok(applyConfigPatch(ledger.config, { sessionListCostPeriod: 'week' }).errors.length)
await assert.rejects(getSessionListCosts(ledger, ctx, { sessionIds: Array(101).fill('parent'), period: 'total' }))
let factory
vm.runInNewContext(readFileSync(new URL('../lib/client.session-list.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: mod => { factory = mod.factory } } }, document: { hidden: false }, setTimeout, clearTimeout, Date,
})
const { createBatchReader } = factory(() => ({}))
let state = { config: { sessionListCosts: true, sessionListCostPeriod: 'total' } }, requests = []
const reader = createBatchReader(async query => { requests.push(query); return getSessionListCosts(ledger, ctx, query) }, () => state)
const wait = () => new Promise(resolve => setTimeout(resolve, 55))
const hide = ['parent', 'child', 'missing'].map(reader.show)
await wait(); assert.equal(requests.length, 1); assert.equal(requests[0].sessionIds.length, 3)
reader.refresh(); await wait(); assert.equal(requests.length, 1, '5-second cache avoids duplicate calls')
state.config.sessionListCostPeriod = 'today'; reader.invalidate(); await wait(); assert.equal(reader.row('parent').cost, 5)
state.config.sessionListCosts = false; reader.invalidate(); await wait(); assert.equal(requests.length, 2)
for (const stop of hide) stop()
reader.dispose()
console.log('[ok] #332 batched ledger reads, subagents/forks, frozen FX, missing data, period switches, cache and disabled behavior')
