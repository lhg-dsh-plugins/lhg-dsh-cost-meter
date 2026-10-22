import assert from 'node:assert/strict'
import { contextActivity } from '../lib/context-activity.js'
import { createLlmStreamBilling } from '../lib/billing-stream.js'
import { getContextCosts } from '../lib/context-costs.js'
import { sanitizeConfig } from '../lib/store.js'
let measures = 0, scans = 0
const config = sanitizeConfig({}), measurement = { totalTokens: 10, surfaceTokens: 10, nodes: [] }
const session = { snapshotEvents: () => { scans++; return [] }, requestHeader: () => ({ config: { provider: 'deepseek', model: 'deepseek-v4-flash' } }) }
const ctx = { get: name => name === 'sessions' ? { get: () => session } : name === 'tokenMeter' ? { measure: () => { measures++; return measurement } } : null }
const activity = contextActivity(ctx), values = [{ type: 'text', text: 'same identity' }, { type: 'usage', usage: { inputTokens: 1 } }]
const accounted = [], wrap = createLlmStreamBilling({ activity, account: (...args) => accounted.push(args) })
const read = () => getContextCosts({ config }, ctx, { sessionId: 'one' })
const first = wrap({ sessionId: 'one' }, () => (async function* () { yield* values })())[Symbol.asyncIterator]()
assert.equal(activity.busy('one'), false, 'unconsumed streams have no lifetime')
assert.equal((await first.next()).value, values[0]); assert.equal(activity.busy('one'), true)
for (let i=0;i<100;i++) assert.equal(read().status, 'busy')
assert.equal(measures, 0); assert.equal(scans, 0)
assert.equal((await first.next()).value, values[1]); await first.next()
assert.equal(activity.busy('one'), false); assert.equal(accounted.length, 1)
const saved = read(); assert.equal(saved.status, 'ready'); assert.equal(measures, 1)
const second = wrap({ sessionId: 'one' }, () => (async function* () { yield values[0] })())[Symbol.asyncIterator]()
await second.next(); assert.equal(read(), saved); assert.equal(measures, 1); await second.return(); assert.equal(activity.busy('one'), false)
const release1 = activity.enter('one'), release2 = activity.enter('one'); release1(); release1(); assert.equal(activity.busy('one'), true); release2(); assert.equal(activity.busy('one'), false)
const release = activity.enter('other'); read(); assert.equal(measures, 2); release()
const error = new TypeError('secret prompt or token must not be logged'), warnings = [], warn = console.warn
console.warn = message => warnings.push(message)
try {
 const failed = wrap({ sessionId: 'one' }, () => (async function* () { throw error })())
 await assert.rejects(async () => { for await (const chunk of failed) void chunk }, actual => actual === error)
 assert.equal(activity.busy('one'), false); assert.equal(warnings.length, 1); assert.ok(!warnings[0].includes('secret'))
} finally { console.warn = warn }
const changed = { ...config }; const leave = activity.enter('one'); assert.equal(getContextCosts({ config: changed }, ctx, { sessionId: 'one' }).status, 'busy'); leave()
console.log('[ok] #279: no measurement/history scan while streaming, cached view, concurrent lifetimes, exact chunks/errors and cleanup')
