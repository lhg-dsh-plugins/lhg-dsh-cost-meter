/** Legacy paired builds remain supported; stock packages use the automatic adapter. */
const key = Symbol.for('dsh-cost-meter.billion-context.v1')
const peers = new Map()
async function supportsMetering(send, address, signal) {
  const saved = peers.get(address.origin)
  if (saved && Date.now() - saved.at < 30000) return saved.pending
  const pending = Promise.resolve().then(async () => {
    try {
      const timeout = AbortSignal.timeout(1500)
      const response = await send(address.origin + '/__bili/health', { method: 'GET', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
      const protocol = response.headers.get('x-dsh-cost-meter-protocol')
      const supported = response.ok && protocol === '1'
      await response.body?.cancel()
      return { supported, changed: response.ok && !supported || protocol !== null && protocol !== '1' }
    } catch { return { supported: false, changed: false } }
  })
  peers.set(address.origin, { at: Date.now(), pending })
  if (peers.size > 32) peers.delete(peers.keys().next().value)
  return pending
}
export async function sendWithBillionMeter(send, input, init) {
  const bridge = globalThis[key]
  if (!bridge) return send(input, init)
  const url = typeof input === 'string' ? input : input?.url ?? String(input)
  let address
  try { address = new URL(url) } catch { return send(input, init) }
  if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(address.hostname) && address.pathname.startsWith('/bili/')) {
    const capability = await supportsMetering(send, address, init?.signal ?? input?.signal)
    if (!capability.supported) {
      bridge.unsupported?.({ changed: capability.changed })
      return send(input, init)
    }
  }
  let group
  try { group = bridge.begin(url) } catch {}
  if (!group) return send(input, init)
  const headers = new Headers(input?.headers)
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
  headers.set('x-dsh-cost-meter-group', group)
  try {
    const response = await send(input, { ...init, headers })
    bridge.ack(group, response.headers.get('x-dsh-cost-meter-group') === group)
    return response
  } catch (error) { bridge.ack(group, false, { transient: true }); throw error }
}
