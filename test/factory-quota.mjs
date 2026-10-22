import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { FACTORY_QUOTA_URL, parseFactoryQuota, normalizeFactoryOrgId } from '../lib/factory-quota.js'
import { queryCodingPlan } from '../lib/coding-plans.js'
import { sanitizeConfig, applyConfigPatch, secretRefOf, stripSecrets, Ledger } from '../lib/store.js'
import { recordSamples, buildPlanStats, billingClassOf, enabledPlanSetOf } from '../lib/plan-billing.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'
import { apply } from '../lib/index.js'

const now = Date.parse('2026-10-14T10:00:00Z')
const fixture = { limits: {
  standard: { fiveHour: { usedPercent: 1, windowEnd: '2026-10-14T15:00:00Z', secondsRemaining: 1 }, weekly: { usedPercent: 32, secondsRemaining: 60 }, monthly: { usedPercent: 66.25 } },
  core: { fiveHour: { usedPercent: 0 }, weekly: { usedPercent: 45 }, monthly: { usedPercent: 100 } },
}, extraUsageAllowed: true, extraUsageBalanceCents: 999, private: 'PRIVATE_RESPONSE' }
const standard = parseFactoryQuota(fixture, 'standard', now)
assert.deepEqual(Object.keys(standard), ['fiveHour', 'weekly', 'monthly'])
assert.equal(standard.fiveHour.percent, 1, '1 means 1%, not 100%')
assert.equal(standard.fiveHour.resetsAt, '2026-10-14T15:00:00.000Z', 'explicit reset wins over relative seconds')
assert.equal(standard.weekly.resetsAt, '2026-10-14T10:01:00.000Z')
assert.deepEqual(standard.monthly, { percent: 66.25, resetsAt: '' })
assert.deepEqual(Object.keys(parseFactoryQuota(fixture, 'both')), ['fiveHour', 'weekly', 'monthly', 'core_fiveHour', 'core_weekly', 'core_monthly'])
assert.deepEqual(parseFactoryQuota(fixture, 'core').core_fiveHour, { percent: 0, resetsAt: '' })
for (const bad of [null, {}, [], { limits: {} }, { limits: { core: fixture.limits.core } }]) assert.equal(parseFactoryQuota(bad), null)
for (const percent of [null, undefined, '1', -1, 101, Infinity, NaN]) {
  assert.equal(parseFactoryQuota({ limits: { standard: { fiveHour: { usedPercent: percent } } } }), null)
}
assert.equal(normalizeFactoryOrgId(' org_123 '), 'org_123')
for (const bad of ['x\r\nAuthorization: secret', 'x/y', 'x'.repeat(129), true]) assert.equal(normalizeFactoryOrgId(bad), null)
assert.equal(secretRefOf('codingPlans.factory'), 'FACTORY_API_KEY')
const config = sanitizeConfig({ codingPlans: { factory: { enabled: true, factoryPool: 'core', orgId: 'org_123', apiKey: 'PRIVATE_TOKEN' } } })
assert.equal(config.codingPlans.factory.factoryPool, 'core')
assert.equal(stripSecrets(config).codingPlans.factory.apiKey, '')
assert.equal(sanitizeConfig({ codingPlans: { factory: { enabled: true, orgId: 'x\r\nheader' } } }).codingPlans.factory.enabled, false)
assert.ok(applyConfigPatch(config, { codingPlans: { factory: { orgId: 'x\r\nheader' } } }).errors.length)
assert.equal(billingClassOf('droid', 'model', config.planBilling, enabledPlanSetOf(config)), 'plan')
assert.deepEqual(recordSamples({}, 'factory', standard, {}, now), {}, 'no invented Standard/Core attribution from aggregate local calls')
assert.equal(buildPlanStats({ days: {}, hourBuckets: {}, samples: {}, codingPlans: { factory: { status: 'ok', windows: standard } }, config, nowMs: now }).providers.factory, undefined)

const originalFetch = globalThis.fetch
const t = (_locale, code) => code
try {
  let calls = []
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(fixture)) }
  const result = await queryCodingPlan('factory', 'PRIVATE_TOKEN', 'en', t, { orgId: 'org_123', factoryPool: 'both' })
  assert.equal(Object.keys(result.windows).length, 6)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, FACTORY_QUOTA_URL)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.redirect, 'manual')
  assert.equal(calls[0].init.body, undefined)
  assert.equal(calls[0].init.headers.authorization, 'Bearer PRIVATE_TOKEN')
  assert.equal(calls[0].init.headers['x-factory-org-id'], 'org_123')
  assert.equal(calls[0].init.headers['x-factory-client'], 'cli')
  assert.equal(calls[0].init.headers['x-client-version'], '0.231.0')
  calls = []
  await queryCodingPlan('factory', 'PRIVATE_TOKEN', 'zh', t)
  assert.equal(calls[0].init.headers['x-factory-org-id'], undefined)
  const before = calls.length
  await assert.rejects(queryCodingPlan('factory', null, 'en', t), e => e.soft && e.message === 'codingPlanKeyMissing')
  await assert.rejects(queryCodingPlan('factory', 'PRIVATE_TOKEN', 'en', t, { orgId: 'x\r\nheader' }), /factoryOrgInvalid/)
  assert.equal(calls.length, before, 'missing credentials and invalid org never request')
  for (const status of [302, 401, 403, 500]) {
    globalThis.fetch = async () => new Response('PRIVATE_RESPONSE', { status, headers: { location: 'https://untrusted.invalid/' } })
    await assert.rejects(queryCodingPlan('factory', 'PRIVATE_TOKEN', 'en', t), e => !e.message.includes('PRIVATE') && (status === 401 || status === 403 ? e.soft && e.message === 'factoryUnauthorized' : e.message === 'codingPlanHttp'))
  }
  globalThis.fetch = async () => new Response('PRIVATE_INVALID_JSON')
  await assert.rejects(queryCodingPlan('factory', 'PRIVATE_TOKEN', 'en', t), /codingPlanNoUsage/)
  globalThis.fetch = async () => { throw new Error('PRIVATE_NETWORK_TOKEN') }
  await assert.rejects(queryCodingPlan('factory', 'PRIVATE_TOKEN', 'en', t), /factoryQueryFailed/)
  globalThis.fetch = async () => new Response('{}')
  await assert.rejects(queryCodingPlan('factory', 'PRIVATE_TOKEN', 'en', t), /codingPlanNoUsage/)
} finally { globalThis.fetch = originalFetch }

const root = mkdtempSync(join(tmpdir(), 'cm-factory-'))
const names = ['DSH_HOME', 'USERPROFILE', 'HOME', 'XDG_CONFIG_HOME', 'FACTORY_API_KEY']
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]))
const disposers = []
try {
  for (const name of names) delete process.env[name]
  process.env.DSH_HOME = process.env.USERPROFILE = process.env.HOME = root
  process.env.XDG_CONFIG_HOME = join(root, 'config')
  const storage = join(root, 'storages', 'cost-meter')
  mkdirSync(storage, { recursive: true })
  writeFileSync(join(storage, 'ledger.json'), JSON.stringify({ version: 1, config: { balance: { display: 'off' }, goQuota: { enabled: false } }, days: {} }))
  const secrets = new Map(), services = {}, fetches = []
  const credentials = {
    resolve: async ref => secrets.has(String(ref)) ? { value: secrets.get(String(ref)), source: 'file' } : undefined,
    describe: async ref => ({ configured: secrets.has(String(ref)), source: 'file' }),
    set: async (ref, value) => secrets.set(String(ref), value), unset: async ref => secrets.delete(String(ref)),
  }
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), FACTORY_QUOTA_URL)
    fetches.push(init)
    return new Response(JSON.stringify(fixture))
  }
  apply({ get: name => name === 'credentials' ? credentials : undefined,
    provide: (name, service) => { services[name] = service }, on: () => () => {}, inject() {},
    effect: fn => { const disposer = fn(); if (typeof disposer === 'function') disposers.push(disposer) },
    logger: { info() {}, warn() {}, error() {} },
  })
  const meter = services.costMeter
  await meter.getState()
  assert.equal(fetches.length, 0, 'default-off source makes no requests')
  assert.equal((await meter.setCredential('codingPlans.factory', 'PRIVATE_TOKEN')).ok, true)
  await meter.updateConfig({ codingPlans: { factory: { enabled: true, display: 'both', orgId: 'org_123', factoryPool: 'both' } } })
  const refreshed = await meter.refreshCodingPlan('factory')
  assert.equal(refreshed.ok, true, refreshed.message)
  const live = refreshed.state
  assert.equal(Object.keys(live.codingPlans.factory.windows).length, 6)
  assert.equal(live.config.codingPlans.factory.orgId, 'org_123')
  assert.equal(live.codingPlans.factory.keyConfigured, true)
  assert.equal(live.planStats.providers.factory, undefined)
  const codec = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create()
  for (const state of [stateSchema.parse(live), codec.parse(JSON.parse(JSON.stringify(live)))]) {
    assert.equal(state.config.codingPlans.factory.factoryPool, 'both')
    assert.equal(state.codingPlans.factory.factoryPool, 'both')
    assert.equal(state.codingPlans.factory.windows.core_monthly.percent, 100)
    assert.ok(!JSON.stringify(state).includes('PRIVATE'))
  }
  const cached = fetches.length
  await Promise.all([meter.getState(), meter.getState(), meter.getState()])
  assert.equal(fetches.length, cached, 'state polling shares the quota cache')
  assert.ok(fetches.every(init => init.method === 'GET' && init.headers.authorization === 'Bearer PRIVATE_TOKEN'))
  await meter.updateConfig({ codingPlans: { factory: { factoryPool: 'core' } } })
  const core = await meter.getState()
  assert.deepEqual(Object.keys(core.codingPlans.factory.windows), ['core_fiveHour', 'core_weekly', 'core_monthly'])
  let failures = 0
  globalThis.fetch = async () => { failures++; return new Response('PRIVATE_FAILURE', { status: 500 }) }
  assert.equal((await meter.refreshCodingPlan('factory')).ok, false)
  await Promise.all([meter.getState(), meter.getState(), meter.getState()])
  assert.equal(failures, 1, 'failed Factory reads are cached instead of retried on each poll')
  globalThis.fetch = async () => new Response(JSON.stringify(fixture))
  assert.equal((await meter.refreshCodingPlan('factory')).ok, true, 'manual refresh bypasses the cached failure')
  // Race: disable a source while its network read is running.
  let entered, release, pendingSignal
  const started = new Promise(resolve => { entered = resolve })
  globalThis.fetch = async (_url, init) => {
    assert.equal(String(_url), FACTORY_QUOTA_URL)
    pendingSignal = init.signal
    entered()
    return new Promise((resolve, reject) => {
      release = () => resolve(new Response(JSON.stringify(fixture)))
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })
  }
  const pending = meter.refreshCodingPlan('factory')
  await started
  await meter.updateConfig({ codingPlans: { factory: { enabled: false } } })
  assert.equal(pendingSignal.aborted, true, 'turning off the source aborts its query')
  release(); await pending
  assert.equal((await meter.getState()).codingPlans.factory.status, 'off')
  for (const dispose of disposers.splice(0).reverse()) dispose()
  await delay(20)
  const disk = readFileSync(join(storage, 'ledger.json'), 'utf8')
  assert.ok(!disk.includes('PRIVATE'))
  const reopened = Ledger.open()
  assert.equal(reopened.config.codingPlans.factory.factoryPool, 'core')
  assert.deepEqual(reopened.days, {})
  assert.equal(reopened.planSamples.factory, undefined)
  reopened.close()
} finally {
  for (const dispose of disposers.reverse()) dispose()
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] Factory quotas: pools, fixed GET, auth, redaction, config/codecs, cache, cancellation and persistence')
