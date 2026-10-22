/** Passed with --import only to a verified, original billion-context proxy. */
import * as module from 'node:module'
import { pathToFileURL } from 'node:url'

const raw = process.env.DSH_COST_METER_BILLION_LOADER
delete process.env.DSH_COST_METER_BILLION_LOADER
try {
  const data = JSON.parse(raw ?? 'null')
  if (data && typeof module.register === 'function' && typeof data.script === 'string' && /^[a-f\d]{64}$/.test(data.fingerprint)) {
    module.register(new URL('./billion-context-loader.js', import.meta.url), {
      parentURL: import.meta.url, data: { target: pathToFileURL(data.script).href, fingerprint: data.fingerprint },
    })
  }
} catch {} // Older runtimes retain normal billion-context operation and host billing.
