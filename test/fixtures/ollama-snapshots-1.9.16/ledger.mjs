// Minimal legacy-format data, reduced from synthetic ledgers written by v1.9.16.
// Keep old rates/amounts literal: generating them with current pricing code would hide regressions.
import { createHash } from 'node:crypto'

export function snapshotLedger(alias) {
  const model = 'deepseek-v4.1-flash', tagged = 'ollama-cloud:' + model + ':1017'
  const fxRates = { USD: 1, CNY: 7, EUR: .92 }
  const pricing = {
    priceMatch: 'auto', priceOverrides: alias ? { [tagged]: 'deepseek:' + model } : {},
    exchangeRate: 7, peakEnabled: true, peakEffectiveAt: '2026-08-01T00:00:00Z',
    peakWindows: [{ start: 1, end: 4 }, { start: 6, end: 10 }], peakHolidays: [],
    prices: { models: { [model]: {
      cacheHit: .003, cacheMiss: .15, output: .6,
      offPeak: { cacheHit: .003, cacheMiss: .15, output: .6 },
      peak: { cacheHit: .006, cacheMiss: .30, output: 1.2 },
    } }, providers: {} },
  }
  // At 07:00 UTC v1.9.16 charged the mapped tag on DeepSeek's calendar, or zero if unmapped.
  const bucket = cost => ({
    input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1,
    cost, apiCost: cost, costCny: cost * 7, apiCostCny: cost * 7, costEur: cost * .92, apiCostEur: cost * .92,
  })
  const byProviderModel = { [tagged]: bucket(alias ? .30 : 0), ['deepseek-official:' + model]: bucket(.30) }
  const totals = { ...bucket(alias ? .60 : .30), input: 2e6, calls: 2, byProviderModel }
  const snapshot = { ...pricing, prices: { ...pricing.prices, ollamaPeak: true } }
  const version = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  return structuredClone({
    version: 1,
    config: { ...pricing, currency: 'CNY', exchangeRateAuto: false, fxRates, legacyAutoImportedAt: 1,
      hideOfficialBalance: true, goQuota: { enabled: false }, balance: { display: 'off' } },
    days: { '2026-10-19': { date: '2026-10-19', ...totals,
      sessions: [{ id: 'snapshot', at: Date.parse('2026-10-19T07:00:00Z'), ...totals }] } },
    pricingHistory: {
      format: 2,
      versions: { [version]: snapshot },
      changes: { initial: { at: 0, version } },
      revisions: {}, runs: {},
      fxChanges: { initial: { at: 0, rates: fxRates } },
    },
  })
}
