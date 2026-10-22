// Run the published connector's real route with synthetic account/billing dependencies.
// No plugin apply(), desktop credentials, model probes, check-in or external requests.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { queryCodingPlan } from '../lib/coding-plans.js'

const root = resolve(process.env.DSH_TEST_CONNECT_WORKBUDDY_DIR ?? '.tmp-connect-workbuddy-published/package')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assert.equal(pkg.name, 'dsh-connect-workbuddy')
assert.ok(['4.13.1', '4.14.1'].includes(pkg.version))
const host = resolve(process.env.DSH_TEST_NODE_MODULES ?? '.tmp-context-host/node_modules')
const temp = mkdtempSync(join(tmpdir(), 'cm-connect-workbuddy-'))
const originalFetch = globalThis.fetch
globalThis.fetch = (url, init) => {
  const target = new URL(url)
  assert.ok(target.protocol === 'http:' && target.hostname === '127.0.0.1', 'only the isolated local host may be queried')
  return originalFetch(url, init)
}
let server
try {
  const built = await build({ stdin: { contents: 'export { registerWorkBuddyStatusRoute } from ' + JSON.stringify(join(root, 'lib/index.js')), resolveDir: process.cwd() },
    bundle: true, format: 'esm', platform: 'node', write: false, plugins: [{ name: 'host-peers', setup(builder) {
      builder.onResolve({ filter: /^@/ }, async args => {
        if (args.pluginData?.hostPeer) return
        const result = await builder.resolve(args.path, { kind: 'import-statement', resolveDir: host, pluginData: { hostPeer: true } })
        return result.errors.length ? { errors: result.errors } : { path: pathToFileURL(result.path).href, external: true }
      })
    } }] })
  const path = join(temp, 'connector.mjs'); writeFileSync(path, built.outputFiles[0].contents)
  const { registerWorkBuddyStatusRoute } = await import(pathToFileURL(path).href)
  let region = 'cn', rejected = false, balance = 125.5
  const routes = new Map(), requests = [], measured = []
  const credential = { accessToken: 'SYNTHETIC_NOT_FOR_FORWARDING', refreshToken: 'SYNTHETIC_NOT_FOR_FORWARDING', expiresAtMs: Date.now() + 3600000, domain: '', nickname: 'NOT_FOR_FORWARDING' }
  const deps = {
    store: target => ({ accounts: async () => target === region ? [{ id: 'synthetic-account', selected: true }] : [],
      status: async () => ({ state: target === region ? 'signed-in' : 'signed-out' }),
      resolve: async () => { if (target !== region) throw Error('No sign-in'); return credential },
      credentialFor: async () => credential, hasExplicitSelection: () => false, selectionLost: async () => false }),
    client: { fetchCredits: async value => { assert.equal(value, credential); measured.push(region); if (rejected) throw Error('SYNTHETIC_BILLING_FAILURE'); return { total: balance, packages: [], expiringSoon: 0, nearestExpiryMs: Date.parse('2030-01-01T00:00:00Z') } },
      fetchCheckinStatus: async () => ({ todayCheckedIn: true }) },
    displayModels: () => [], enabledModelIds: () => [], imageModelIds: () => [], offModelIds: () => [], contextBudgets: () => ({}), regionEnabled: () => true,
  }
  registerWorkBuddyStatusRoute({ effect: fn => fn(), webServer: { register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path) } } }, deps)
  server = createServer((req, res) => {
    requests.push({ path: req.url, method: req.method, authorization: req.headers.authorization })
    const handler = routes.get(new URL(req.url, 'http://localhost').pathname)
    if (!handler) { res.writeHead(404); res.end('{}'); return }
    Promise.resolve(handler(req, res)).catch(error => { res.writeHead(500); res.end(JSON.stringify({ error: error.message })) })
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const key = { hostOrigin: 'http://127.0.0.1:' + server.address().port, readFile: () => assert.fail('must not read local credentials') }
  const text = (_, code) => code
  for (const target of ['cn', 'global']) {
    region = target
    const result = await queryCodingPlan('workbuddy', key, 'en', text)
    assert.equal(result.windows.balance.text, '126', 'use the existing WorkBuddy balance formatter')
    if (!result.workbuddy) {
      assert.equal(result.windows.cycleReset.resetsAt, '2030-01-01T00:00:00.000Z')
      assert.ok(result.endpoint.endsWith('?region=' + target))
    } else assert.equal(result.workbuddy.accounts[0].region, target)
    assert.ok(!JSON.stringify(result).includes('NOT_FOR_FORWARDING'))
  }
  balance = 0
  assert.equal((await queryCodingPlan('workbuddy', key, 'en', text)).windows.balance.text, '0')
  rejected = true
  if (routes.has('/plugins/dsh-connect-workbuddy/account-credits')) assert.equal((await queryCodingPlan('workbuddy', key, 'en', text)).workbuddy.unknownCount, 1)
  else await assert.rejects(queryCodingPlan('workbuddy', key, 'en', text), e => e.soft && e.message === 'workbuddyConnectCreditsFailed')
  assert.deepEqual(measured, ['cn', 'global', 'global', 'global'])
  assert.ok(requests.every(row => row.method === 'GET' && row.authorization === undefined))
  assert.ok(requests.every(row => /\/(status|usage|account-credits)(\?|$)/.test(row.path)), 'never invoke mutation, model-probe or account-pool routes')
  console.log('[ok] published dsh-connect-workbuddy ' + pkg.version + ': actual CN/global account or usage routes, selected-account credits, zero, failure and no credential forwarding')
} finally {
  globalThis.fetch = originalFetch
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
  rmSync(temp, { recursive: true, force: true })
}
