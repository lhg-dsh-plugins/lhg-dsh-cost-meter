import { createHash } from 'node:crypto'
import { OPENDESIGN_DEFAULT_PRICES } from './opendesign-prices.js'
import { OPENDESIGN_PRICES_URL, parseOpenDesignPrices } from './opendesign.js'
import { normalizePrice } from './pricing.js'
import { applyConfigPatch } from './store.js'
import { fetchWithRetry, readJsonBounded } from './net.js'

const fingerprint = raw => {
  const entry = normalizePrice(raw)
  if (!entry) return null
  const { sourceUrl, checkedAt, notes, ...rates } = entry
  return createHash('sha256').update(JSON.stringify(rates)).digest('hex')
}
/** Replace managed public prices only; user edits, unmounts and recorded costs stay intact. */
export function createOpenDesignPriceRefresh(ledger, { fetchImpl, timeoutMs = 20000 } = {}) {
  let active = true, pending = null, controller = null
  return {
    refresh() {
      if (!active || ledger.closed) return Promise.reject(Error('OpenDesign price refresh disposed'))
      if (pending) return pending
      controller = new AbortController()
      const signal = controller.signal, timer = setTimeout(() => controller?.abort(), timeoutMs)
      timer.unref?.()
      pending = (async () => {
        const response = await fetchWithRetry(OPENDESIGN_PRICES_URL, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal }, { attempts: 2, fetchImpl })
        if (!response.ok) { try { await response.body?.cancel?.() } catch {}; throw Error('HTTP ' + response.status) }
        const { models } = parseOpenDesignPrices(await readJsonBounded(response, 4 * 1024 * 1024))
        signal.throwIfAborted()
        if (!active || ledger.closed) throw Error('OpenDesign price refresh disposed')
        const previous = ledger.config.prices.providers?.opendesign?.models ?? {}, merged = { ...previous }
        const hashes = { ...ledger.providerPriceHashes }
        let count = 0
        for (const [model, raw] of Object.entries(models)) {
          const key = 'opendesign:' + model
          const baseline = hashes[key] ?? fingerprint(OPENDESIGN_DEFAULT_PRICES[model])
          if (Object.hasOwn(previous, model) ? fingerprint(previous[model]) !== baseline : hashes[key] !== undefined) continue
          merged[model] = normalizePrice(raw)
          if (previous[model]?.notes) merged[model].notes = previous[model].notes
          hashes[key] = fingerprint(raw); count++
        }
        const { config, errors } = applyConfigPatch(ledger.config, { prices: { ...ledger.config.prices,
          providers: { ...ledger.config.prices.providers, opendesign: { models: merged } } } })
        if (errors.length) throw Error('OpenDesign: invalid refreshed prices')
        ledger.config = config; ledger.providerPriceHashes = hashes; ledger.scheduleWrite()
        return { count }
      })().finally(() => { clearTimeout(timer); pending = null; controller = null })
      return pending
    },
    dispose() { active = false; controller?.abort() },
  }
}
