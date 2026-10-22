/** Direct stock-package integration. No package writes, NODE_OPTIONS or route changes. */
import childProcess from 'node:child_process'
import * as module from 'node:module'
import { channel } from 'node:diagnostics_channel'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, realpathSync } from 'node:fs'
import { dirname, basename, join, resolve } from 'node:path'
import { patchBillionRuntime } from './billion-context-patch.js'
import { billionVersionSupported } from './billion-context-compatibility.js'

const key = Symbol.for('dsh-cost-meter.billion-context.auto.v1')
const peersKey = Symbol.for('dsh-cost-meter.billion-context.peers.v1')
const bridgeKey = Symbol.for('dsh-cost-meter.billion-context.v1')
const header = 'x-dsh-cost-meter-group', preload = new URL('./billion-context-preload.js', import.meta.url).href
const loopback = address => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(address.hostname)
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}
function addressOf(request) {
  try { const url = new URL(request.path, String(request.origin)); return loopback(url) && url.protocol === 'http:' ? url : null } catch { return null }
}
function headerValue(headers, name) {
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) if (String(headers[i]).toLowerCase() === name) return String(headers[i + 1])
  } else if (typeof headers === 'string') {
    for (const line of headers.split('\r\n')) if (line.slice(0, line.indexOf(':')).toLowerCase() === name) return line.slice(line.indexOf(':') + 1).trim()
  } else if (headers && typeof headers === 'object') return headers[name] == null ? null : String(headers[name])
  return null
}
function readSource(path) {
  if (statSync(path).size > 32 * 1024 * 1024) throw Error('runtime_size_changed')
  return readFileSync(path, 'utf8')
}
/** Identify from package metadata, never from the executable name alone. */
export function inspectBillionLaunch(args, options = {}, cache = new Map()) {
  if (!Array.isArray(args) || typeof args[0] !== 'string' || args[0].startsWith('-')) return null
  let script
  try { script = realpathSync(resolve(options.cwd ?? process.cwd(), args[0])) } catch { return null }
  if (basename(script) !== 'index.js' || basename(dirname(script)) !== 'dist') return null
  const root = dirname(dirname(script))
  let pkg
  try { pkg = JSON.parse(readSource(join(root, 'package.json'))) } catch { return null }
  if (pkg.name !== 'billion-context' || pkg.dshCostMeterCompatibility) return null
  if (billionVersionSupported(pkg.version) !== true) return { version: pkg.version, reason: 'needs_update' }
  if (typeof module.register !== 'function') return { version: pkg.version, reason: 'bridge_missing' }
  try {
    const native = join(root, 'dist/agent/dsh-native.js')
    const infos = [statSync(script), statSync(native)]
    const revision = script + ':' + infos.map(info => [info.size, info.mtimeMs, info.ctimeMs].join(':')).join(':')
    if (cache.has(revision)) return cache.get(revision)
    const source = readSource(script)
    patchBillionRuntime(source, 'proxy')
    patchBillionRuntime(readSource(native), 'native')
    const result = { script, version: pkg.version, fingerprint: createHash('sha256').update(source).digest('hex') }
    cache.set(revision, result)
    if (cache.size > 8) cache.delete(cache.keys().next().value)
    return result
  } catch { return { version: pkg.version, reason: 'changed' } }
}
export function installBillionAuto() {
  let released = false
  const cleanup = state => () => { if (released) return; released = true; release(state) }
  let state = globalThis[key]
  if (state) {
    state.references++
    if (state.issue) globalThis[bridgeKey]?.adapterStatus?.(state.issue.version, state.issue.reason)
    return cleanup(state)
  }
  const prototype = childProcess.ChildProcess.prototype, original = prototype.spawn
  const cache = new Map(), requests = new WeakMap(), children = new Map()
  // Keep only local handshake metadata across a cost-meter hot reload. No active hook survives disposal.
  const origins = globalThis[peersKey] ??= new Map()
  state = { references: 1, original, subscriptions: [], children, prototype }
  const bridge = () => globalThis[bridgeKey]
  // Native bili captures `spawn` before its asynchronous bootstrap completes.
  // Its captured function still calls this prototype method at launch time.
  const wrapped = function (options) {
    if (state.references <= 0 || !options || !Array.isArray(options.args) || !Array.isArray(options.envPairs)) return original.apply(this, arguments)
    const command = options.file, args = options.args.slice(1)
    if (typeof command !== 'string' || !['node', 'node.exe', 'nodejs'].includes(basename(command).toLowerCase()) && !options.envPairs.includes('ELECTRON_RUN_AS_NODE=1')) return original.apply(this, arguments)
    let launch
    try { launch = inspectBillionLaunch(args, options, cache) } catch {}
    try { if (launch?.reason) { state.issue = launch; bridge()?.adapterStatus?.(launch.version, launch.reason) } } catch {}
    if (!launch || launch.reason) return original.apply(this, arguments)
    state.issue = undefined
    const envPairs = options.envPairs.filter(pair => !pair.startsWith('DSH_COST_METER_BILLION_LOADER='))
    envPairs.push('DSH_COST_METER_BILLION_LOADER=' + JSON.stringify({ script: launch.script, fingerprint: launch.fingerprint }))
    const result = original.call(this, { ...options, args: [options.args[0], '--import', preload, ...args], envPairs })
    const child = this
    children.set(child.pid, child)
    const done = () => {
      children.delete(child.pid)
      for (const [origin, peer] of origins) if (peer.pid === child.pid) origins.delete(origin)
    }
    child.once('exit', done); child.once('error', done)
    return result
  }
  state.wrapped = wrapped
  prototype.spawn = wrapped
  const subscribe = (name, listener) => {
    const safe = message => { try { listener(message) } catch {} }
    const events = channel(name); events.subscribe(safe); state.subscriptions.push(() => events.unsubscribe(safe))
  }
  subscribe('undici:request:create', ({ request }) => {
    const address = addressOf(request)
    if (request.method !== 'POST') return
    if (!address || !address.pathname.startsWith('/bili/')) {
      bridge()?.begin?.(new URL(request.path, String(request.origin)).href)
      return
    }
    if (headerValue(request.headers, header)) return
    const peer = origins.get(address.origin)
    if (!peer || !alive(peer.pid)) {
      origins.delete(address.origin)
      bridge()?.unsupported?.({ changed: false, missing: !peer })
      return
    }
    const current = bridge(), id = current?.begin(address.href)
    if (!id) return
    request.addHeader(header, id)
    requests.set(request, { bridge: current, id, origin: address.origin })
  })
  subscribe('undici:request:headers', ({ request, response }) => {
    const address = addressOf(request)
    if (address && request.method === 'GET' && address.pathname === '/__bili/health') {
      const pid = Number(headerValue(response.headers, 'x-dsh-cost-meter-pid'))
      if (response.statusCode === 200 && headerValue(response.headers, 'x-dsh-cost-meter-protocol') === '1' && alive(pid)) {
        origins.set(address.origin, { pid })
        if (origins.size > 128) origins.delete(origins.keys().next().value)
      } else origins.delete(address.origin)
    }
    const current = requests.get(request)
    if (!current) return
    requests.delete(request)
    const ok = headerValue(response.headers, header) === current.id
    current.bridge.ack(current.id, ok)
    if (!ok) origins.delete(current.origin)
  })
  subscribe('undici:request:error', ({ request }) => {
    const current = requests.get(request)
    if (current) { requests.delete(request); current.bridge.ack(current.id, false, { transient: true }); origins.delete(current.origin) }
  })
  globalThis[key] = state
  return cleanup(state)
}
function release(state) {
  if (--state.references > 0 || globalThis[key] !== state) return
  for (const dispose of state.subscriptions) dispose()
  if (state.prototype.spawn === state.wrapped) state.prototype.spawn = state.original
  delete globalThis[key]
}
