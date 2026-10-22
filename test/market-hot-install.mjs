// #154: dshmarket 1.47 mounts an independent Include with a resolved file URL.
// Exercise real Cordis, typert-loader/registry and gateway, plus the actual plugin.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, rmdirSync, unlinkSync, lstatSync, utimesSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TYPERT } from '../lib/typert.host.js'

assert.ok(process.env.DSH_TEST_NODE_MODULES, 'set DSH_TEST_NODE_MODULES to installed DSH dependencies')
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__market_test.cjs'))
const imp = name => import(pathToFileURL(req.resolve(name)).href)
const { Context } = await imp('@deepseek-ai/cordis')
const { default: Loader } = await imp('@deepseek-ai/cordis-plugin-loader')
const { default: Include } = await imp('@deepseek-ai/cordis-plugin-include')
const { default: Registry } = await imp('@deepseek-ai/dsh-typert-registry')
const TypertLoader = await imp('@deepseek-ai/dsh-typert-loader')
const { default: Gateway } = await imp('@deepseek-ai/dsh-api-gateway')
// New hosts require explicit Remote access and caller identity. Older gateways
// keep their original invocation shape; no production permission policy changes.
const RemoteAccess = Gateway.inject?.includes('remoteAccess') ? (await imp('@deepseek-ai/dsh-api-remote-access')).default : null
const root = fileURLToPath(new URL('../', import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'cm-market-'))
const oldHome = process.env.DSH_HOME
process.env.DSH_HOME = work
const settle = async predicate => {
  for (let n = 0; n < 100 && !predicate(); n++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(predicate(), 'host registration/lifecycle must settle')
}
try {
  mkdirSync(join(work, 'node_modules'))
  symlinkSync(root, join(work, 'node_modules/dsh-cost-meter'), 'junction')
  writeFileSync(join(work, 'package.json'), '{"type":"module"}')
  const anchor = pathToFileURL(join(work, 'package.json')).href
  // Same resolution used by dshmarket's resolveProfileEntry (no real user profile).
  const hotEntry = pathToFileURL(createRequire(anchor).resolve('dsh-cost-meter')).href
  const negativeEntry = pathToFileURL(join(work, 'no-registration.mjs')).href
  writeFileSync(fileURLToPath(negativeEntry), `
    export { TYPERT } from ${JSON.stringify(new URL('../lib/typert.host.js', import.meta.url).href)};
    export function apply(ctx) { ctx.provide('costMeter', { getState() { throw Error('must not dispatch') } }) }
  `)
  for (const mode of ['negative', 'hot', 'cold', 'stale-lock-cold', 'late-registry', 'already-registered', 'unload-before-registry']) {
    const host = new Context(), errors = []
    const peerLifetime = new AbortController()
    const peer = { id: 'cm-rpc-test', ctx: host, principal: { kind: 'owner' }, signal: peerLifetime.signal, interactions: 'none', dispose: async () => { peerLifetime.abort() } }
    const invokeState = () => host.typertGateway.invoke({ namespace: 'costMeter', method: 'getState', args: {}, ...(RemoteAccess ? { peer } : {}) })
    host.baseUrl = anchor
    host.logger = { error: error => errors.push(error), warn() {}, info() {} }
    const late = mode === 'late-registry' || mode === 'unload-before-registry'
    let hot
    try {
      await host.plugin(Loader, { baseUrl: anchor }).await()
      if (!late) await host.plugin(Registry).await()
      await host.plugin(TypertLoader, { packages: [] }).await()
      if (RemoteAccess) await host.plugin(RemoteAccess).await()
      await host.plugin(Gateway, {}).await()
      if (mode === 'already-registered') host.typert.register(TYPERT)
      const existing = host.get('typert')?.getPackage('dsh-cost-meter')
      if (mode === 'stale-lock-cold') {
        const lock = join(work, 'storages', 'cost-meter', 'ledger.json.lock')
        mkdirSync(lock)
        const owner = join(lock, `${process.pid}-00000000-0000-0000-0000-000000000237`)
        writeFileSync(owner, '')
        const old = new Date(Date.now() - process.uptime() * 1000 - 10000)
        utimesSync(owner, old, old)
      }
      if (mode === 'cold' || mode === 'stale-lock-cold') {
        await host.loader.root.update([{ id: 'cost-meter', name: 'dsh-cost-meter' }])
        await host.loader.await()
      } else {
        const path = join(work, 'hot.json')
        writeFileSync(path, JSON.stringify([{ id: 'cost-meter', name: mode === 'negative' ? negativeEntry : hotEntry }]))
        hot = host.plugin(Include, { path: pathToFileURL(path).href })
        await hot.await()
      }
      assert.ok(host.get('costMeter'), `${mode}: business service loaded`)
      if (mode === 'stale-lock-cold') assert.equal(existsSync(join(work, 'storages', 'cost-meter', 'ledger.json.lock')), false, '#237: stale lock heals before real loader activation')
      if (mode === 'unload-before-registry') {
        await hot.dispose()
        await host.plugin(Registry).await()
        assert.equal(host.typert.getPackage('dsh-cost-meter'), undefined)
        assert.equal(host.get('costMeter'), undefined)
        continue
      }
      if (late) await host.plugin(Registry).await()
      if (mode === 'negative') {
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(host.typert.getPackage('dsh-cost-meter'), undefined)
        await assert.rejects(invokeState(),
          error => error.code === 'gateway/invocation-unavailable', 'negative control: standalone file entry has no RPC manifest')
        continue
      }
      await settle(() => !!host.typert.getPackage('dsh-cost-meter'))
      const state = await invokeState()
      assert.ok(state.config && state.today, `${mode}: real ledger RPC works without restart`)
      if (existing) assert.equal(host.typert.getPackage('dsh-cost-meter'), existing)
      if (hot) {
        await hot.dispose()
        assert.equal(host.get('costMeter'), undefined)
        assert.equal(host.typert.getPackage('dsh-cost-meter'), existing, 'unload removes only the plugin-owned manifest')
        if (mode === 'hot') {
          hot = host.plugin(Include, { path: pathToFileURL(join(work, 'hot.json')).href })
          await hot.await()
          await settle(() => !!host.typert.getPackage('dsh-cost-meter'))
          assert.ok((await invokeState()).config)
        }
      }
      assert.deepEqual(errors, [], `${mode}: no duplicate registration/lifecycle errors`)
    } finally { await peer.dispose(); await host.fiber.dispose() }
  }
  console.log('[ok] #154 real host: file-entry failure control, hot/cold RPC, late registry, owned cleanup and remount')
} finally {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  assert.equal(dirname(work), tmpdir())
  // Electron's patched recursive rm can follow a Windows junction into the repo.
  // Remove the link itself first; never recurse if its identity is unexpected.
  const link = join(work, 'node_modules/dsh-cost-meter')
  if (existsSync(link)) {
    assert.ok(lstatSync(link).isSymbolicLink(), 'cleanup target must remain the fixture junction')
    if (process.platform === 'win32') rmdirSync(link)
    else unlinkSync(link)
  }
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
