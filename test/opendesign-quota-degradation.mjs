// Issue #274: the OpenDesign usage endpoint can reject a Control Key (401/403) while the wallet
// endpoint still answers. The query then retries the Cookie-free /billing/preflight route, and when
// both window routes fail the wallet is still read independently so that a partial answer refreshes
// the card; the error surface must distinguish the failure causes.
// No live account, network or paid model request is involved: every fetch is injected.
import assert from 'node:assert/strict'
import { OPENDESIGN_API, OPEN_DESIGN_QUOTA_FAILURES, queryOpenDesignQuota } from '../lib/opendesign.js'
import { queryCodingPlan } from '../lib/coding-plans.js'

const workspaceId = 'ws-degrade'
const key = 'SYNTHETIC-CONTROL-KEY-DEGRADE'
const base = OPENDESIGN_API + '/workspaces/' + workspaceId
const message = (_, code) => 'OpenDesign: ' + code
const quota = { workspaceId, workspaceMemberId: 'member-1', eligible: true, tier: 'go', windows: [
  { policyId: 'five', durationSeconds: 18000, usedCredits: '250000', limitCredits: '1000000', remainingCredits: '750000', resetsAt: null },
  { policyId: 'week', durationSeconds: 604800, usedCredits: '0', limitCredits: '100', remainingCredits: '100', resetsAt: '2026-11-02T00:00:00Z' },
] }
const noSubscription = { workspaceId, workspaceMemberId: 'member-1', eligible: false, tier: 'free', windows: [] }
const wallet = { billingScopeVersion: 2, workspaceId, workspaceMemberId: 'member-1', balanceUsd: '12.50' }
const json = value => Response.json(value)
const rejected = status => () => new Response('PRIVATE BODY ' + key, { status })

/** Route both endpoint reads through the injected fetch and assert the fixed request contract. */
const transport = routes => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(url)
    assert.ok(url.startsWith(base + '/'), 'only the fixed workspace billing endpoints are queried')
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error')
    assert.equal(init.headers.authorization, 'Bearer ' + key)
    assert.equal(init.headers['x-vela-workspace-id'], workspaceId)
    const handler = url.endsWith('/wallet/balance') ? routes.wallet
      // Issue #274: a rejected credential on the primary route falls back to the preflight route.
      : url.endsWith('/billing/preflight') ? routes.preflight ?? routes.usage
        : routes.usage
    return typeof handler === 'function' ? handler(url, init) : handler
  }
  return { calls, fetchImpl }
}
const query = (routes, locale = 'en') => queryOpenDesignQuota(key, locale, message, { workspaceId, fetchImpl: transport(routes).fetchImpl })

// 1. usage 401 + preflight 401 + wallet 200 -> no throw, wallet-only card, cause recorded as unauthorized.
{
  let usageAttempts = 0, preflightAttempts = 0
  const { calls, fetchImpl } = transport({
    usage: () => { usageAttempts++; return new Response('PRIVATE BODY ' + key, { status: 401 }) },
    preflight: () => { preflightAttempts++; return new Response('PRIVATE BODY ' + key, { status: 401 }) },
    wallet: json(wallet),
  })
  const result = await queryOpenDesignQuota(key, 'en', message, { workspaceId, fetchImpl })
  assert.deepEqual(result.windows, { balance: { text: '$12.50', resetsAt: '' } }, 'a usage 401 must not discard the readable wallet')
  assert.equal(result.endpoint, base + '/wallet/balance')
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.unauthorized })
  assert.equal(usageAttempts, 0, 'a rejected credential is not retried on the primary route')
  assert.equal(preflightAttempts, 1, 'the Cookie-free preflight fallback is attempted once')
  assert.equal(calls.length, 2, 'preflight and wallet are read independently')
  assert.equal(JSON.stringify(result).includes(key), false)
}

// 2. usage 200 + wallet 401 -> no throw, quota windows kept, wallet failure recorded.
{
  const result = await query({ usage: json(quota), wallet: rejected(401) })
  assert.equal(result.windows.fiveHour.percent, 25)
  assert.equal(result.windows.weekly.percent, 0)
  assert.equal(Object.hasOwn(result.windows, 'balance'), false, 'a failed wallet read is not fabricated as $0')
  assert.equal(result.endpoint, base + '/billing/preflight')
  assert.deepEqual(result.partial, { wallet: OPEN_DESIGN_QUOTA_FAILURES.unauthorized })
}

// 3. usage, preflight and wallet all rejected -> the whole query fails as a soft authorization
// error, classified, with the preflight fallback already exhausted.
{
  const { calls, fetchImpl } = transport({ usage: rejected(401), preflight: rejected(403), wallet: rejected(401) })
  await assert.rejects(queryOpenDesignQuota(key, 'en', message, { workspaceId, fetchImpl }), error => {
    assert.equal(error.soft, true)
    assert.equal(error.code, OPEN_DESIGN_QUOTA_FAILURES.unauthorized)
    assert.equal(error.opendesignPublic, true)
    assert.match(error.message, /codingPlanUnauthorized/)
    assert.equal(error.message.includes(key), false, 'upstream bodies and credentials stay out of the message')
    return true
  })
  assert.equal(calls.length, 2)
}

// 4. eligible:false (no subscription) + unreadable wallet -> a dedicated soft "no subscription" error,
// not the ambiguous "credentials invalid or no subscription" wording.
{
  const missingKey = (_, code) => code // simulates a message catalog without the new key
  for (const locale of ['en', 'zh']) {
    const error = await queryOpenDesignQuota(key, locale, missingKey, { workspaceId, fetchImpl: transport({ usage: json(noSubscription), wallet: rejected(401) }).fetchImpl })
      .then(() => null, value => value)
    assert.equal(error.soft, true)
    assert.equal(error.code, OPEN_DESIGN_QUOTA_FAILURES.noSubscription)
    assert.equal(error.message.includes(key), false)
    assert.match(error.message, locale === 'zh' ? /没有生效的套餐订阅/ : /no active plan subscription/i)
  }
  // A translated catalog entry replaces the built-in fallback verbatim.
  const translated = (_, code) => code === 'codingPlanNoSubscription' ? 'OpenDesign: subscription missing (catalog)' : 'OpenDesign: ' + code
  const error = await queryOpenDesignQuota(key, 'en', translated, { workspaceId, fetchImpl: transport({ usage: json(noSubscription), wallet: rejected(401) }).fetchImpl }).then(() => null, value => value)
  assert.equal(error.message, 'OpenDesign: subscription missing (catalog)')
  assert.equal(error.code, OPEN_DESIGN_QUOTA_FAILURES.noSubscription)
}

// 5. eligible:false + readable wallet -> still a partial success: the wallet is shown, the cause recorded.
{
  const result = await query({ usage: json(noSubscription), wallet: json(wallet) })
  assert.deepEqual(result.windows, { balance: { text: '$12.50', resetsAt: '' } })
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.noSubscription })
}

// 6. network failure on the usage endpoint + readable wallet -> wallet-only partial success, no credential leak.
{
  const result = await query({ usage: () => { throw Error('private transport ' + key) }, wallet: json(wallet) })
  assert.equal(result.windows.balance.text, '$12.50')
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.network })
  assert.equal(JSON.stringify(result).includes(key), false)
}

// 7. invalid usage response (wrong workspace) + readable wallet -> wallet-only partial success.
{
  const result = await query({ usage: json({ ...quota, workspaceId: 'different' }), wallet: json(wallet) })
  assert.equal(result.windows.balance.text, '$12.50')
  assert.deepEqual(result.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.invalidResponse })
}

// 8. non-auth HTTP failure on the wallet endpoint -> quota windows preserved.
{
  const result = await query({ usage: json(quota), wallet: () => new Response('upstream error', { status: 500 }) })
  assert.equal(result.windows.weekly.percent, 0)
  assert.deepEqual(result.partial, { wallet: OPEN_DESIGN_QUOTA_FAILURES.http })
}

// 9. both bodies unreadable -> hard invalid-response error built from the public catalog text, no body leak.
{
  const error = await query({ usage: () => new Response('<html>' + key), wallet: () => new Response('<html>' + key) }).then(() => null, value => value)
  assert.equal(error.soft, undefined)
  assert.equal(error.code, OPEN_DESIGN_QUOTA_FAILURES.invalidResponse)
  assert.match(error.message, /codingPlanInvalidJson/)
  assert.equal(error.message.includes(key), false)
}

// 10. both successful but different member identities -> rejected, matching the existing contract.
{
  const error = await query({ usage: json(quota), wallet: json({ ...wallet, workspaceMemberId: 'other' }) }).then(() => null, value => value)
  assert.equal(error.soft, undefined)
  assert.equal(error.code, OPEN_DESIGN_QUOTA_FAILURES.identityMismatch)
  assert.match(error.message, /identities/)
}

// 11. missing workspace ID stays a soft configuration error that never opens a connection.
{
  let requests = 0
  const fetchImpl = async () => { requests++; throw Error('no request expected') }
  await assert.rejects(queryOpenDesignQuota(key, 'en', message, { workspaceId: '', fetchImpl }), { soft: true, code: OPEN_DESIGN_QUOTA_FAILURES.invalidRequest })
  assert.equal(requests, 0)
}

// 12. the registered adapter must let the partial answer reach the card refresh, and log the cause
// through the existing onAttempt hook (the caller stores result.windows as soon as this resolves).
{
  const previousFetch = globalThis.fetch
  const attempts = []
  try {
    globalThis.fetch = transport({ usage: rejected(401), wallet: json(wallet) }).fetchImpl
    const routed = await queryCodingPlan('opendesign', key, 'en', message, {
      workspaceId, onAttempt: attempt => { attempts.push(attempt) },
    })
    assert.equal(routed.windows.balance.text, '$12.50')
    assert.deepEqual(routed.partial, { usage: OPEN_DESIGN_QUOTA_FAILURES.unauthorized })
    assert.equal(attempts.length, 1)
    assert.equal(attempts[0].stage, 'partial')
    assert.equal(attempts[0].provider, 'opendesign')
    assert.equal(attempts[0].code, 'usage:' + OPEN_DESIGN_QUOTA_FAILURES.unauthorized)
    assert.equal(JSON.stringify(attempts).includes(key), false)
  } finally { globalThis.fetch = previousFetch }
}

console.log('[ok] OpenDesign quota degradation: independent usage/wallet reads, partial cards, and classified auth/no-subscription/invalid/network failures; no live account or network requests')
