import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TOKENRHYTHM_BALANCE_URL as endpoint, TOKENRHYTHM_BALANCE_CREDENTIAL_VARS as vars, parseTokenRhythmCookie, parseTokenRhythmBalance, queryTokenRhythmBalance } from '../lib/tokenrhythm-balance.js'
import { queryCustomBalance, customBalanceCredentialVars } from '../lib/custom-balance.js'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'

// 当前官网账户页使用 wallet/summary 的 availableBalanceCny，不是 total / frozen / cost。
const fixture = { code: 0, data: { availableBalanceCny: '68.1250', balanceCny: '98.1250', frozenBalanceCny: '30', totalCostCny: '999', currency: 'CNY' } }
const entry = { adapter: 'tokenrhythm', enabled: true, label: 'Token Rhythm', labelEn: 'Token Rhythm', display: 'both', unit: 'USD', refreshMinutes: 15, request: { url: endpoint, method: 'GET', headers: {} }, extract: {} }
const cfg = { locale: 'en', customBalance: entry, customBalances: [entry] }
const secret = 'sess_tokenrhythm_test_only'
const ctx = { get: () => ({ resolve: async () => ({ value: 'unrelated=private; tr_session=' + secret + '; tr_csrf=also-private' }) }) }
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers })
assert.deepEqual(vars, ['TOKENRHYTHM_COOKIE'])
for (const text of [secret, 'tr_session=' + secret, 'Cookie: other=x; tr_session=' + secret + '; tr_csrf=y']) assert.equal(parseTokenRhythmCookie(text), secret)
for (const text of ['', ' ', 'other=x', 'evil_tr_session=' + secret, 'tr_session=', 'tr_session=x; tr_session=y', 'tr_session=x\r\nX-Test:y', 'tr_session=x y', 'a'.repeat(16385)]) assert.throws(() => parseTokenRhythmCookie(text), /Cookie/)
assert.deepEqual(parseTokenRhythmBalance(fixture), { remaining: 68.125, unit: 'CNY', spend: null, maxBudget: null })
for (const code of [undefined, 0, '0', 200, '200']) assert.equal(parseTokenRhythmBalance({ ...fixture, code }).remaining, 68.125)
for (const value of [0, '0', '-1.25', ' 99.5 ']) assert.equal(parseTokenRhythmBalance({ availableBalanceCny: value }).remaining, Number(value))
assert.equal(parseTokenRhythmBalance({ data: { available_balance_cny: '9.75' } }).remaining, 9.75)
for (const value of [undefined, null, false, '', ' ', [], {}, 'invalid', Infinity, '1e999']) assert.throws(() => parseTokenRhythmBalance({ availableBalanceCny: value, balanceCny: 900 }), /可用余额/)
for (const payload of [null, [], {}, { data: null }, { ...fixture, code: 'UNAUTHORIZED' }, { ...fixture, success: false }, { availableBalanceCny: 10, currency: 'USD' }]) assert.throws(() => parseTokenRhythmBalance(payload))

const previousCookie = process.env.TOKENRHYTHM_COOKIE
const previousFetch = globalThis.fetch
delete process.env.TOKENRHYTHM_COOKIE
try {
  const sent = []
  const transport = async (url, init) => { sent.push({ url, init }); return json(fixture) }
  const result = await queryTokenRhythmBalance(ctx, cfg, { fetchImpl: transport })
  assert.equal(result.remaining, 68.125)
  assert.equal(result.unit, 'CNY')
  assert.equal(sent[0].url, endpoint)
  assert.equal(sent[0].init.method, 'GET')
  assert.equal(sent[0].init.body, undefined)
  assert.equal(sent[0].init.redirect, 'manual')
  assert.equal(sent[0].init.headers.Cookie, 'tr_session=' + secret, '仅发送 tr_session，不转发其他 Cookie')
  assert.ok(!JSON.stringify(result).includes(secret))
  globalThis.fetch = transport
  await queryCustomBalance(ctx, { ...cfg, customBalance: { ...entry, request: { url: 'https://untrusted.example/', method: 'POST', headers: { Cookie: 'injected' } }, extract: { remaining: 99999 } } })
  assert.equal(sent.at(-1).url, endpoint, '专用适配器不接受自定义地址、请求头和解析规则')
  assert.equal(sent.at(-1).init.method, 'GET')
  assert.equal(sent.at(-1).init.headers.Cookie, 'tr_session=' + secret)
  for (const status of [302, 401, 403, 429, 500]) {
    let calls = 0
    await assert.rejects(() => queryTokenRhythmBalance(ctx, cfg, { fetchImpl: async () => { calls++; return json({ message: secret }, status) } }), error => !error.message.includes(secret))
    assert.equal(calls, 1, `HTTP ${status} 不重试或跟随跳转`)
  }
  for (const response of [json({ ...fixture, code: 'UNAUTHORIZED', message: secret }), new Response('{invalid'), new Response('x'.repeat(262145)), json(fixture, 200, { 'content-length': '262145' })]) await assert.rejects(() => queryTokenRhythmBalance(ctx, cfg, { fetchImpl: async () => response }), error => !error.message.includes(secret))
  let networkCalls = 0
  await queryTokenRhythmBalance(ctx, cfg, { fetchImpl: async () => {
    if (++networkCalls === 1) throw Object.assign(new Error('network'), { code: 'ECONNRESET' })
    return json(fixture)
  } })
  assert.equal(networkCalls, 2)
  let missingCalls = 0
  await assert.rejects(() => queryTokenRhythmBalance({}, cfg, { fetchImpl: async () => { missingCalls++ } }), error => error.soft === true)
  assert.equal(missingCalls, 0)
  await assert.rejects(() => queryTokenRhythmBalance({ get: () => ({ resolve: async () => ({ value: 'invalid=cookie' }) }) }, cfg, { fetchImpl: async () => { missingCalls++ } }))
  assert.equal(missingCalls, 0)
  process.env.TOKENRHYTHM_COOKIE = secret
  assert.equal((await queryTokenRhythmBalance({}, cfg, { fetchImpl: transport })).remaining, 68.125)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => queryTokenRhythmBalance(ctx, cfg, { signal: controller.signal, fetchImpl: transport }), error => error.name === 'AbortError')
  const active = new AbortController()
  await assert.rejects(() => queryTokenRhythmBalance(ctx, cfg, { signal: active.signal, fetchImpl: async (_url, init) => {
    assert.equal(init.signal.aborted, false)
    active.abort()
    throw active.signal.reason
  } }), error => error.name === 'AbortError')
} finally {
  globalThis.fetch = previousFetch
  if (previousCookie === undefined) delete process.env.TOKENRHYTHM_COOKIE; else process.env.TOKENRHYTHM_COOKIE = previousCookie
}

const clean = sanitizeConfig(cfg)
assert.equal(clean.customBalances[0].adapter, 'tokenrhythm')
assert.equal(clean.customBalances[0].unit, 'CNY', '人民币接口不接受错误币种覆盖')
assert.deepEqual(customBalanceCredentialVars(entry), vars)
assert.deepEqual(applyConfigPatch(sanitizeConfig({}), { customBalances: [entry] }).errors, [])
assert.equal(stateSchema.shape.config.safeParse(clean).success, true)

// 宿主真实 RPC：写入凭据、余额缓存、改凭据作废旧值、删除条目；网络全部为假响应。
const root = mkdtempSync(join(tmpdir(), 'cm-tokenrhythm-290-'))
const oldHome = process.env.DSH_HOME
const storage = {}, provided = {}, disposers = []
let hostCalls = 0
try {
  delete process.env.TOKENRHYTHM_COOKIE
  process.env.DSH_HOME = root
  mkdirSync(join(root, 'storages', 'cost-meter'), { recursive: true })
  const ledgerPath = join(root, 'storages', 'cost-meter', 'ledger.json')
  writeFileSync(ledgerPath, JSON.stringify({ version: 1, config: { customBalances: [entry] }, days: {} }))
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), endpoint)
    assert.equal(init.headers.Cookie, 'tr_session=' + storage.TOKENRHYTHM_COOKIE)
    hostCalls++
    return json(fixture)
  }
  const credentials = {
    resolve: async ref => ({ value: storage[String(ref)] ?? '' }),
    describe: async ref => ({ configured: !!storage[String(ref)], source: 'store', writable: true }),
    set: async (ref, value) => { storage[String(ref)] = value },
    unset: async ref => { delete storage[String(ref)] },
  }
  const { apply } = await import('../lib/index.js')
  apply({ on: () => () => {}, effect: callback => { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose) }, inject: () => {}, provide: (key, value) => { provided[key] = value }, logger: { info() {}, warn() {}, error() {} }, get: key => key === 'credentials' ? credentials : key === 'settings' ? { get: () => ({}) } : undefined })
  const svc = provided.costMeter
  let snapshot = await svc.getState()
  assert.equal(snapshot.config.customBalances[0].adapter, 'tokenrhythm')
  assert.equal(snapshot.customVarStatus.TOKENRHYTHM_COOKIE.configured, false)
  assert.equal((await svc.setCredential('customVar:TOKENRHYTHM_COOKIE', secret)).ok, true)
  const refreshed = await svc.refreshCustomBalance(0)
  assert.equal(refreshed.ok, true)
  assert.ok(hostCalls > 0)
  snapshot = refreshed.state
  assert.equal(snapshot.customBalances[0].remaining, 68.125)
  assert.equal(snapshot.customBalances[0].unit, 'CNY')
  assert.equal(stateSchema.safeParse(snapshot).success, true)
  const afterRefresh = hostCalls
  await svc.getState(); await svc.getState()
  assert.equal(hostCalls, afterRefresh, '重复读取设置状态不重复查询未过期余额')
  assert.ok(!JSON.stringify(snapshot).includes(secret))
  assert.ok(!readFileSync(ledgerPath, 'utf8').includes(secret))
  const removed = await svc.clearCredential('customVar:TOKENRHYTHM_COOKIE')
  assert.equal(removed.state.customVarStatus.TOKENRHYTHM_COOKIE.configured, false)
  assert.notEqual(removed.state.customBalances[0].status, 'ok')
  const deleted = await svc.updateConfig({ customBalances: [], customBalance: { ...clean.customBalance, enabled: false, request: { url: '', headers: {} } } })
  assert.deepEqual(deleted.config.customBalances, [])
} finally {
  for (const dispose of disposers) dispose()
  globalThis.fetch = previousFetch
  if (previousCookie === undefined) delete process.env.TOKENRHYTHM_COOKIE; else process.env.TOKENRHYTHM_COOKIE = previousCookie
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] Token Rhythm：官网可用余额、Cookie、错误边界、配置、缓存与宿主 RPC 通过')
