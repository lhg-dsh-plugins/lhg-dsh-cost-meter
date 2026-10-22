import assert from 'node:assert/strict'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { createPiAiCodexQuota, parsePiAiCodexQuota } from '../lib/pi-ai-codex-quota.js'
import { piAiCodexQuotaSchema } from '../lib/typert.host.js'

const weekly = { primary_window: { used_percent: 17, limit_window_seconds: 604800, reset_at: 1792887000 } }
const payload = { rate_limit: weekly }
assert.deepEqual(parsePiAiCodexQuota(payload), { weekly: { percent: 17, resetsAt: '2026-10-25T00:10:00.000Z' } })
assert.equal(parsePiAiCodexQuota({ rate_limit: { primary_window: { ...weekly.primary_window, used_percent: 101 } } }), null)
assert.equal(parsePiAiCodexQuota({ rate_limit: { primary_window: { ...weekly.primary_window, limit_window_seconds: 99 } } }), null)
const dual = parsePiAiCodexQuota({ rate_limit: { ...weekly, secondary_window: { used_percent: 42, limit_window_seconds: 18000, reset_after_seconds: 600 } },
  additional_rate_limits: [{ rate_limit: { primary_window: { ...weekly.primary_window, used_percent: 99 } } }] }, 0)
assert.equal(dual.five.resetsAt, '1970-01-01T00:10:00.000Z'); assert.equal(dual.weekly.percent, 17)
const secret = 'PI_AI_SYNTHETIC_ACCESS', refresh = 'PI_AI_SYNTHETIC_REFRESH'
let grant = { kind: 'grant', payload: { type: 'oauth', access: secret, refresh, expires: Date.now() + 60000, accountId: 'synthetic-account' } }
let reads = 0, calls = 0, mode = 'ok', enabled = true
const quota = createPiAiCodexQuota({ get: () => ({ readRecord: async key => {
  assert.deepEqual(key, credentialKey('llm-pi-ai', 'openai-codex')); reads++; return grant
} }) }, { enabled: () => enabled, fetchImpl: async (url, init) => {
  calls++; assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage'); assert.equal(init.redirect, 'error')
  assert.equal(init.headers.authorization, 'Bearer ' + grant.payload.access)
  assert.equal(init.headers['ChatGPT-Account-Id'], 'synthetic-account'); assert.ok(!JSON.stringify(init).includes(refresh))
  if (mode === '401') return Response.json({ error: secret }, { status: 401 })
  if (mode === 'broken') throw Error(secret)
  if (mode === 'large') return new Response('x'.repeat(262145))
  return Response.json(payload)
} })
const a = quota.read(), b = quota.read()
assert.equal(a, b, 'concurrent positions share a query')
const first = await a
assert.equal(first.status, 'ok'); assert.deepEqual(piAiCodexQuotaSchema.parse(first), first, 'Pro weekly-only survives the strict RPC schema')
assert.equal(calls, 1); assert.equal(reads, 1)
grant = { ...grant, payload: { ...grant.payload, access: secret + '_ROTATED' } }
assert.equal((await quota.read()).status, 'ok', 'a host token rotation is seen without restart')
for (mode of ['401', 'broken', 'large']) {
  const result = await quota.read(); assert.equal(result.status, 'error'); assert.ok(!JSON.stringify(result).includes(secret))
}
const before = calls
grant.payload.expires = 1
assert.equal((await quota.read()).status, 'error'); assert.equal(calls, before, 'expired grants are never sent')
grant = undefined
assert.equal((await quota.read()).status, 'off'); assert.equal(calls, before)
enabled = false
const oldReads = reads
assert.equal((await quota.read()).status, 'off'); assert.equal(reads, oldReads)
quota.dispose()
assert.equal((await quota.read()).status, 'off')
assert.equal((await createPiAiCodexQuota({ get() {} }).read()).status, 'off', 'older hosts retain other quota sources')

// Hold a real event-loop handle because AbortSignal.timeout intentionally does not.
const keepAlive = setInterval(() => {}, 1000)
try {
  let release, lateFetches = 0
  const stalled = createPiAiCodexQuota({ get: () => ({ readRecord: () => new Promise(r => { release = r }) }) },
    { timeoutMs: 25, fetchImpl: async () => { lateFetches++; return Response.json(payload) } })
  assert.equal((await stalled.read()).status, 'error', 'a stalled credential provider times out')
  release({ kind: 'grant', payload: { type: 'oauth', access: secret } })
  await new Promise(r => setTimeout(r, 0)); assert.equal(lateFetches, 0)
  const hanging = createPiAiCodexQuota({ get: () => ({ readRecord: async () => ({ kind: 'grant', payload: { type: 'oauth', access: secret } }) }) },
    { fetchImpl: () => new Promise(() => {}) })
  const pending = hanging.read(); await new Promise(r => setTimeout(r, 0)); hanging.dispose()
  assert.equal((await pending).status, 'error', 'unload settles even if the transport ignores cancellation')
  assert.equal((await hanging.read()).status, 'off')
} finally { clearInterval(keepAlive) }
console.log('[ok] native pi-ai Codex: OAuth record, rotation, dedupe, weekly-only codec, fixed read-only URL, timeout/unload and safe errors; no external requests')
