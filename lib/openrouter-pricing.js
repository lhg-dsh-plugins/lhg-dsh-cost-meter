import { createHash } from 'node:crypto'
import { DEFAULT_PROVIDER_PRICE_TABLE, OPENROUTER_MODELS_URL, normalizePrice, parseOpenRouterModels } from './pricing.js'
import { applyConfigPatch, repairLedgerPricing } from './store.js'
import { fetchWithRetry, readJsonBounded } from './net.js'

const MIGRATION = 'pricing-openrouter-v1'
const fingerprint = raw => {
  const entry = normalizePrice(raw)
  if (!entry) return null
  const { sourceUrl, checkedAt, notes, ...rates } = entry
  return createHash('sha256').update(JSON.stringify(rates)).digest('hex')
}
const baseline = (ledger, id) => ledger.openrouterPriceHashes?.[id]
  ?? fingerprint(DEFAULT_PROVIDER_PRICE_TABLE.openrouter.models[id])
const managed = (ledger, id, entry) => baseline(ledger, id) === fingerprint(entry)

/** OpenRouter 模型 id 中,价格已偏离同步基线(即用户手改过)的集合。
 *  与刷新时跳过覆盖的判定同源(managed),只读不改写任何价格或哈希。
 *  刷新逻辑只对 managed 条目写回,故未列入者下次同步仍会被官方价覆盖。 */
export function lockedOpenRouterIds(ledger) {
  const models = ledger.config?.prices?.providers?.openrouter?.models ?? {}
  const ids = []
  for (const [id, entry] of Object.entries(models)) {
    if (!managed(ledger, id, entry)) ids.push(id)
  }
  return ids
}

/** 把某条 OpenRouter 价格交回自动同步:将该条基线记为「当前值」,
 *  使 managed() 重新为真,下一次刷新即用官方价覆盖并刷新基线。
 *  不删条目、不发网络请求,故交回期间该模型仍按现值计费,不会被误判为未定价。 */
export function releaseOpenRouterLock(ledger, id) {
  const entry = ledger.config?.prices?.providers?.openrouter?.models?.[id]
  if (entry === undefined) return false
  const hash = fingerprint(entry)
  if (hash === null) return false
  ledger.openrouterPriceHashes = { ...ledger.openrouterPriceHashes, [id]: hash }
  return true
}

/** 只估算 OpenRouter 零费用桶；已记金额、其他厂商和显式映射保持原样。 */
export function repairOpenRouterLedger(ledger) {
  if (ledger.pricingHistory) return { recostedBuckets: 0 }
  if (ledger.migrations.includes(MIGRATION)) return { recostedBuckets: 0 }
  return repairLedgerPricing(ledger, (key, bucket) => {
    const sep = key.indexOf(':')
    if (!['openrouter', 'llm-openrouter'].includes(key.slice(0, sep)) || Number(bucket.cost) !== 0) return false
    const id = key.slice(sep + 1), entry = ledger.config.prices?.providers?.openrouter?.models?.[id]
    if (Object.hasOwn(ledger.config.priceOverrides ?? {}, 'openrouter:' + id)) return false
    return !!entry && managed(ledger, id, entry)
  })
}

/** 启动刷新的重启级冷却(issue #384):与小时级定时器同频;上次成功拉取
 *  不足此时长时启动刷新直接跳过,避免宿主重启循环把每次启动放大成整份价目表流量。 */
export const OPENROUTER_STARTUP_COOLDOWN_MS = 3600_000

/** 每个账本共享一次在途请求；总超时覆盖响应体，卸载取消并阻止迟到写入。 */
export function createOpenRouterPriceRefresh(ledger, { fetchImpl, timeoutMs = 20000, now = Date.now } = {}) {
  let active = true, pending = null, controller = null
  // 启动冷却的判定基准:创建(即进程启动载入账本)时快照里的上次成功时刻。
  // 本进程内的手动/定时刷新只更新落盘值供下一次启动用,不追溯改变本次启动决策。
  const loadedFetchedAt = ledger.openrouterPricesFetchedAt ?? 0
  const refresh = () => {
    if (!active || ledger.closed) return Promise.reject(new Error('OpenRouter price refresh disposed'))
    if (pending) return pending
    controller = new AbortController()
    const signal = controller.signal
    const timer = setTimeout(() => controller?.abort(new Error('OpenRouter price refresh timed out')), timeoutMs)
    timer.unref?.()
    pending = (async () => {
      const response = await fetchWithRetry(OPENROUTER_MODELS_URL, {
        headers: { 'user-agent': 'dsh-cost-meter (DeepSeek Harness plugin)' }, redirect: 'error', signal,
      }, { attempts: 2, fetchImpl })
      if (!response.ok) {
        try { await response.body?.cancel?.() } catch {}
        throw new Error(`HTTP ${response.status}`)
      }
      const { models } = parseOpenRouterModels(await readJsonBounded(response, 4 * 1024 * 1024))
      signal.throwIfAborted()
      if (!active || ledger.closed) throw new Error('OpenRouter price refresh disposed')
      // 网络等待后读取当前配置，保留期间的其他设置改动；手改价格不被覆盖。
      const previous = ledger.config.prices?.providers?.openrouter?.models ?? {}
      const merged = { ...previous }, hashes = { ...ledger.openrouterPriceHashes }
      let count = 0
      for (const [id, raw] of Object.entries(models)) {
        const entry = normalizePrice(raw)
        if (!entry) continue
        if (Object.hasOwn(previous, id) ? !managed(ledger, id, previous[id]) : hashes[id] !== undefined) continue
        merged[id] = { ...entry, ...(previous[id]?.notes ? { notes: previous[id].notes } : {}) }
        hashes[id] = fingerprint(entry)
        count++
      }
      const { config, errors } = applyConfigPatch(ledger.config, { prices: {
        ...ledger.config.prices,
        providers: { ...ledger.config.prices?.providers, openrouter: { models: merged } },
      } })
      if (errors.length) throw new Error(errors.join(';'))
      ledger.config = config
      ledger.openrouterPriceHashes = hashes
      // 成功时刻落盘(随 scheduleWrite 一并持久化),供跨重启的启动冷却判定(issue #384)。
      ledger.openrouterPricesFetchedAt = now()
      // 离线启动只做快照范围的修复；首次目录成功后再完成迁移，避免永久漏掉其余模型。
      const repaired = repairOpenRouterLedger(ledger)
      if (!ledger.migrations.includes(MIGRATION)) ledger.migrations.push(MIGRATION)
      ledger.scheduleWrite()
      return { count, ...repaired }
    })().finally(() => { clearTimeout(timer); pending = null; controller = null })
    return pending
  }
  /** 启动专用入口:启动快照足够新(上次成功 <1h)时跳过网络请求;手动与定时刷新仍走 refresh() 无条件拉取。 */
  const refreshOnStartup = () => {
    if (!active || ledger.closed) return Promise.reject(new Error('OpenRouter price refresh disposed'))
    if (pending) return pending
    if (now() - loadedFetchedAt < OPENROUTER_STARTUP_COOLDOWN_MS) {
      return Promise.resolve({ count: 0, skipped: true })
    }
    return refresh()
  }
  return { refresh, refreshOnStartup, dispose() { active = false; controller?.abort(new Error('OpenRouter price refresh disposed')) } }
}
