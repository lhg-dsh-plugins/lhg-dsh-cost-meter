import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { installBillionContextBilling } from '../lib/billion-context-billing.js'
import { meterBillionRequest, beginBillionCall, meterBillionResponse } from '../lib/billion-context-proxy.js'

const root = fs.mkdtempSync(join(tmpdir(), 'cm-billion-receipt-')), previousHome = process.env.DSH_HOME
process.env.DSH_HOME = root
const effects = [], rename = fs.renameSync
const ledger = new Ledger(sanitizeConfig({ peakEnabled: false, prices: { providers: { fixture: { models: { main: { cacheMiss: 2, output: 8 } } } } } }), {}, join(root, 'storages/cost-meter/ledger.json'))
const bridge = installBillionContextBilling({ effect: fn => effects.push(fn()), on() {}, get() {} }, ledger)
let release, pending, denied = 0
try {
  const scope = bridge.createScope({ sessionId: 'receipt-retry', provider: 'fixture', model: 'main' }, Date.now())
  const id = scope.run(() => bridge.begin('http://127.0.0.1:12345/bili/https://example.invalid/v1/chat/completions'))
  const response = new EventEmitter(); response.setHeader = () => {}
  fs.renameSync = function (from, to) {
    if (String(to).endsWith('.status.json') && denied < 2) { denied++; throw Object.assign(Error('simulated Windows sharing conflict'), { code: 'EPERM' }) }
    return rename(from, to)
  }
  syncBuiltinESMExports()
  const persistedLater = new Promise(resolve => { release = resolve })
  let respond
  const responded = new Promise(resolve => { respond = resolve })
  pending = meterBillionRequest({ method: 'POST', headers: { 'x-dsh-cost-meter-group': id } }, response, async () => {
    const call = beginBillionCall('https://example.invalid/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'main' }) })
    await meterBillionResponse(call, new Response(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 20 } }), { headers: { 'content-type': 'application/json' } })).text()
    response.emit('finish'); respond()
    await persistedLater
  })
  bridge.ack(id, true)
  await responded
  assert.equal(await scope.finish({ inputTokens: 100, outputTokens: 20 }), true, 'transient receipt locks do not force host fallback while post-response persistence is pending')
  assert.equal(denied, 2)
  assert.equal(ledger.sumDays().calls, 1)
  const total = ledger.sumDays().cost
  assert.ok(total > 0)
  const status = JSON.parse(fs.readFileSync(join(ledger.path + '.billion-context/groups', id + '.status.json'), 'utf8'))
  assert.equal(status.complete, true); assert.equal(status.failed, false)
  release(); await pending; await bridge.ingest()
  assert.equal(ledger.sumDays().cost, total)
  console.log('[ok] billion-context receipts: Windows sharing conflict retries, response completion before persistence, exactly-once billing')
} finally {
  release?.(); await pending
  fs.renameSync = rename; syncBuiltinESMExports()
  for (const dispose of effects) dispose?.()
  ledger.close()
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  fs.rmSync(root, { recursive: true, force: true })
}
