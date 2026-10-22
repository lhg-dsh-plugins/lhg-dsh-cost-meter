// Runs in its own process: neither plugin nor its dependencies are preloaded.
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { createServer } from 'node:http'

const root = mkdtempSync(join(tmpdir(), 'cm-billion-cold-'))
const children = [], effects = [], services = new Map(), original = childProcess.spawn
const originalLow = childProcess.ChildProcess.prototype.spawn
for (const key of ['BILLION_CONTEXT_PROXY', 'BILI_PROVIDER_REWRITES', 'BILLION_CONTEXT_PLUGIN', 'BILI_NATIVE_DSH', 'NODE_TEST_CONTEXT']) delete process.env[key]
Object.assign(process.env, { DSH_HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
  XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), BILI_SESSIONS_DIR: join(root, 'sessions'),
  BILI_CONFIG_FILE: join(root, 'config.json'), ACP_AUTO_UPDATE: '0', BILI_ADVISORY_CHECK: '0', BILI_RELEASE_NOTES_CHECK: '0', BILI_MITM: '0' })
writeFileSync(process.env.BILI_CONFIG_FILE, JSON.stringify({ autoUpdate: false, advisoryCheck: false, releaseNotesCheck: false, proxy: 'direct', mitm: { enabled: false } }))
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
process.env.BILI_ZONE_PORT = String(reservation.address().port)
await new Promise(resolve => reservation.close(resolve))
childProcess.spawn = function (command, args, options) {
  const child = original.call(this, command, args, options)
  if (args?.some(arg => String(arg).endsWith('dist/index.js') || String(arg).endsWith('dist\\index.js'))) children.push(child)
  return child
}
syncBuiltinESMExports()
const ctx = { get: key => services.get(key), provide: (key, value) => services.set(key, value),
  effect(fn, label) { const cleanup = fn(); effects.push(cleanup); if (label === 'cost-meter: public price requests') cleanup?.() },
  on() {}, inject() {}, tools: { register() {} }, commands: { register() {} },
  agents: { currentInitiator: () => ({ session: { id: 'cold', header: {} } }) } }
let native
try {
  const paths = [pathToFileURL(resolve(process.argv[2])), new URL('../lib/bootstrap.js', import.meta.url)]
  if (process.argv.includes('cost-first')) paths.reverse()
  await Promise.all(paths.map(async url => { const mod = await import(url.href); if (mod.name === 'bili-native') native = mod; await mod.apply(ctx) }))
  await native._settleNativeForTest()
  assert.equal(children.length, 1, 'the original native plugin starts its own isolated proxy')
  const args = children[0].spawnargs
  assert.ok(args.some(arg => String(arg).includes('billion-context-preload.js')), 'parallel plugin loading installs the automatic adapter')
  const port = args[args.indexOf('--port') + 1]
  const health = await fetch('http://127.0.0.1:' + port + '/__bili/health'); await health.text()
  assert.equal(health.headers.get('x-dsh-cost-meter-protocol'), '1')
  console.log('[ok] stock cold start: ' + (process.argv.includes('cost-first') ? 'cost-first' : 'billion-first'))
} finally {
  native?._resetRegisterForTest()
  for (const dispose of effects.reverse()) dispose?.()
  for (const child of children) if (child.exitCode === null) { child.ref(); const done = once(child, 'exit'); child.kill(); await done }
  childProcess.spawn = original; syncBuiltinESMExports()
  assert.equal(childProcess.ChildProcess.prototype.spawn, originalLow)
  rmSync(root, { recursive: true, force: true })
}
