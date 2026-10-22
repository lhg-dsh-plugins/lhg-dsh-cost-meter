/** Passive stream tracking. No session contents, stream options or abort signals are changed. */
const scopes = new WeakMap()
export function contextActivity(ctx) {
  let scope = scopes.get(ctx)
  if (scope) return scope
  const active = new Map(), cached = new Map()
  scope = {
    enter(sessionId) {
      const key = typeof sessionId === 'string' ? sessionId : ''
      active.set(key, (active.get(key) ?? 0) + 1)
      let released = false
      return () => {
        if (released) return
        released = true
        const count = (active.get(key) ?? 1) - 1
        if (count) active.set(key, count); else active.delete(key)
      }
    },
    busy(id) { return active.has(id) || active.has('') },
    read(id, session, config) {
      const row = cached.get(id)
      return row?.session === session && row.config === config ? row.value : null
    },
    save(id, session, config, value) {
      cached.delete(id); cached.set(id, { session, config, value })
      if (cached.size > 32) cached.delete(cached.keys().next().value)
      return value
    },
  }
  scopes.set(ctx, scope)
  return scope
}
