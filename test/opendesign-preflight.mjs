// Issue #274 follow-up: on some accounts /billing/coding-plan-usage only accepts a browser session,
// while /billing/preflight accepts the same Control Key as a plain Bearer credential and nests the
// identical quota windows under `codingPlan`. Query preflight directly, keep the
// wallet independent, and never send a cookie. Every request below is injected: no live network.
import assert from 'node:assert/strict'
import { OPENDESIGN_API, OPEN_DESIGN_QUOTA_FAILURES, parseOpenDesignUsage, queryOpenDesignQuota } from '../lib/opendesign.js'
import { queryCodingPlan } from '../lib/coding-plans.js'

const realFetch = globalThis.fetch
let networkCalls = 0
globalThis.fetch = async () => { networkCalls++; throw Error('network access is forbidden in this test') }

const workspaceId = 'ws-preflight'
const key = 'SYNTHETIC-CONTROL-KEY-PREFLIGHT'
const base = OPENDESIGN_API + '/workspaces/' + workspaceId
const usageUrl = base + '/billing/coding-plan-usage'
const preflightUrl = base + '/billing/preflight'
const walletUrl = base + '/wallet/balance'
const message = (_, code) => 'OpenDesign: ' + code
// Shape verified from the 2026-10-17 #274 comment: /billing/preflight returns the same window packet
// under `codingPlan`, with the member identity and the wallet balance alongside.
const windows = [
  { policyId: 'model_limit_policy_yfhv', durationSeconds: 18000, resetMode: 'anchored_recurring', usedCredits: '15940', limitCredits: '50000', remainingCredits: '34060', windowStart: '2026-10-17T12:00:00Z', resetsAt: '2026-10-17T17:00:00Z' },
  { policyId: 'model_limit_policy_ois3', durationSeconds: 604800, resetMode: 'anchored_recurring', usedCredits: '15940', limitCredits: '150000', remainingCredits: '134060', windowStart: '2026-10-17T00:00:00Z', resetsAt: '2026-10-20T00:00:00Z' },
]
const usageBody = { workspaceId, workspaceMemberId: 'member-1', eligible: true, tier: 'go', windows }
const preflightBody = {
  schemaVersion: 1, workspaceId, workspaceMemberId: 'member-1', modelId: null, generatedAt: '2026-10-17T16:25:11.680Z',
  balanceUsd: '1.5000', codingPlan: { workspaceId, generatedAt: '2026-10-17T16:25:11.680Z', eligible: true, tier: 'go', windows },
  modelCovered: null, funding: 'wallet',
}
const wallet = { billingScopeVersion: 2, workspaceId, workspaceMemberId: 'member-1', balanceUsd: '2.0000' }
const noSubscription = { ...preflightBody, codingPlan: { workspaceId, eligible: false, tier: 'free', windows: [] } }
const json = value => Response.json(value)
const rejected = (status, body = 'PRIVATE BODY ' + key) => () => new Response(body, { status })
/** Every request must be the fixed workspace GET with the Control Key and no browser session. */
const verifyRequest = (url, init) => {
  assert.equal(init.method, 'GET')
  assert.equal(init.redirect, 'error')
  assert.equal(init.headers.accept, 'application/json')
  assert.equal(init.headers.authorization, 'Bearer ' + key)
  assert.equal(init.headers['x-vela-workspace-id'], workspaceId)
  assert.equal(init.headers.cookie, undefined, 'Control Key queries must not send a browser session cookie')
}
const transport = routes => {
  const calls = []
  const fetchImpl = async (url, init) => {
    verifyRequest(url, init)
    calls.push(url)
    const handler = url === walletUrl ? routes.wallet : url === preflightUrl ? routes.preflight : url === usageUrl ? routes.usage : undefined
    assert.ok(handler !== undefined, 'unexpected endpoint: ' + url)
    return typeof handler === 'function' ? handler(url, init) : handler
  }
  return { calls, fetchImpl }
}
const run = async (routes, locale = 'en') => {
  const context = transport(routes)
  const result = await queryOpenDesignQuota(key, locale, message, { workspaceId, fetchImpl: context.fetchImpl })
  return { result, calls: context.calls }
}
const failureOf = promise => promise.then(() => null, error => error)
const fiveHourReset = new Date('2026-10-17T17:00:00Z').toISOString()
const weeklyReset = new Date('2026-10-20T00:00:00Z').toISOString()

// 1. The parser unwraps `codingPlan` without changing any BigInt/window validation.
{
  const parsed = parseOpenDesignUsage(preflightBody, workspaceId)
  assert.equal(parsed.fiveHour.percent, 31.88)
  assert.equal(parsed.weekly.percent, 10.626)
  assert.equal(parsed.fiveHour.resetsAt, fiveHourReset)
  assert.equal(parsed.weekly.resetsAt, weeklyReset)
  assert.deepEqual(parseOpenDesignUsage({ ...preflightBody, codingPlan: { ...preflightBody.codingPlan, eligible: false, windows: [] } }, workspaceId), {},
    'an eligible:false codingPlan still means no subscription')
  assert.equal(parseOpenDesignUsage({ codingPlan: { eligible: true, windows } }, workspaceId), null,
    'the parser itself still requires a workspace identity')
  assert.equal(parseOpenDesignUsage({ ...preflightBody, workspaceId: 'ws-other' }, workspaceId), null)
  assert.equal(parseOpenDesignUsage({ ...preflightBody, codingPlan: { ...preflightBody.codingPlan, workspaceMemberId: 'member-other' } }, workspaceId), null)
  assert.equal(parseOpenDesignUsage({ ...preflightBody, workspaceId: 'ws-other', codingPlan: { ...preflightBody.codingPlan, workspaceId: 'ws-other' } }, workspaceId), null,
    'a conflicting workspace stays invalid')
}

// 2. preflight 200: full windows, preflight endpoint, no partial marker, wallet kept.
{
  const { result, calls } = await run({ usage: rejected(401), preflight: json(preflightBody), wallet: json(wallet) })
  assert.equal(result.endpoint, preflightUrl)
  assert.equal(result.windows.fiveHour.percent, 31.88)
  assert.equal(result.windows.weekly.percent, 10.626)
  assert.equal(result.windows.fiveHour.resetsAt, fiveHourReset)
  assert.equal(result.windows.weekly.resetsAt, weeklyReset)
  assert.equal(result.windows.balance.text, '$2.0000', 'a readable wallet stays authoritative over the preflight balance')
  assert.equal(Object.hasOwn(result, 'partial'), false, 'a successful preflight query is a normal, non-partial answer')
  assert.deepEqual(calls.slice().sort(), [preflightUrl, walletUrl].sort())
  assert.equal(calls.includes(usageUrl), false, 'the browser-session-only route is never queried')
}

// 3. Even when the old route would answer, only preflight and wallet are queried.
{
  let usageCalls = 0, preflightCalls = 0
  const { result, calls } = await run({
    usage: () => { usageCalls++; return json(usageBody) },
    preflight: () => { preflightCalls++; return json(preflightBody) },
    wallet: json(wallet),
  })
  assert.equal(usageCalls, 0)
  assert.equal(preflightCalls, 1)
  assert.equal(result.endpoint, preflightUrl)
  assert.equal(result.windows.fiveHour.percent, 31.88)
  assert.equal(result.windows.balance.text, '$2.0000')
  assert.equal(Object.hasOwn(result, 'partial'), false)
  assert.equal(calls.length, 2)
}

// 4. preflight 403 + wallet 200: wallet-only partial, preflight attempted exactly once.
{
  let preflightCalls = 0
  const { result, calls } = await run({
    usage: rejected(401),
    preflight: () => { preflightCalls++; return new Response('PRIVATE BODY ' + key, { status: 403 }) },
    wallet: json(wallet),
  })
  assert.deepEqual(result.windows, { balance: { text: '$2.0000', resetsAt: '' } })
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.unauthorized })
  assert.equal(result.endpoint, walletUrl)
  assert.equal(preflightCalls, 1)
  assert.equal(calls.length, 2)
}

// 5. A preflight eligible:false answer + readable wallet is a partial success (no fabricated windows).
{
  const { result } = await run({ usage: rejected(401), preflight: json(noSubscription), wallet: json(wallet) })
  assert.deepEqual(result.windows, { balance: { text: '$2.0000', resetsAt: '' } })
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.noSubscription })
}

// 6. eligible:false without a readable balance: the dedicated soft "no subscription" error, in
// both languages, with the built-in fallback text when the message catalog has no key yet.
{
  const missingKey = (_, code) => code
  const noBalance = { ...noSubscription, balanceUsd: undefined }
  for (const locale of ['en', 'zh']) {
    const error = await failureOf(queryOpenDesignQuota(key, locale, missingKey, {
      workspaceId, fetchImpl: transport({ usage: rejected(401), preflight: json(noBalance), wallet: rejected(401) }).fetchImpl,
    }))
    assert.equal(error.soft, true)
    assert.equal(error.code, OPEN_DESIGN_QUOTA_FAILURES.noSubscription)
    assert.equal(error.message.includes(key), false)
    assert.match(error.message, locale === 'zh' ? /没有生效的套餐订阅/ : /no active plan subscription/i)
  }
  const translated = (_, code) => code === 'codingPlanNoSubscription' ? 'OpenDesign: no plan (catalog)' : 'OpenDesign: ' + code
  const error = await failureOf(queryOpenDesignQuota(key, 'en', translated, {
    workspaceId, fetchImpl: transport({ usage: rejected(401), preflight: json(noBalance), wallet: rejected(401) }).fetchImpl,
  }))
  assert.equal(error.message, 'OpenDesign: no plan (catalog)')
  assert.equal(error.code, OPEN_DESIGN_QUOTA_FAILURES.noSubscription)
}

// A valid preflight balance is useful even without a subscription and a readable wallet route.
for (const locale of ['zh', 'en']) {
  const result = await queryOpenDesignQuota(key, locale, message, {
    workspaceId, fetchImpl: transport({ preflight: json(noSubscription), wallet: rejected(403) }).fetchImpl,
  })
  assert.deepEqual(result.windows, { balance: { text: '$1.5000', resetsAt: '' } })
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.noSubscription, wallet: OPEN_DESIGN_QUOTA_FAILURES.unauthorized })
  assert.match(result.message, /billing\/preflight/)
  assert.match(result.message, /codingPlanNoSubscription/)
  assert.match(result.message, /codingPlanUnauthorized/)
}

// 7. A preflight response that is not JSON is an invalid response, never a leaked body.
{
  const { result } = await run({ usage: rejected(401), preflight: () => new Response('<html>' + key), wallet: json(wallet) })
  assert.deepEqual(result.windows, { balance: { text: '$2.0000', resetsAt: '' } })
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.invalidResponse })
  assert.equal(JSON.stringify(result).includes(key), false)
}

// 8. Corrupted preflight windows (credits that cannot reconcile) are rejected, never fabricated.
{
  const broken = { ...preflightBody, codingPlan: { ...preflightBody.codingPlan, windows: [{ ...windows[0], remainingCredits: '0' }] } }
  const { result } = await run({ usage: rejected(401), preflight: json(broken), wallet: json(wallet) })
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.invalidResponse })
  assert.equal(Object.hasOwn(result.windows, 'weekly'), false)
}

// 9. A network failure on the preflight fallback is classified and never leaks the transport error.
{
  const { result } = await run({ usage: rejected(401), preflight: () => { throw Error('private transport ' + key) }, wallet: json(wallet) })
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.network })
  assert.equal(JSON.stringify(result).includes(key), false)
}

// 10. A preflight HTTP failure preserves the wallet without trying the legacy route.
{
  let preflightCalls = 0
  const { result } = await run({
    usage: () => new Response('upstream failure', { status: 500 }),
    preflight: () => { preflightCalls++; return new Response('upstream failure', { status: 500 }) },
    wallet: json(wallet),
  })
  assert.equal(preflightCalls, 1, 'non-auth HTTP failures never switch endpoints')
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.http })
  assert.equal(result.windows.balance.text, '$2.0000')
}

// 11. The preflight balanceUsd is only a display fallback when /wallet/balance cannot be read.
{
  const { result } = await run({ usage: rejected(401), preflight: json(preflightBody), wallet: rejected(401) })
  assert.equal(result.endpoint, preflightUrl)
  assert.equal(result.windows.fiveHour.percent, 31.88)
  assert.deepEqual(result.windows.balance, { text: '$1.5000', resetsAt: '' })
  assert.deepEqual(result.partial, { wallet: OPEN_DESIGN_QUOTA_FAILURES.unauthorized })
  const numeric = await run({ usage: rejected(401), preflight: json({ ...preflightBody, balanceUsd: 12.5 }), wallet: () => new Response('bad', { status: 500 }) })
  assert.deepEqual(numeric.result.windows.balance, { text: '$12.5', resetsAt: '' })
  const invalid = await run({ usage: rejected(401), preflight: json({ ...preflightBody, balanceUsd: 'not-money' }), wallet: rejected(401) })
  assert.equal(Object.hasOwn(invalid.result.windows, 'balance'), false, 'an invalid fallback balance is not displayed')
}

// 12. A preflight member that disagrees with the wallet is still rejected as an identity mismatch.
{
  const error = await failureOf(queryOpenDesignQuota(key, 'en', message, {
    workspaceId, fetchImpl: transport({ usage: rejected(401), preflight: json({ ...preflightBody, workspaceMemberId: 'member-2' }), wallet: json(wallet) }).fetchImpl,
  }))
  assert.equal(error.code, OPEN_DESIGN_QUOTA_FAILURES.identityMismatch)
  assert.equal(error.soft, undefined)
  assert.match(error.message, /identities/)
}

// Identity checks also apply to ineligible members, before displaying a no-subscription notice.
{
  const error = await failureOf(queryOpenDesignQuota(key, 'en', message, {
    workspaceId, fetchImpl: transport({ preflight: json({ ...noSubscription, workspaceMemberId: 'member-2' }), wallet: json(wallet) }).fetchImpl,
  }))
  assert.equal(error.code, OPEN_DESIGN_QUOTA_FAILURES.identityMismatch)
  const wrongWorkspace = { ...noSubscription, workspaceId: 'ws-other', codingPlan: { ...noSubscription.codingPlan, workspaceId: 'ws-other' } }
  await assert.rejects(queryOpenDesignQuota(key, 'en', message, {
    workspaceId, fetchImpl: transport({ preflight: json(wrongWorkspace), wallet: rejected(403) }).fetchImpl,
  }), error => error.code === OPEN_DESIGN_QUOTA_FAILURES.unauthorized)
}

// 13. A body without the redundant outer workspaceId is accepted (the response is scoped by the
// request), while a body naming a different workspace is rejected rather than retargeted.
{
  const withoutWorkspace = {
    schemaVersion: 1, workspaceMemberId: 'member-1', balanceUsd: '1.5000',
    codingPlan: { eligible: true, tier: 'go', windows }, funding: 'wallet',
  }
  const { result } = await run({ usage: rejected(401), preflight: json(withoutWorkspace), wallet: json(wallet) })
  assert.equal(result.windows.fiveHour.percent, 31.88)
  assert.equal(result.endpoint, preflightUrl)
  const wrong = await run({
    usage: rejected(401), preflight: json({ ...preflightBody, workspaceId: 'ws-other', codingPlan: { ...preflightBody.codingPlan, workspaceId: 'ws-other' } }), wallet: json(wallet),
  })
  assert.deepEqual(wrong.result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.invalidResponse })
  const outerWrong = await run({ usage: rejected(401), preflight: json({ ...preflightBody, workspaceId: 'ws-other' }), wallet: json(wallet) })
  assert.deepEqual(outerWrong.result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.invalidResponse },
    'a conflicting outer workspace is rejected even when the nested codingPlan matches')
  const nestedWrong = await run({ usage: rejected(401), preflight: json({ ...preflightBody, codingPlan: { ...preflightBody.codingPlan, workspaceId: 'ws-other' } }), wallet: json(wallet) })
  assert.deepEqual(nestedWrong.result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.invalidResponse },
    'a conflicting nested codingPlan workspace is rejected')
}

// 14. The registered quota adapter keeps the { windows, endpoint } contract with direct preflight.
{
  const previousFetch = globalThis.fetch
  const attempts = []
  try {
    globalThis.fetch = transport({ usage: rejected(401), preflight: json(preflightBody), wallet: json(wallet) }).fetchImpl
    const routed = await queryCodingPlan('opendesign', key, 'en', message, { workspaceId, onAttempt: attempt => attempts.push(attempt) })
    assert.equal(routed.endpoint, preflightUrl)
    assert.equal(routed.windows.fiveHour.percent, 31.88)
    assert.equal(routed.windows.balance.text, '$2.0000')
    assert.equal(Object.hasOwn(routed, 'partial'), false)
    assert.equal(attempts.length, 0, 'a successful preflight query is not reported as a partial refresh')
  } finally { globalThis.fetch = previousFetch }
}

// 15. Everything failed: a soft authorization error that never contains the credential.
{
  const error = await failureOf(queryOpenDesignQuota(key, 'en', message, {
    workspaceId, fetchImpl: transport({ usage: rejected(401), preflight: rejected(401), wallet: rejected(401) }).fetchImpl,
  }))
  assert.equal(error.soft, true)
  assert.equal(error.code, OPEN_DESIGN_QUOTA_FAILURES.unauthorized)
  assert.equal(error.message.includes(key), false)
}

assert.equal(networkCalls, 0, 'no real network request was made')
globalThis.fetch = realFetch
console.log('[ok] OpenDesign direct preflight: two Bearer-only reads, authoritative wallet, balanceUsd fallback, no-subscription/invalid/network classification and no cookies; no live account or network requests')
