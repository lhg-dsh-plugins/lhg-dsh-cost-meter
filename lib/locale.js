/** The browser locale face is optional; Host DSH exposes its saved preference through settings. */
export const HOST_LOCALE_MAX_AGE_MS = 1000
const preferences = new WeakMap()

/** describe() may itself emit settings/document-updated; do not recursively describe again. */
export function invalidateHostLocale(ctx) {
  const cached = ctx && preferences.get(ctx)
  if (cached?.reading) return false
  if (cached) cached.expiresAt = 0
  return true
}

export function forgetHostLocale(ctx) { if (ctx) preferences.delete(ctx) }

export function supportedLocale(value) {
  if (typeof value !== 'string') return null
  const language = value.trim().toLowerCase().split(/[-_]/)[0]
  return language === 'zh' || language === 'en' ? language : null
}

export function hostLocaleOf(ctx) {
  try {
    const locale = ctx?.get?.('locale')
    const active = supportedLocale(locale?.getSnapshot?.().active)
    if (active) return active
  } catch { /* Older hosts have no locale face. */ }
  if (!ctx || typeof ctx !== 'object' && typeof ctx !== 'function') return null
  let cached = preferences.get(ctx)
  if (cached && (cached.reading || Date.now() < cached.expiresAt)) return cached.locale
  if (!cached) {
    cached = { locale: null, expiresAt: 0, reading: false }
    preferences.set(ctx, cached)
  }
  cached.reading = true
  try {
    const settings = ctx?.get?.('settings')
    // Read only the public, redacted descriptor; never inspect storage files or credentials.
    const rows = settings?.describe?.({ redactSecrets: true })
    cached.locale = supportedLocale(Array.isArray(rows) ? rows.find(row => row?.ns === 'locale')?.value?.preference : undefined)
  } catch { cached.locale = null }
  finally {
    cached.reading = false
    // Event-less older hosts still observe preference changes at the next read after one second.
    // Store only the parsed language, never the descriptor or any unrelated plugin settings.
    cached.expiresAt = Date.now() + HOST_LOCALE_MAX_AGE_MS
  }
  return cached.locale
}

export function localeOf(config, ctx) {
  if (config?.locale === 'zh' || config?.locale === 'en') return config.locale
  // An unset preference/native bootstrap can be browser-local. Host cannot infer it.
  return hostLocaleOf(ctx) ?? 'zh'
}
