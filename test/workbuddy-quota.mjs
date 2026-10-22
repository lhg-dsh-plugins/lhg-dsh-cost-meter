import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CODING_PLAN_PROVIDER_IDS,
  CODING_PLAN_PROVIDERS,
  formatWorkBuddyBalance,
  normalizeResetAt,
  queryCodingPlan,
  textWindowOf,
} from '../lib/coding-plans.js'
import { applyConfigPatch, sanitizeConfig, SECRET_TARGETS } from '../lib/store.js'
import {
  billingHeadersOf,
  isWorkBuddyAuthEncrypted,
  isWorkBuddyTokenExpired,
  parseWorkBuddyAuth,
  parseWorkBuddyEnterpriseCredits,
  parseWorkBuddyPersonalCredits,
  regionOf,
  resolveWorkBuddyCredential,
  WORKBUDDY_AUTH_FILE_ENV,
  WORKBUDDY_AUTH_FILENAME,
  workbuddyDesktopAuthCandidates,
} from '../lib/workbuddy.js'

const stubT = (locale, code, vars = {}) => {
  let text = `${locale}:${code}`
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v))
  return text
}

console.log('[workbuddy-quota] registry & plan-billing')
assert.ok(CODING_PLAN_PROVIDER_IDS.includes('workbuddy'), 'workbuddy registered')
assert.deepEqual(CODING_PLAN_PROVIDERS.workbuddy.credentialEnvs, [], 'no credentialEnvs')
assert.ok(!SECRET_TARGETS.includes('codingPlans.workbuddy'), 'no secret target for workbuddy')

console.log('[workbuddy-quota] regionOf')
assert.equal(regionOf('www.workbuddy.ai'), 'global')
assert.equal(regionOf('WORKBUDDY.AI'), 'global')
assert.equal(regionOf('workbuddyai.example'), 'cn')
assert.equal(regionOf(''), 'cn')

console.log('[workbuddy-quota] billingHeadersOf')
assert.deepEqual(billingHeadersOf({ accessToken: 'tok', uid: 'u1', domain: '' }), {
  authorization: 'Bearer tok',
  accept: 'application/json',
  'content-type': 'application/json',
  'x-user-id': 'u1',
})
assert.deepEqual(
  billingHeadersOf({ accessToken: 'tok', uid: 'u1', domain: 'www.workbuddy.ai', enterpriseId: 'ent9' }),
  {
    authorization: 'Bearer tok',
    accept: 'application/json',
    'content-type': 'application/json',
    'x-user-id': 'u1',
    'x-enterprise-id': 'ent9',
    'x-tenant-id': 'ent9',
    'x-domain': 'www.workbuddy.ai',
  },
)

console.log('[workbuddy-quota] parseWorkBuddyAuth')
const nested = parseWorkBuddyAuth(JSON.stringify({
  auth: { accessToken: 'a1', expiresAt: 1893456000, refreshToken: 'r1', domain: 'www.workbuddy.ai' },
  account: { uid: 'u1', enterpriseId: 'ent9', nickname: 'Tan' },
}))
assert.equal(nested.accessToken, 'a1')
assert.equal(nested.expiresAtMs, 1893456000000) // 秒→毫秒
assert.equal(nested.domain, 'www.workbuddy.ai')
assert.equal(nested.enterpriseId, 'ent9')
assert.equal(nested.nickname, 'Tan')
const flat = parseWorkBuddyAuth(JSON.stringify({ accessToken: 'a2', uid: 'u2' }))
assert.equal(flat.accessToken, 'a2')
assert.equal(flat.expiresAtMs, 0)
assert.equal(parseWorkBuddyAuth('not json'), undefined)
assert.equal(parseWorkBuddyAuth(JSON.stringify({ refreshToken: 'x' })), undefined)

console.log('[workbuddy-quota] own-copy shape (connect refresh copy)')
const own = parseWorkBuddyAuth(JSON.stringify({
  version: 1,
  credential: { accessToken: 'a3', expiresAtMs: 1893456000000, refreshToken: 'r3', domain: 'www.codebuddy.cn', uid: 'u3', enterpriseId: 'ent1' },
}))
assert.equal(own.accessToken, 'a3')
assert.equal(own.expiresAtMs, 1893456000000)
assert.equal(own.enterpriseId, 'ent1')

console.log('[workbuddy-quota] encrypted detection')
assert.equal(isWorkBuddyAuthEncrypted(JSON.stringify({
  auth: { accessToken: { $wbEncrypted: 1, envelope: 'AAAA' }, refreshToken: 'r' },
})), true)
assert.equal(isWorkBuddyAuthEncrypted('{"accessToken":42}'), true)
assert.equal(isWorkBuddyAuthEncrypted('{"accessToken":"plain"}'), false)
assert.equal(isWorkBuddyAuthEncrypted('garbage'), true)

console.log('[workbuddy-quota] token expiry')
assert.equal(isWorkBuddyTokenExpired({ expiresAtMs: 1000 }), true)
assert.equal(isWorkBuddyTokenExpired({ expiresAtMs: 1893456000000 }), false)
assert.equal(isWorkBuddyTokenExpired({ expiresAtMs: 0 }), false)

console.log('[workbuddy-quota] desktop candidates (win32 first = LOCALAPPDATA)')
const winCandidates = workbuddyDesktopAuthCandidates('C:\\Users\\t', {}, 'win32')
assert.deepEqual(winCandidates.map(p => p.split(/[\\/]/).slice(-5)), [
  ['CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info'],
  ['CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info'],
])
assert.ok(winCandidates[0].replace(/\\/g, '/').includes('AppData/Local'), 'first win candidate = LocalAppData')
const linuxCandidates = workbuddyDesktopAuthCandidates('/home/t', {}, 'linux')
assert.deepEqual(linuxCandidates.map(p => p.split(/[\\/]/).slice(-5)), [
  ['CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info'],
  ['CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info'],
])
assert.ok(linuxCandidates[0].replace(/\\/g, '/').endsWith('.config/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info'), 'linux first = XDG_CONFIG_HOME default')

console.log('[workbuddy-quota] resolveWorkBuddyCredential')
const dir = mkdtempSync(join(tmpdir(), 'wb-quota-'))
const missingRead = () => { throw new Error('miss') } // 全部候选视为不存在(隔离真机上的真实登录文件)
try {
  const env = { [WORKBUDDY_AUTH_FILE_ENV]: join(dir, WORKBUDDY_AUTH_FILENAME) }
  assert.throws(() => resolveWorkBuddyCredential({ env, readFile: missingRead }), /workbuddyNotInstalled/)
  writeFileSync(join(dir, WORKBUDDY_AUTH_FILENAME), JSON.stringify({ auth: { accessToken: { $wbEncrypted: 1 } } }), 'utf8')
  assert.throws(() => resolveWorkBuddyCredential({ env, readFile: path => path === env[WORKBUDDY_AUTH_FILE_ENV] ? readFileSync(path, 'utf8') : missingRead() }), /workbuddyAuthEncrypted/)
  writeFileSync(join(dir, WORKBUDDY_AUTH_FILENAME), JSON.stringify({ accessToken: 'ok1', uid: 'u' }), 'utf8')
  assert.equal(resolveWorkBuddyCredential({ env }).accessToken, 'ok1')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('[workbuddy-quota] personal credits parsing')
const personal = parseWorkBuddyPersonalCredits({
  code: 0,
  data: { Response: { Data: { Accounts: [
    { PackageName: '月包', CycleCapacitySize: 100, CycleCapacityRemain: 37.5, CycleCapacityUsed: 62.5 },
    { PackageName: '年包', CapacityRemain: 5, CapacitySize: 10 },
    { PackageName: '负值', CycleCapacityRemain: -3 },
  ] } } },
})
assert.equal(personal.total, 42.5)
assert.equal(personal.accounts.length, 3)
assert.equal(parseWorkBuddyPersonalCredits({ code: 0, data: {} }), null)

for (const row of [{}, { CapacityRemain: NaN }, { CycleCapacitySize: 100 }, { CapacityRemain: '12' }]) {
  assert.throws(() => parseWorkBuddyPersonalCredits({ data: { Response: { Data: { Accounts: [row] } } } }), /workbuddyInvalidCredits/)
}
const staleCredential = JSON.stringify({ accessToken: 'stale-fixture', expiresAtMs: 1000 })
const freshCredential = JSON.stringify({ accessToken: 'fresh-fixture', expiresAtMs: 1893456000000 })
let credentialReads = 0
assert.equal(resolveWorkBuddyCredential({ env: { WORKBUDDY_AUTH_FILE: 'fixture-only' }, readFile: () => ++credentialReads === 1 ? staleCredential : freshCredential }).accessToken, 'fresh-fixture')
console.log('[workbuddy-quota] enterprise credits parsing')
const unlimited = parseWorkBuddyEnterpriseCredits({ data: { data: { limitNum: -1, credit: 0, cycleResetTime: '2026-11-01 00:00:00' } } })
assert.equal(unlimited.unlimited, true)
const ent = parseWorkBuddyEnterpriseCredits({ data: { limit_num: 1000, used_num: 400, cycleResetTime: '2026-11-01 00:00:00' } })
assert.equal(ent.total, 600)
assert.equal(ent.unlimited, false)
assert.equal(ent.cycleResetTime, '2026-11-01 00:00:00')
assert.throws(() => parseWorkBuddyEnterpriseCredits({ data: {} }), /workbuddyEnterpriseNoQuota/)
assert.throws(() => parseWorkBuddyEnterpriseCredits({ data: { limitNum: 100 } }), /workbuddyEnterpriseNoUsage/)

console.log('[workbuddy-quota] queryCodingPlan soft prechecks (no network)')
// 隔离真机:readFile 恒缺失 → workbuddyNotInstalled;命中真机加密文件时报 workbuddyAuthEncrypted,两者均为软错误。
{
  let softCode = ''
  await queryCodingPlan('workbuddy', { env: {}, readFile: missingRead }, 'zh', stubT).catch(error => { if (error.soft === true) softCode = error.message })
  assert.equal(softCode, 'zh:workbuddyNotInstalled')
  // 登录态过期:候选文件返回已过期的 accessToken → soft workbuddyTokenExpired。
  const expiredText = JSON.stringify({ accessToken: 'x', expiresAt: 1000 })
  softCode = ''
  await queryCodingPlan('workbuddy', { env: {}, readFile: () => expiredText }, 'zh', stubT).catch(error => { if (error.soft === true) softCode = error.message })
  assert.equal(softCode, 'zh:workbuddyTokenExpired')
}

console.log('[workbuddy-quota] queryCodingPlan network path (mocked fetch, isolated from real auth files)')
const realFetch = globalThis.fetch
try {
  const credentialText = JSON.stringify({ accessToken: 'ok2', uid: 'u', domain: '' })
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://www.codebuddy.cn/v2/billing/meter/get-user-resource')
    assert.equal(init.headers.authorization, 'Bearer ok2')
    assert.equal(init.redirect, 'error')
    assert.deepEqual(JSON.parse(init.body).ProductCode, 'p_tcaca')
    return new Response(JSON.stringify({ code: 0, data: { Response: { Data: { Accounts: [
      { PackageName: '包', CycleCapacitySize: 200, CycleCapacityRemain: 88, CycleCapacityUsed: 112 },
    ] } } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const result = await queryCodingPlan('workbuddy', { env: {}, readFile: () => credentialText }, 'zh', stubT)
  assert.ok(result.windows.balance, 'balance window present')
  assert.match(result.windows.balance.text, /^88$/, 'balance text carries the number only; the window label says 余额')
} finally {
  globalThis.fetch = realFetch
}

console.log('[workbuddy-quota] enterprise unlimited → workbuddyUnlimited text')
try {
  const credentialText = JSON.stringify({ accessToken: 'ok3', uid: 'u', domain: '', enterpriseId: 'e1' })
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, data: { limitNum: -1, credit: 3, cycleResetTime: '2026-11-01 00:00:00' } }), { status: 200, headers: { 'content-type': 'application/json' } })
  const result = await queryCodingPlan('workbuddy', { env: {}, readFile: () => credentialText }, 'zh', stubT)
  assert.equal(result.windows.balance.text, 'zh:workbuddyUnlimited')
} finally {
  globalThis.fetch = realFetch
}

console.log('[workbuddy-quota] enterprise reset window carried through')
try {
  const credentialText = JSON.stringify({ accessToken: 'ok4', uid: 'u', domain: '', enterpriseId: 'e1' })
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, data: { limit_num: 1000, used_num: 400, cycleResetTime: '2026-11-01 00:00:00' } }), { status: 200, headers: { 'content-type': 'application/json' } })
  const result = await queryCodingPlan('workbuddy', { env: {}, readFile: () => credentialText }, 'zh', stubT)
  assert.match(result.windows.balance.text, /600/)
  assert.ok(result.windows.cycleReset, 'cycleReset window present')
  assert.ok(result.windows.cycleReset.resetsAt.length > 0)
} finally {
  globalThis.fetch = realFetch
}

for (const status of [401, 403]) {
  try {
    globalThis.fetch = async () => new Response('', { status })
    await assert.rejects(queryCodingPlan('workbuddy', { env: {}, readFile: () => JSON.stringify({ accessToken: 'fixture-only' }) }, 'en', stubT), error => error.soft && error.message === 'en:workbuddyTokenExpired')
  } finally { globalThis.fetch = realFetch }
}
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 500, msg: 'fixture-secret-echo' }))
  await assert.rejects(queryCodingPlan('workbuddy', { env: {}, readFile: () => JSON.stringify({ accessToken: 'fixture-only' }) }, 'en', stubT), error => error.message === 'workbuddyBillingFailed')
} finally { globalThis.fetch = realFetch }
console.log('[workbuddy-quota] sanitize')
const { config: patch, errors: patchErrors } = applyConfigPatch(sanitizeConfig({}), { codingPlans: { workbuddy: { enabled: true, display: 'sidebar', refreshMinutes: 30 }, nope: { enabled: true } } })
assert.deepEqual(patchErrors, [])
assert.equal(patch.codingPlans.workbuddy.enabled, true)
assert.equal(patch.codingPlans.workbuddy.display, 'sidebar')
assert.equal(patch.codingPlans.workbuddy.refreshMinutes, 30)
assert.equal(patch.codingPlans.workbuddy.apiKey, '')
assert.equal(patch.codingPlans.workbuddy.bogus, undefined)
assert.equal(patch.codingPlans.nope, undefined)
// 未知提供商条目收敛;refreshMinutes 越界钳制。
const converged = sanitizeConfig({ codingPlans: { workbuddy: { refreshMinutes: 9999 }, unknownProvider: { enabled: true } } })
assert.equal(converged.codingPlans.workbuddy.refreshMinutes, 1440)
assert.equal(converged.codingPlans.unknownProvider, undefined)

console.log('[workbuddy-quota] i18n appears exactly twice (zh+en) & panels literal')
const i18nSrc = readFileSync(new URL('../src/client/01-open-styles-i18n.js', import.meta.url), 'utf8')
assert.equal(i18nSrc.split('wbT').length - 1, 2, 'wbT zh+en')
const indexSrc = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
for (const key of ['workbuddyNotInstalled', 'workbuddyAuthEncrypted', 'workbuddyTokenExpired', 'workbuddyUnlimited']) {
  assert.equal(indexSrc.split(`${key}:`).length - 1, 2, `${key} zh+en`)
}
const panelsSrc = readFileSync(new URL('../src/client/03-settings-panels-main.js', import.meta.url), 'utf8')
assert.ok(panelsSrc.includes("{ id: 'workbuddy', labelKey: 'wbT' }"), 'panels row literal')

console.log('[workbuddy-quota] helpers')
assert.equal(formatWorkBuddyBalance(1234.6), '1,235', 'thousands separator, no duplicated 余额 prefix')
assert.equal(formatWorkBuddyBalance(88), '88')
assert.ok(normalizeResetAt('2026-11-01T00:00:00Z') !== '')
assert.deepEqual(textWindowOf('x'), { resetsAt: '', text: 'x' })

console.log('[ok] workbuddy-quota')
