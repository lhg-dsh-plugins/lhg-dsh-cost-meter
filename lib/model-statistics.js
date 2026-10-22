/** Presentation exclusions only: original model buckets, calls and prices stay in the ledger. */
import { fxRatesOf } from './exchange-rates.js'

const scopes = ['today', 'summary', 'budget']
const object = value => value && typeof value === 'object' && !Array.isArray(value)
export function normalizeModelStatistics(raw) {
  if (!object(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.includes(':') && key.length <= 512 && object(value))
    .slice(0, 1000).map(([key, value]) => [key, Object.fromEntries(scopes.map(scope => [scope, value[scope] !== false]))])
    .filter(([, value]) => scopes.some(scope => !value[scope])))
}
export function validModelStatistics(raw) {
  return object(raw) && Object.keys(raw).length <= 1000 && Object.entries(raw).every(([key, value]) =>
    key.includes(':') && key.length <= 512 && object(value) && Object.entries(value).every(([scope, on]) => scopes.includes(scope) && typeof on === 'boolean'))
}

export function modelStatisticsAggregate(aggregate, config, scope) {
  if (!aggregate) return aggregate
  const excluded = Object.entries(config.modelStatistics ?? {}).filter(([key, flags]) => flags?.[scope] === false && aggregate.byProviderModel?.[key])
    .map(([key]) => [key, aggregate.byProviderModel[key]])
  if (!excluded.length) return aggregate
  const result = { ...aggregate }, rates = fxRatesOf(config)
  for (const field of ['cost', 'apiCost', 'costCny', 'apiCostCny', 'costEur', 'apiCostEur', 'calls', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) {
    if (!Number.isFinite(aggregate[field])) continue
    const frozen = /^(apiCost|cost)(Cny|Eur)$/.exec(field)
    const amount = row => Number.isFinite(row[field]) ? row[field] : frozen
      ? (row[frozen[1]] ?? row.cost ?? 0) * rates[frozen[2] === 'Cny' ? 'CNY' : 'EUR']
      : field === 'apiCost' ? row.cost ?? 0 : 0
    result[field] = Math.max(0, aggregate[field] - excluded.reduce((sum, [, row]) => sum + amount(row), 0))
  }
  // Keep buckets for editing and original records; only the displayed sums are filtered.
  if (Array.isArray(aggregate.sessions)) result.sessions = aggregate.sessions.map(row => modelStatisticsAggregate(row, config, scope))
  return result
}
