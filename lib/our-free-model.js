/** Read only the active host's plugin runtime; never scan other profiles or keys. */
export function ourFreeModelStatus(ctx) {
  try {
    const loader = ctx?.get?.('loader')
    if (typeof loader?.entries === 'function') {
      for (const entry of loader.entries()) {
        if (entry.options?.name !== 'dsh-our-free-model' && entry.fiber?.runtime?.name !== 'our-free-model') continue
        if (!entry.disabled && entry.options?.disabled !== true && entry.fiber?.state === 2) return { enabled: true, version: '' }
      }
      return null
    }
    for (const runtime of ctx?.registry?.values?.() ?? []) {
      if (runtime.name !== 'our-free-model') continue
      for (const fiber of runtime.fibers ?? []) if (fiber.state === 2 && !fiber.entry?.disabled) return { enabled: true, version: '' }
    }
  } catch {}
  return null
}
