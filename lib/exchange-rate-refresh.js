/** Public daily ECB reference rates via Frankfurter. No account or inference request. */
export const EXCHANGE_RATE_URL = 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD&quotes=CNY,EUR'
export function parseExchangeRates(rows, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length > 16) throw Error('Invalid exchange rates')
  const result = { USD: 1 }, dates = new Set()
  for (const row of rows) {
    if (row?.base !== 'USD' || !['CNY', 'EUR'].includes(row.quote)) continue
    const at = Date.parse(row.date + 'T00:00:00Z')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(at) || at > now + 86400000 || at < now - 14 * 86400000 || !Number.isFinite(row.rate) || row.rate <= 0 || row.rate > 1e6 || result[row.quote] !== undefined) throw Error('Invalid exchange rate quote')
    result[row.quote] = row.rate; dates.add(row.date)
  }
  if (!result.CNY || !result.EUR || dates.size !== 1) throw Error('Incomplete exchange rates')
  return { rates: result, date: [...dates][0] }
}
export function createExchangeRateRefresh(ledger, { request = fetch, now = Date.now } = {}) {
  let pending = null, controller = null, disposed = false, lastAttempt = 0
  return {
    refresh() {
      const current = now(), config = ledger.config
      if (disposed || ledger.closed || config.exchangeRateAuto === false || new Date(config.exchangeRateCheckedAt || 0).toISOString().slice(0, 10) === new Date(current).toISOString().slice(0, 10)) return Promise.resolve(false)
      if (pending) return pending
      if (lastAttempt && current - lastAttempt < 3600000) return Promise.resolve(false)
      lastAttempt = current; controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 10000); timeout.unref?.()
      pending = (async () => {
        const response = await request(EXCHANGE_RATE_URL, { signal: controller.signal, credentials: 'omit', redirect: 'error' })
        if (!response.ok) throw Error('Exchange rate service unavailable')
        const text = await response.text()
        if (text.length > 16384) throw Error('Exchange rate response too large')
        const { rates, date } = parseExchangeRates(JSON.parse(text), current)
        if (disposed || ledger.closed || ledger.config.exchangeRateAuto === false) return false
        ledger.config = { ...ledger.config, fxRates: rates, exchangeRate: rates[ledger.config.currency] ?? ledger.config.exchangeRate,
          exchangeRateDate: date, exchangeRateCheckedAt: current }
        ledger.scheduleWrite()
        return true
      })().finally(() => { clearTimeout(timeout); pending = null; controller = null })
      return pending
    },
    dispose() { disposed = true; controller?.abort() },
  }
}
