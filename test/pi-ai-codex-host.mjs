// Real Cordis loader/credentials/RPC, isolated profile and synthetic OAuth only.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import childProcess from 'node:child_process'

const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__pi_ai_reload.cjs'))
const repo = fileURLToPath(new URL('../', import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'cm-pi-ai-reload-')), savedHome = process.env.DSH_HOME, realFetch = globalThis.fetch
const originalSpawn = childProcess.ChildProcess.prototype.spawn, errors = [], timings = [], calls = []
const imp = name => import(pathToFileURL(req.resolve(name)).href)
let host, peer, mode = 'ok', started, testError
const bounded = async (label, action) => {
  let timer
  const start = performance.now()
  try { return await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' did not finish')), 2000) })]) }
  finally { clearTimeout(timer); timings.push({ label, milliseconds: performance.now() - start }) }
}
try {
  process.env.DSH_HOME = work
  writeFileSync(join(work, 'package.json'), '{"type":"module"}')
  const storage = join(work, 'storages', 'cost-meter'); mkdirSync(storage, { recursive: true })
  writeFileSync(join(storage, 'ledger.json'), JSON.stringify({ version: 1, days: {}, config: { locale: 'en', codexQuotaEnabled: true, balance: { display: 'off' }, goQuota: { enabled: false } } }))
  const { Context } = await imp('@deepseek-ai/cordis')
  const { default: Loader } = await imp('@deepseek-ai/cordis-plugin-loader')
  const { default: Registry } = await imp('@deepseek-ai/dsh-typert-registry')
  const TypertLoader = await imp('@deepseek-ai/dsh-typert-loader')
  const { default: Gateway } = await imp('@deepseek-ai/dsh-api-gateway')
  const { default: Credentials } = await imp('@deepseek-ai/dsh-credentials-local')
  const { credentialKey } = await imp('@deepseek-ai/dsh-credentials')
  const RemoteAccess = Gateway.inject?.includes('remoteAccess') ? (await imp('@deepseek-ai/dsh-api-remote-access')).default : null
  const anchor = pathToFileURL(join(work, 'package.json')).href
  host = new Context(); host.baseUrl = anchor
  host.logger = { error: e => errors.push(String(e)), warn() {}, info() {} }
  const lifetime = new AbortController()
  peer = { id: 'cm-pi-ai-owner', ctx: host, principal: { kind: 'owner' }, signal: lifetime.signal, interactions: 'none', dispose: async () => lifetime.abort() }
  const invoke = () => host.typertGateway.invoke({ namespace: 'costMeter', method: 'getPiAiCodexQuota', args: {}, ...(RemoteAccess ? { peer } : {}) })
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage')
    calls.push(init.headers.authorization)
    if (mode === 'pending') { started(); return new Promise(() => {}) }
    return Response.json({ rate_limit: { primary_window: { used_percent: 17, limit_window_seconds: 604800, reset_at: 1792887000 } } })
  }
  await host.plugin(Loader, { baseUrl: anchor }).await()
  await host.plugin(Registry).await(); await host.plugin(TypertLoader, { packages: [] }).await()
  await host.plugin(Credentials, { path: join(work, 'credentials.yaml'), watch: false }).await()
  if (RemoteAccess) await host.plugin(RemoteAccess).await()
  await host.plugin(Gateway, {}).await()
  await host.credentials.modifyRecord(credentialKey('llm-pi-ai', 'openai-codex'), () => ({ kind: 'grant', payload: { type: 'oauth', access: 'SYNTHETIC_PI_AI_ACCESS', refresh: 'SYNTHETIC_REFRESH', expires: Date.now() + 60000 } }))
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json')))
  for (let cycle = 0; cycle < 3; cycle++) {
    // Cold boot uses package.main; external developer tools often load index.js.
    const entry = pathToFileURL(join(repo, cycle === 0 ? pkg.main : 'lib/index.js')).href
    await bounded('load ' + cycle, async () => { await host.loader.root.update([{ id: 'cost-meter', name: entry }]); await host.loader.await() })
    assert.ok(host.get('costMeter'))
    if (cycle === 0 && process.env.DSH_TEST_INJECTOR_SOURCE) {
      const { checkInjectorReload } = await import('./injector-reload-check.mjs')
      await checkInjectorReload(host, repo, work, bounded)
    }
    const result = await bounded('native quota ' + cycle, invoke)
    assert.equal(result.status, 'ok'); assert.equal(result.windows.weekly.percent, 17); assert.equal(result.windows.five, undefined)
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_'))
    const currentService = host.get('costMeter')
    const ready = new Promise(resolve => { started = resolve }); mode = 'pending'
    const pending = currentService.getPiAiCodexQuota()
    await ready
    await bounded('unload during pending query ' + cycle, async () => { await host.loader.root.update([]); await host.loader.await() })
    assert.equal(host.get('costMeter'), undefined)
    assert.equal((await bounded('cancel old query ' + cycle, () => pending)).status, 'error')
    assert.equal((await currentService.getPiAiCodexQuota()).status, 'off', 'disposed service cannot start new work')
    assert.equal(childProcess.ChildProcess.prototype.spawn, originalSpawn, 'unload restores the billion-context observer')
    assert.ok(!readFileSync(join(storage, 'ledger.json'), 'utf8').includes('SYNTHETIC_'))
    mode = 'ok'
  }
  // A hot upgrade may retain the previous version's manifest until restart.
  const { TYPERT } = await import('../lib/typert.host.js')
  host.typert.register({ ...TYPERT, invocations: TYPERT.invocations.filter(row => row.method !== 'getPiAiCodexQuota') })
  const oldManifest = host.typert.getPackage('dsh-cost-meter', 'host')
  await host.loader.root.update([{ id: 'cost-meter', name: pathToFileURL(join(repo, pkg.main)).href }]); await host.loader.await()
  assert.equal((await bounded('native quota with cached old manifest', invoke)).status, 'ok')
  assert.equal(host.typert.getPackage('dsh-cost-meter', 'host'), oldManifest, 'hot upgrade preserves the previous manifest owner')
  await host.loader.root.update([]); await host.loader.await()
  assert.equal(host.typert.getPackage('dsh-cost-meter', 'host'), oldManifest)
  assert.equal(host.typert.local.get('costMeter/getPiAiCodexQuota'), undefined, 'unload removes the compatibility invocation')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ check: 'real DSH pi-ai quota and hot reload', host: req('@deepseek-ai/dsh/package.json').version, cycles: 3, timings, fixtureReads: calls.length, externalRequests: 0 }))
} catch (error) { testError = error; throw error } finally {
  await peer?.dispose(); await host?.fiber.dispose()
  globalThis.fetch = realFetch
  savedHome === undefined ? delete process.env.DSH_HOME : process.env.DSH_HOME = savedHome
  assert.equal(dirname(work), tmpdir())
  try { await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  catch (error) { if (testError) console.error('Fixture cleanup failed:', error.code); else throw error }
}
