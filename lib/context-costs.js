/** Read-only current-context costs. Never writes the session, ledger or prices. */
import { providerPriceEntryFor, tierFor, usdFromCost } from './pricing.js'
import { billingClassOf, enabledPlanSetOf } from './plan-billing.js'
import { replaySessionRecords } from './backfill.js'
import { costFromSamples } from './turn-cost.js'
import { fxRatesOf } from './exchange-rates.js'
import { contextActivity } from './context-activity.js'

export const CONTEXT_PARTS = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'other']
const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const zeroParts = () => Object.fromEntries(CONTEXT_PARTS.map(key => [key, 0]))
const sourceName = source => typeof source === 'string' ? source : source?.type ?? source?.kind ?? ''

// The client checks the active peer registrations and required slot APIs.
// Release numbers are informational: compatible interfaces may survive upgrades.
export async function getContextIntegration(ctx) {
  try {
    const manager = ctx.get('pluginManager')
    if (typeof manager?.listBundles !== 'function') return { version: '', compatible: false, reason: 'unavailable' }
    const bundles = await manager.listBundles()
    const peer = bundles.find(row => row.name === 'dsh-context' && row.enabled && !row.error)
    if (!peer) return { version: '', compatible: false, reason: 'missing' }
    const version = typeof peer.version === 'string' ? peer.version : ''
    return { version, compatible: true, reason: 'ready' }
  } catch { return { version: '', compatible: false, reason: 'unavailable' } }
}

/** Use the same usage-anchored total as the host composer and dsh-context. */
export function contextTokenBasis(measurement, projections = {}) {
  const pressure = projections.contextPressure
  for (const key of ['projectedTokens', 'pressureTokens']) {
    if (count(pressure?.[key])) return { tokens: pressure[key], source: 'usage' }
  }
  // Older hosts may lack contextPressure. The peer's published request anchor
  // carries prompt usage plus the heuristic movement since that request.
  const timeline = projections.contextTimeline
  const anchor = timeline?.last ?? (Array.isArray(timeline?.requests) ? timeline.requests.at(-1) : null)
  if (count(anchor?.prompt) && count(anchor.total) && count(timeline?.current?.total)) {
    const tokens = anchor.prompt + timeline.current.total - anchor.total
    if (Number.isFinite(tokens)) return { tokens: Math.max(0, tokens), source: 'usage' }
  }
  // measure() can reject a smaller provider sample in favor of a local floor.
  // That floor is useful without an anchor, but overstates proxy-compressed input.
  return { tokens: measurement.totalTokens, source: measurement.baseline?.kind === 'usage' ? 'usage' : 'estimate' }
}

/** Composition is proportional, not provider-reported per-category usage. */
export function allocateContext(parts, target) {
  const total = Object.values(parts).reduce((sum, value) => sum + value, 0)
  if (!total) return CONTEXT_PARTS.map(key => ({ key, tokens: key === 'other' ? target : 0 }))
  return CONTEXT_PARTS.map(key => ({ key, tokens: target * parts[key] / total }))
}

export function contextParts(measurement, records, projections = {}, target = measurement.totalTokens) {
  const parts = zeroParts(), official = projections.contextBreakdown, partner = projections.contextTimeline?.current
  const linked = partner && CONTEXT_PARTS.slice(0, 7).every(key => key === 'skill' && partner[key] === undefined || count(partner[key]))
  if (linked) {
    for (const key of CONTEXT_PARTS.slice(0, 7)) parts[key] = partner[key] ?? 0
  } else {
    const bySeq = new Map(records.map(row => [row.seq, row]))
    let system = null
    for (const node of measurement.nodes) {
      const record = bySeq.get(node.seq), raw = node.heuristicTokens ?? node.tokens
      let category = 'other'
      if (record?.type === 'system/message') { category = 'inject'; if (raw > 0) system = { raw } }
      else if (record?.type === 'developer/message') category = 'inject'
      else if (record?.type === 'assistant/message') category = 'assistant'
      else if (record?.type === 'tool/result') category = 'tool'
      else if (record?.type === 'user/message') {
        const source = sourceName(record.data?.source ?? record.data?.message?.source)
        category = !source || ['human', 'user', 'input'].includes(source) ? 'user' : source.includes('skill') ? 'skill' : 'inject'
      }
      parts[category] += raw
    }
    if (system) { parts.system = system.raw; parts.inject -= system.raw }
  }
  // Use the same official system/tools/messages split that dsh-context displays.
  if (official && ['systemTokens', 'toolsTokens', 'messageTokens'].every(key => count(official[key]))) {
    parts.system = official.systemTokens; parts.tools = official.toolsTokens
    const messages = CONTEXT_PARTS.slice(2), sum = messages.reduce((n, key) => n + parts[key], 0)
    for (const key of messages) parts[key] = sum ? parts[key] / sum * official.messageTokens : key === 'other' ? official.messageTokens : 0
  } else if (!linked) {
    // Without a composition projection, do not label anchor error as tool schemas.
    parts.other += Math.max(0, measurement.totalTokens - measurement.surfaceTokens)
  }
  return { components: allocateContext(parts, target), linked: !!linked }
}

function ratesFor(tier, currency, exchangeRate) {
  return Object.fromEntries([['input', 'cacheMiss'], ['cacheRead', 'cacheHit'], ['cacheWrite', 'cacheWrite'], ['output', 'output'], ['reasoning', 'reasoning']]
    .map(([key, price]) => [key, usdFromCost(tier[price] ?? (key === 'cacheWrite' ? tier.cacheHit : 0), currency, exchangeRate)]))
}

export function getContextCosts(ledger, ctx, query, now = Date.now()) {
  const sessionId = query?.sessionId
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 512) throw new Error('Invalid context costs session')
  const empty = { status: 'unavailable', sessionId, generatedAt: now, revision: 0, provider: '', model: '', basis: 'api', priced: false,
    source: 'none', linked: false, contextTokens: 0, components: [], rates: null, longContext: null, lastCall: null }
  const session = ctx.get('sessions')?.get?.(sessionId), meter = ctx.get('tokenMeter')
  if (!session) return { ...empty, status: 'session-unavailable' }
  // Full measurement and history replay share the host event loop with generation
  // and compaction. Defer this optional view until the stream has finished (#279).
  const activity = contextActivity(ctx)
  if (activity.busy(sessionId)) return activity.read(sessionId, session, ledger.config) ?? { ...empty, status: 'busy' }
  if (typeof meter?.measure !== 'function') return { ...empty, status: 'meter-unavailable' }
  const measurement = meter.measure(session)
  if (!count(measurement?.totalTokens) || !count(measurement.surfaceTokens) || !Array.isArray(measurement.nodes)
    || !measurement.nodes.every(node => count(node.tokens) && (node.heuristicTokens === undefined || count(node.heuristicTokens)))) return empty
  const records = session.snapshotEvents(), header = session.requestHeader?.() ?? records.filter(row => row.type === 'request/header').at(-1)?.data?.header
  const provider = header?.config?.provider, model = header?.config?.model
  if (typeof provider !== 'string' || typeof model !== 'string' || !provider || !model) return { ...empty, status: 'route-unavailable' }
  let projections = {}
  // Only consume published scalar projections; never depend on dsh-context internals.
  try { projections = ctx.get('sessionProjections')?.snapshot?.(session, ['contextPressure', 'contextBreakdown', 'contextTimeline'])?.values ?? {} } catch { /* optional projection service may be replacing a generation */ }
  const basis = contextTokenBasis(measurement, projections)
  const config = ledger.config
  const resolved = providerPriceEntryFor(provider, model, config.prices, { mode: config.priceMatch, overrides: config.priceOverrides })
  const tier = tierFor(resolved.entry, now, { enabled: ['deepseek-peak', 'utc-peak'].includes(resolved.billingMode) && config.peakEnabled,
    effectiveAtMs: Date.parse(config.peakEffectiveAt ?? ''), windows: config.peakWindows, holidays: config.peakHolidays })
  // Actual reported usage has a separate face. Never allocate its cache hits
  // to individual context categories: providers do not report that attribution.
  let lastCall = null, routeHeader = null, sampleRecords = null
  for (const row of records) {
    if (row.type === 'request/header') routeHeader = row
    if (row.type !== 'assistant/message' || !routeHeader) continue
    const usage = row.data?.usage
    if (usage && ['input', 'output', 'cacheRead', 'cacheWrite'].some(key => count(usage[key + 'Tokens']))) {
      sampleRecords = [{ type: 'session', id: sessionId }, routeHeader, row]
    }
  }
  if (sampleRecords) lastCall = costFromSamples(replaySessionRecords(sampleRecords, config, null, true).samples, config).calls.at(-1) ?? null
  return activity.save(sessionId, session, config, { ...empty, status: 'ready', revision: measurement.logRevision ?? records.length, provider, model,
    basis: billingClassOf(provider, model, config.planBilling, enabledPlanSetOf(config), config.prices) === 'plan' ? 'plan' : 'api',
    priced: resolved.priced, source: basis.source, contextTokens: basis.tokens,
    ...contextParts(measurement, records, projections, basis.tokens), lastCall,
    rates: resolved.priced ? ratesFor(tier, resolved.currency, fxRatesOf(config).CNY) : null,
    longContext: resolved.priced && tier.longContext ? { aboveInputTokens: tier.longContext.aboveInputTokens, ...ratesFor(tier.longContext, resolved.currency, fxRatesOf(config).CNY) } : null })
}
