import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { apply } from '../lib/index.js'
import { Ledger } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

const root = mkdtempSync(join(tmpdir(), 'cm-workbuddy-host-'))
const names = ['DSH_HOME', 'USERPROFILE', 'HOME', 'XDG_CONFIG_HOME', 'WORKBUDDY_AUTH_FILE']
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]))
const disposers = [], requests = [], originalFetch = globalThis.fetch
let balance = 100, failing = false
const server = createServer((req, res) => {
  requests.push({ path: req.url, method: req.method, authorization: req.headers.authorization })
  const url = new URL(req.url, 'http://localhost')
  res.setHeader('content-type', 'application/json')
  if (failing) { res.writeHead(503); res.end('{}'); return }
  if (url.pathname !== '/plugins/dsh-connect-workbuddy/account-credits') { res.writeHead(404); res.end('{}'); return }
  res.end(JSON.stringify({ accounts: url.searchParams.get('region') === 'cn'
    ? [{ id: 'a', accountName: 'Synthetic A', selected: true, credits: balance, token: 'DO_NOT_FORWARD' }]
    : [{ id: 'b', accountName: 'Synthetic B', selected: true, credits: 25 }] }))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
try {
  for (const name of names) delete process.env[name]
  process.env.DSH_HOME = process.env.USERPROFILE = process.env.HOME = root
  process.env.XDG_CONFIG_HOME = join(root, 'config')
  const storage = join(root, 'storages', 'cost-meter')
  mkdirSync(storage, { recursive: true })
  writeFileSync(join(storage, 'ledger.json'), JSON.stringify({ version: 1, config: { balance: { display: 'off' }, goQuota: { enabled: false } }, days: {} }))
  globalThis.fetch = async () => { throw Error('No external fetch allowed') }
  const services = {}
  apply({ get: name => name === 'webServer' ? { host: '127.0.0.1', port: server.address().port } : undefined,
    provide: (name, value) => { services[name] = value }, on: () => () => {}, inject() {},
    effect: fn => { const stop = fn(); if (typeof stop === 'function') disposers.push(stop) },
    logger: { info() {}, warn() {}, error() {} },
  })
  const meter = services.costMeter
  await meter.getState()
  assert.equal(requests.length, 0, 'disabled integration does not query the connector')
  await meter.updateConfig({ codingPlans: { workbuddy: { enabled: true, display: 'both', accountScope: 'all' } } })
  const first = await meter.refreshCodingPlan('workbuddy')
  assert.equal(first.ok, true, first.message)
  assert.equal(first.state.codingPlans.workbuddy.windows.balance.text, '125')
  balance = 90
  const next = await meter.refreshCodingPlan('workbuddy')
  const codec = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create()
  for (const live of [stateSchema.parse(next.state), codec.parse(JSON.parse(JSON.stringify(next.state)))]) {
    const data = live.codingPlans.workbuddy.workbuddy
    assert.equal(data.accounts.find(row => row.id === 'cn:a').observedTotal, 10)
    assert.equal(data.accounts.find(row => row.id === 'global:b').observedTotal, 0)
    assert.ok(!JSON.stringify(live).includes('DO_NOT_FORWARD'))
  }
  const count = requests.length
  await Promise.all([meter.getState(), meter.getState(), meter.getState()])
  assert.equal(requests.length, count, 'state polling reuses the cache')
  await meter.updateConfig({ codingPlans: { workbuddy: { accountScope: 'selected', accountIds: ['global:b'] } } })
  const selected = (await meter.refreshCodingPlan('workbuddy')).state
  assert.equal(selected.codingPlans.workbuddy.windows.balance.text, '25')
  assert.equal(selected.codingPlans.workbuddy.workbuddy.accounts.find(row => row.id === 'cn:a').observedTotal, 10, 'filter changes do not recount')
  failing = true
  assert.equal((await meter.refreshCodingPlan('workbuddy')).ok, false)
  const failedCount = requests.length
  await Promise.all([meter.getState(), meter.getState()])
  assert.equal(requests.length, failedCount, 'failures respect the refresh interval')
  failing = false
  assert.equal((await meter.refreshCodingPlan('workbuddy')).ok, true)
  const history = join(storage, 'workbuddy-statistics.json')
  assert.equal(JSON.parse(readFileSync(history)).accounts['cn:a'].total, 10)
  writeFileSync(history, '{broken')
  const damaged = await meter.refreshCodingPlan('workbuddy')
  assert.equal(damaged.state.codingPlans.workbuddy.workbuddy.historyUnavailable, true)
  assert.equal(damaged.state.codingPlans.workbuddy.windows.balance.text, '25')
  assert.equal(readFileSync(history, 'utf8'), '{broken')
  await meter.updateConfig({ codingPlans: { workbuddy: { enabled: false } } })
  const stoppedCount = requests.length
  assert.equal((await meter.getState()).codingPlans.workbuddy.status, 'off')
  assert.equal(requests.length, stoppedCount)
  for (const stop of disposers.splice(0).reverse()) await stop()
  const reopened = Ledger.open()
  assert.deepEqual(reopened.config.codingPlans.workbuddy.accountIds, ['global:b'])
  assert.deepEqual(reopened.days, {}, 'credit observations never enter the monetary ledger')
  reopened.close()
  assert.ok(requests.every(row => row.method === 'GET' && row.authorization === undefined))
  console.log('[ok] WorkBuddy service: real loopback, strict codecs, account selection, cache, observed decreases, disk recovery and no monetary ledger changes')
} finally {
  for (const stop of disposers.reverse()) await stop()
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  server.closeAllConnections(); await new Promise(done => server.close(done))
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
