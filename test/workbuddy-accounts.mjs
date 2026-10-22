import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchWorkBuddyAccounts } from '../lib/workbuddy-accounts.js'
import { observeWorkBuddyAccounts } from '../lib/workbuddy-statistics.js'
import { queryCodingPlan } from '../lib/coding-plans.js'
import { defaultConfig, applyConfigPatch, sanitizeConfig } from '../lib/store.js'

const old = defaultConfig()
for (const key of ['sessionListCosts', 'sessionListCostPeriod', 'modelStatistics', 'billionContextNoticesSeen', 'sidebarOrder', 'sidebarSummaryPromptSeen']) delete old[key]
old.prices.models = {}; old.codexQuotaEnabled = false
const before = structuredClone(old)
const saved = applyConfigPatch(old, { peakStyle: 'progress', peakTimeDisplay: 'both', sidebarOrder: ['today', 'balance', 'peak'], sidebarSummaryPromptSeen: true, codexQuotaEnabled: true })
assert.deepEqual(saved.errors, [])
assert.deepEqual(old, before, 'old runtime snapshot stays unchanged')
assert.equal(saved.config.codexQuotaEnabled, true)
assert.deepEqual(saved.config.prices.models, {}, 'upgrading missing settings must not repopulate removed prices')
assert.equal(JSON.stringify(saved.config.planBilling), JSON.stringify(before.planBilling), 'unrelated saves must preserve billing map order and avoid historical reclassification')
assert.ok(applyConfigPatch(old, { sessionListCosts: 'true' }).errors.length)
assert.ok(applyConfigPatch(old, { imaginarySetting: true }).errors.length)
const selection = { enabled: true, accountScope: 'selected', accountIds: ['cn:a', 'global:a'] }
assert.deepEqual(sanitizeConfig(applyConfigPatch(old, { codingPlans: { workbuddy: selection } }).config).codingPlans.workbuddy.accountIds, selection.accountIds)
assert.ok(applyConfigPatch(old, { codingPlans: { workbuddy: { accountIds: ['bad'] } } }).errors.length)

let cn = [{ id: 'a', accountName: 'Account A', selected: true, credits: 100, accessToken: 'SECRET' }, { id: 'b', accountName: 'Account B', selected: false, credits: 20 }]
let global = [{ id: 'a', accountName: 'Account C', selected: true, credits: 0 }], failedRegion = false
const requests = []
const server = createServer((req, res) => {
  requests.push({ path: req.url, method: req.method, authorization: req.headers.authorization })
  res.setHeader('content-type', 'application/json')
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname !== '/plugins/dsh-connect-workbuddy/account-credits') { res.writeHead(404); res.end('{}'); return }
  if (failedRegion && url.searchParams.get('region') === 'global') { res.writeHead(503); res.end('{}'); return }
  res.end(JSON.stringify({ accounts: url.searchParams.get('region') === 'cn' ? cn : global }))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const hostOrigin = `http://127.0.0.1:${server.address().port}`
const dir = mkdtempSync(join(tmpdir(), 'cm-workbuddy-')), path = join(dir, 'observed.json')
const originalFetch = globalThis.fetch
try {
  // Desktop plugins can replace global fetch or install a proxy. Loopback billing
  // is intentionally independent of both, while all external calls retain it.
  globalThis.fetch = () => { throw Error('synthetic global proxy failure') }
  const all = await fetchWorkBuddyAccounts(hostOrigin, { accountScope: 'all' })
  assert.equal(all.knownRemaining, 120)
  assert.equal(all.accounts.length, 3)
  assert.equal(JSON.stringify(all).includes('SECRET'), false)
  assert.equal((await fetchWorkBuddyAccounts(hostOrigin)).knownRemaining, 100)
  assert.equal((await fetchWorkBuddyAccounts(hostOrigin, selection)).knownRemaining, 100)
  const stamp = Date.now()
  let stats = observeWorkBuddyAccounts(path, { ...all, fetchedAt: stamp }, stamp)
  assert.equal(stats.accounts[0].observedTotal, 0, 'first observation establishes a baseline')
  cn[0].credits = 90
  stats = observeWorkBuddyAccounts(path, { ...await fetchWorkBuddyAccounts(hostOrigin, selection), fetchedAt: stamp + 1 }, stamp + 1)
  assert.equal(stats.accounts[0].observedToday, 10)
  assert.equal(stats.accounts[0].observedWeek, 10)
  cn[0].credits = 150
  stats = observeWorkBuddyAccounts(path, { ...await fetchWorkBuddyAccounts(hostOrigin, selection), fetchedAt: stamp + 2 }, stamp + 2)
  assert.equal(stats.accounts[0].observedTotal, 10, 'grant is not spending')
  const outOfOrder = observeWorkBuddyAccounts(path, { ...all, fetchedAt: stamp }, stamp + 3)
  assert.equal(outOfOrder.accounts[0].observedTotal, 10, 'older refresh cannot double count')
  delete cn[0].credits
  const partial = await fetchWorkBuddyAccounts(hostOrigin, { accountScope: 'all' })
  assert.equal(partial.unknownCount, 1)
  const missing = await fetchWorkBuddyAccounts(hostOrigin, { accountScope: 'selected', accountIds: ['global:gone'] })
  assert.equal(missing.unknownCount, 1, 'removed selected accounts remain unknown')
  failedRegion = true
  const failure = await queryCodingPlan('workbuddy', { hostOrigin }, 'zh', (_, key) => key, { workbuddyConfig: { accountScope: 'all' } })
  assert.equal(failure.windows.balance.text, '—', 'partial data never appears as a complete balance')
  assert.equal(failure.workbuddy.incomplete, true)
  const persisted = readFileSync(path, 'utf8')
  assert.equal(persisted.includes('Account A'), false, 'no names are stored')
  writeFileSync(path, '{broken')
  assert.throws(() => observeWorkBuddyAccounts(path, all))
  assert.equal(readFileSync(path, 'utf8'), '{broken', 'corrupt history is preserved, not reset')
  const abort = new AbortController(); abort.abort()
  await assert.rejects(fetchWorkBuddyAccounts(hostOrigin, {}, { signal: abort.signal }), error => error.name === 'AbortError')
  assert.ok(requests.every(row => row.method === 'GET' && row.authorization === undefined))
  console.log('[ok] Legacy settings migration; WorkBuddy local proxy isolation, multi-region selection, partial balances, persisted credit observations and cancellation')
} finally { globalThis.fetch = originalFetch; server.closeAllConnections(); await new Promise(done => server.close(done)); rmSync(dir, { recursive: true, force: true }) }
