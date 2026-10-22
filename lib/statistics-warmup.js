/** Prepare the recently viewed conversations independently of the statistics dialog. */
import { lstat, readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getSessionBilling } from './turn-cost.js'
import { getSessionTrajectory } from './trajectory.js'
import { readSessionHeaders, conversationOwners } from './session-tree.js'

const controllers = new WeakMap(), MAX_RECENT = 6
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
export function warmSessionStatistics(ledger, id) { controllers.get(ledger)?.touch(id) }

export function createStatisticsWarmup(ledger, ctx, { billing = getSessionBilling, trajectory = getSessionTrajectory,
  delay = 800, refreshDelay = 3000, now = Date.now } = {}) {
  let active = true, timer, saving = Promise.resolve(), running = null, warming = ''
  const recent = new Map(), pending = new Set(), refreshed = new Map(), requested = new Map()
  const root = ledger.path ? ledger.path + '.details-cache' : '', path = root ? join(root, 'recent.json') : ''
  const basis = () => ['api', 'plan', 'total'].includes(ledger.config?.statisticsBasis) ? ledger.config.statisticsBasis
    : ledger.config?.showTotalWithPlan ? 'total' : 'api'
  const persist = () => {
    if (!path) return
    const rows = [...recent].map(([sessionId, at]) => ({ sessionId, at }))
    saving = saving.then(async () => {
      let temp
      try {
        await mkdir(root, { recursive: true, mode: 0o700 })
        const info = await lstat(root)
        if (!info.isDirectory() || info.isSymbolicLink()) return
        temp = join(root, 'recent.' + randomUUID() + '.tmp')
        await writeFile(temp, JSON.stringify({ version: 1, sessions: rows }), { flag: 'wx', mode: 0o600 })
        await rename(temp, path); temp = null
      } catch { /* Preview/read-only installations do not need a writable cache. */ }
      finally { if (temp) await unlink(temp).catch(() => {}) }
    })
  }
  const schedule = wait => {
    if (!active || running || timer || !pending.size) return
    timer = setTimeout(() => { timer = null; void drain() }, wait)
    timer.unref?.()
  }
  const drain = () => {
    if (running) return running
    if (!active) return Promise.resolve()
    running = (async () => {
      // One conversation at a time: startup must not fan out large history reads.
      while (active && pending.size) {
        const id = pending.values().next().value
        pending.delete(id)
        warming = id
        const key = basis(), query = { sessionId: id, basis: key, background: false }
        try {
          await billing(ledger, ctx, query)
          if (!active) break
          await trajectory(ledger, ctx, { ...query, order: 'cost' })
          refreshed.set(id, now())
        } catch { /* The normal request exposes an actionable retry if this also fails. */ }
        finally { warming = '' }
        if (active && pending.size) await new Promise(resolve => setTimeout(resolve, 50))
      }
    })().finally(() => { running = null; schedule(refreshDelay) })
    return running
  }
  const touch = (id, force = false) => {
    if (!active || !validId(id)) return
    requested.set(id, now())
    while (requested.size > MAX_RECENT) requested.delete(requested.keys().next().value)
    recent.delete(id); recent.set(id, now())
    while (recent.size > MAX_RECENT) recent.delete(recent.keys().next().value)
    if (warming !== id && (force || !refreshed.has(id) || now() - refreshed.get(id) >= 15_000)) {
      const older = [...pending].filter(value => value !== id).slice(0, MAX_RECENT - 1)
      pending.clear(); pending.add(id)
      for (const value of older) pending.add(value)
      schedule(delay)
    }
    // Badge refreshes are frequent; write only when the selected conversation changes.
    if (touch.last !== id) { touch.last = id; persist() }
  }
  const ready = (async () => {
    try {
      if (path) {
        const [directory, info] = await Promise.all([lstat(root), lstat(path)])
        if (directory.isDirectory() && !directory.isSymbolicLink() && info.isFile() && !info.isSymbolicLink() && info.size <= 8192) {
          const data = JSON.parse(await readFile(path, 'utf8'))
          if (data.version === 1 && Array.isArray(data.sessions)) for (const row of data.sessions.slice(-MAX_RECENT)) {
            if (validId(row.sessionId) && Number.isFinite(row.at) && !recent.has(row.sessionId)) recent.set(row.sessionId, row.at)
          }
        }
      }
    } catch { /* The first installation has no remembered conversations. */ }
    if (!active) return
    // The current UI can have already registered a conversation while the file read ran.
    const ordered = [...recent].sort((a, b) => b[1] - a[1]).slice(0, MAX_RECENT)
    recent.clear()
    for (const [id, at] of ordered.toReversed()) recent.set(id, at)
    pending.clear()
    // Restore metadata only. Startup must not scan conversations before a view requests them.
    for (const [id] of ordered) if (requested.has(id)) pending.add(id)
    schedule(delay)
  })()
  const onEvent = async (session, event) => {
    if (!active || !recent.size || ![...requested.values()].some(at => now() - at <= 90_000) || !['turn/end', 'compaction/summary', 'cost-meter/native-search-usage'].includes(event?.type)) return
    const id = session?.header?.id ?? session?.id
    if (!validId(id)) return
    let target = id
    if (!recent.has(target) && ledger.config?.includeSubagentCost) {
      const headers = await readSessionHeaders(ctx)
      target = conversationOwners(headers, [id]).get(id) ?? id
    }
    if (!active || !recent.has(target) || !requested.has(target) || now() - requested.get(target) > 90_000) return
    pending.add(target); schedule(refreshDelay)
  }
  ctx?.on?.('session/event', onEvent, { global: true })
  const controller = { touch, ready, async flush() { await ready; if (timer) { clearTimeout(timer); timer = null }; await drain(); await saving },
    dispose() { active = false; clearTimeout(timer); pending.clear(); controllers.delete(ledger) } }
  controllers.set(ledger, controller)
  return controller
}
