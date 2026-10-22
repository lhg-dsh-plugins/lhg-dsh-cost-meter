// Run the published quota parser and authenticated RPC carrier against local data.
// Upstream initialization, OAuth, credentials and model requests are never invoked.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { parse } from 'acorn'

const archive = process.env.DSH_TEST_CODEX_PACKAGE
assert.ok(archive, 'provide the exact published npm archive')
const read = path => execFileSync('tar', ['-xOf', archive, 'package/' + path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const pkg = JSON.parse(read('package.json'))
assert.equal(pkg.name, 'dsh-codex-subscription')
const source = read(pkg.main.replace(/^\.\//, ''))
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
const declarations = ast.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node).filter(Boolean)
const functions = declarations.filter(node => node.type === 'FunctionDeclaration').map(node => source.slice(node.start, node.end)).join('\n')
const constants = ['record$4', 'RPC_ENDPOINTS', 'REQUEST_BLOCKED', 'publicError'].map(name => {
  const declaration = declarations.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations).find(node => node.id.name === name)
  assert.ok(declaration, 'upstream constant ' + name)
  return 'const ' + source.slice(declaration.start, declaration.end) + ';'
}).join('\n')
const requireHost = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__codex_published.cjs'))
const { clientRequestSchema } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-client-connection')).href)
const upstream = vm.runInNewContext(constants + '\n' + functions + '\n({parseCodexUsage,createSubscriptionRpcHandler,registerSubscriptionTransport})',
  { Response, Request, clientRequestSchema, Error })

const ownSource = readFileSync(new URL('../src/client/02-validators-helpers-sidebar.js', import.meta.url), 'utf8')
const ownFunction = name => {
  const start = ownSource.search(new RegExp('    (?:async )?function ' + name + '\\('))
  assert.ok(start >= 0)
  const rest = ownSource.slice(start)
  const node = parse(rest, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }).body[0]
  return rest.slice(node.start, node.end)
}
const routes = new Map(), reads = [], signal = new AbortController().signal
let payload
const handler = upstream.createSubscriptionRpcHandler({ usageReader: { read: async options => {
  reads.push(options.force)
  if (payload instanceof Error) throw payload
  return upstream.parseCodexUsage(payload, 1792341000000)
} } })
const dispose = upstream.registerSubscriptionTransport({ fetch: { register: route => {
  routes.set(route.path, route)
  return () => routes.delete(route.path)
} } }, handler)
const rpc = { call: async (base, method, args, requestSignal) => {
  assert.equal(base, '/api'); assert.equal(method, 'codex-subscription/usage')
  const route = routes.get(base + '/' + method)
  assert.deepEqual(Array.from(route.methods), ['POST'])
  const response = await route.fetch(new Request('http://127.0.0.1' + base + '/' + method, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: requestSignal,
    body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload: args }),
  }))
  assert.equal(response.status, 200)
  return (await response.json()).result
} }
const client = vm.runInNewContext('const CODEX_WINDOWS={18000:"five",604800:"weekly"};const codexQuotaCache={rpc};\n' + ownFunction('parseCodexWindows') + '\n' + ownFunction('boundedCodexRead') + '\n' + ownFunction('fetchCodexSubscription') + '\n({fetchCodexSubscription})', { rpc, AbortSignal })
const plain = value => JSON.parse(JSON.stringify(value))
try {
  payload = { plan_type: 'pro', rate_limit: { primary_window: { used_percent: 17, limit_window_seconds: 604800, reset_at: 1792887000 } } }
  assert.deepEqual(plain(await client.fetchCodexSubscription(false)), { weekly: { percent: 17, resetsAt: new Date(1792887000000).toISOString() } }, 'Pro weekly-only quota never invents a 5h window')
  payload = { rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 18000, reset_after_seconds: 600 }, secondary_window: { used_percent: 17, limit_window_seconds: 604800 } },
    additional_rate_limits: [{ metered_feature: 'other_model', rate_limit: { primary_window: { used_percent: 99, limit_window_seconds: 604800 } } }] }
  const both = plain(await client.fetchCodexSubscription(true))
  assert.equal(both.five.percent, 42); assert.equal(both.weekly.percent, 17)
  assert.equal(both.five.resetsAt, new Date(1792341600000).toISOString())
  assert.deepEqual(reads, [false, true], 'manual refresh reaches the published RPC handler')
  payload = new Error('ChatGPT subscription is not signed in')
  assert.equal(await client.fetchCodexSubscription(false), null, 'upstream errors permit the existing auto fallback')
  payload = { rate_limit: { primary_window: { used_percent: 101, limit_window_seconds: 604800 } } }
  assert.equal(await client.fetchCodexSubscription(false), null, 'invalid usage is not displayed as free quota')
  assert.ok((await handler('usage', { force: false }, signal)).ok === false)
} finally { dispose() }
assert.equal(routes.size, 0)
console.log(JSON.stringify({ check: 'published Codex subscription RPC and quota', version: pkg.version, weeklyOnly: true, dualWindow: true, forceRefresh: true, failureFallback: true, externalRequests: 0 }))
