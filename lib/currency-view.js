import { bindPricingHistory, pricingHistoryOf } from './billing-history.js'
import { fxRatesOf, displayUsd } from './exchange-rates.js'
/** Read-only presentation view for the optional analytics currency query. */
const views = new WeakMap()
export function currencyLedger(ledger, currency) {
  if (!['CNY', 'EUR'].includes(currency)) return ledger
  let cache = views.get(ledger)
  if (!cache || cache.days !== ledger.days || cache.config !== ledger.config) views.set(ledger, cache = { days: ledger.days, config: ledger.config, views: new Map() })
  // Days mutate on account(), so rebuild the small aggregate view; retain identity for analytics caches.
  let view = cache.views.get(currency)
  const config = { ...ledger.config, currency, exchangeRate: fxRatesOf(ledger.config)[currency], _displayCurrency: currency }
  const convert = row => ({ ...row, cost: displayUsd(row, config), apiCost: displayUsd(row, config, true),
    ...(row.byProviderModel ? { byProviderModel: Object.fromEntries(Object.entries(row.byProviderModel).map(([key, value]) => [key, convert(value)])) } : {}),
    ...(row.sessions ? { sessions: row.sessions.map(convert) } : {}) })
  if (!view) { view = Object.create(ledger); cache.views.set(currency, view) }
  view._config = bindPricingHistory(config, pricingHistoryOf(ledger.config))
  view.days = Object.fromEntries(Object.entries(ledger.days).map(([key, value]) => [key, convert(value)]))
  return view
}
