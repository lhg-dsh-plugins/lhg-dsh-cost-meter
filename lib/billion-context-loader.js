/** Runs only in the original billion-context proxy's loader worker. */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { patchBillionRuntime } from './billion-context-patch.js'

let target, fingerprint
export function initialize(data) { target = data.target; fingerprint = data.fingerprint }
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (url !== target || result.format !== 'module') return result
  try {
    const source = result.source == null ? readFileSync(new URL(url), 'utf8') : Buffer.from(result.source).toString('utf8')
    if (createHash('sha256').update(source).digest('hex') !== fingerprint) return result
    const patched = patchBillionRuntime(source, 'proxy', { proxy: new URL('./billion-context-proxy.js', import.meta.url).href })
    return { ...result, source: patched.source }
  } catch { return result } // A collection failure must never stop the original proxy.
}
