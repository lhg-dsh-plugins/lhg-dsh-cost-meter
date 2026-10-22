// Real Desktop Connection Fetch carrier + Gateway + Registry, with an isolated
// local ledger. No Codex credentials, model requests, or real user data.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { TYPERT } from '../lib/typert.host.js'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { apply } from '../lib/index.js'

const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__codex_http.cjs'))
const imp = name => import(pathToFileURL(req.resolve(name)).href)
const { Context } = await imp('@deepseek-ai/cordis')
const { default: Registry } = await imp('@deepseek-ai/dsh-typert-registry')
const { default: Gateway } = await imp('@deepseek-ai/dsh-api-gateway')
const { HostConnectionService } = await imp('@deepseek-ai/dsh-client-connection')
assert.equal(typeof HostConnectionService, 'function', 'use a Desktop 0.2.1 runtime with the Fetch carrier')
const work = mkdtempSync(join(tmpdir(), 'cm-codex-http-')), oldHome = process.env.DSH_HOME
process.env.DSH_HOME = work
const methods = ['applyCodexCompatHistory', 'dismissCodexCompat']
let server
try {
  const pkg = join(work, 'profiles/default/node_modules/dsh-codex-subscription')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-codex-subscription', version: '3.0.0' }))
  for (const missing of [methods, methods.slice(0, 1), []]) {
    const storage = join(work, 'storages/cost-meter')
    mkdirSync(storage, { recursive: true })
    const seed = new Ledger(sanitizeConfig({ hideOfficialBalance: true, goQuota: { enabled: false } }), {}, join(storage, 'ledger.json'))
    seed.scheduleWrite(); seed.close()
    const host = new Context()
    const lifetime = new AbortController()
    const peer = { id: 'codex-http-fixture', ctx: host, principal: { kind: 'owner' }, signal: lifetime.signal, interactions: 'none' }
    const errors = []
    host.logger = { error: error => errors.push(error), warn() {}, info() {} }
    try {
      await host.plugin(Registry).await()
      const subscription = host.plugin({ name: 'codex-subscription', apply() {} })
      await subscription.await()
      host.typert.register({ ...TYPERT, invocations: TYPERT.invocations.filter(def => !missing.includes(def.method)) })
      const original = host.typert.getPackage('dsh-cost-meter')
      // Fixture identity only: the production authentication policy is unchanged.
      const connection = new HostConnectionService(host, [], { isAuthenticated: () => true })
      if (Gateway.inject?.includes('remoteAccess')) await host.plugin((await imp('@deepseek-ai/dsh-api-remote-access')).default).await()
      await host.plugin(Gateway, {}).await()
      const carrier = connection.createSharedFetchHandler('/api')
      server = createServer(async (request, response) => {
        try {
          const body = []
          for await (const part of request) body.push(part)
          const result = await carrier.fetch(new Request('http://127.0.0.1' + request.url, {
            method: request.method, headers: request.headers, body: Buffer.concat(body),
          }), peer)
          response.writeHead(result.status, Object.fromEntries(result.headers))
          response.end(Buffer.from(await result.arrayBuffer()))
        } catch (error) {
          console.error(error)
          response.writeHead(500)
          response.end('Test fixture request failed')
        }
      })
      await new Promise(done => server.listen(0, '127.0.0.1', done))
      const rpc = async method => {
        const endpoint = 'costMeter/' + method
        return fetch(`http://127.0.0.1:${server.address().port}/api/${endpoint}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: 'codex-http-test', method: endpoint, payload: { args: {} } }),
        })
      }
      for (const method of missing) assert.equal((await rpc(method)).status, 404, 'old cached manifest reproduces reported HTTP 404')
      const plugin = host.plugin({ name: 'codex-http-fixture', apply })
      await plugin.await()
      for (const method of methods) {
        const response = await rpc(method)
        assert.equal(response.status, 200, `${method}: HTTP route is registered`)
        const result = (await response.json()).result
        assert.equal(result.ok, true, JSON.stringify(result.error))
        assert.equal(result.value.codexCompat.installed, true, 'installed without any API configuration')
        assert.equal(result.value.codexCompat.promptDue, false)
        if (method === methods[0]) assert.ok(result.value.codexCompat.historyAppliedAt > 0)
        else assert.equal(result.value.codexCompat.promptDismissed, true)
      }
      await subscription.dispose()
      const disabled = await host.costMeter.getLocalState()
      assert.equal(disabled.codexCompat.installed, true, 'package remains installed')
      assert.equal(disabled.codexCompat.enabled, false, 'stopping the actual peer runtime hides its settings')
      assert.equal(disabled.codexCompat.promptDue, false, 'stopped peers never prompt')
      await plugin.dispose()
      assert.equal(host.typert.getPackage('dsh-cost-meter'), original, 'does not replace the host-owned base manifest')
      assert.equal(host.typert.getPackage('dsh-cost-meter-codex-compat'), undefined, 'supplementary routes belong to the plugin lifetime')
      for (const method of missing) assert.equal(host.typert.local.get('costMeter/' + method), undefined)
      assert.deepEqual(errors, [])
    } finally {
      if (server?.listening) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
      await host.fiber.dispose()
      lifetime.abort()
    }
  }
  console.log('[ok] Codex HTTP: old manifest reproduces 404; both/one/no missing routes repaired; unconfigured subscription works; unload keeps base manifest')
} finally {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
