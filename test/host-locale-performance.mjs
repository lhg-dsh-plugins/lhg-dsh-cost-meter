// Run against an unchanged baseline and this checkout with identical synthetic settings and ledger.
// Usage: node test/host-locale-performance.mjs [checkout-root] [result.json]
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const root = resolve(process.argv[2] ?? '.'), output = process.argv[3]
const home = mkdtempSync(join(tmpdir(), 'cm-locale-perf-')), oldHome = process.env.DSH_HOME
process.env.DSH_HOME = home
const { sanitizeConfig } = await import(pathToFileURL(join(root, 'lib/store.js')))
const { apply } = await import(pathToFileURL(join(root, 'lib/index.js')))
const config = sanitizeConfig({ locale: 'auto', balance: { display: 'off' }, goQuota: { enabled: false } })
const storage = join(home, 'storages', 'cost-meter'); mkdirSync(storage, { recursive: true })
writeFileSync(join(storage, 'ledger.json'), JSON.stringify({ version: 1, days: {}, config }))
const rows = Array.from({ length: 64 }, (_, i) => ({ ns: 'fixture-' + i,
  schema: { type: 'object', properties: Object.fromEntries(Array.from({ length: 20 }, (_, j) => ['field' + j, { type: 'string', description: 'Synthetic settings field ' + j }])) },
  value: Object.fromEntries(Array.from({ length: 20 }, (_, j) => ['field' + j, 'synthetic value ' + i + ':' + j])) }))
rows.push({ ns: 'locale', value: { preference: 'en' } })
let describeCalls = 0, networkCalls = 0, service
const settings = { describe: options => {
  assert.deepEqual(options, { redactSecrets: true }); describeCalls++
  // Emulate constructing/serializing all plugin descriptors; never read real host settings.
  return JSON.parse(JSON.stringify(rows))
} }
const cleanups = [], realFetch = globalThis.fetch
globalThis.fetch = async () => { networkCalls++; throw Error('benchmark network is disabled') }
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]
try {
  apply({ get: name => name === 'settings' ? settings : undefined, inject() {}, on: () => () => {},
    provide: (name, value) => { if (name === 'costMeter') service = value },
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose) } })
  for (let i = 0; i < 100; i++) await service.getSessionCost('synthetic-session')
  const rounds = []
  for (let r = 0; r < 5; r++) {
    const before = describeCalls, cpu = process.cpuUsage(), start = performance.now()
    for (let i = 0; i < 2000; i++) await service.getSessionCost('synthetic-session')
    const elapsedMs = performance.now() - start, usedCpu = process.cpuUsage(cpu)
    rounds.push({ calls: 2000, describeCalls: describeCalls - before, elapsedMs, cpuMs: (usedCpu.user + usedCpu.system) / 1000 })
  }
  const result = { node: process.version, platform: process.platform, cpu: cpus()[0].model,
    fixture: { plugins: rows.length, fieldsPerPlugin: 20, warmupCalls: 100 },
    rounds, medianMs: median(rounds.map(x => x.elapsedMs)), medianCpuMs: median(rounds.map(x => x.cpuMs)),
    measuredDescribeCalls: rounds.reduce((n, x) => n + x.describeCalls, 0), networkCalls }
  assert.equal(networkCalls, 0)
  if (output) writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally {
  for (const dispose of cleanups.reverse()) dispose()
  globalThis.fetch = realFetch
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  rmSync(home, { recursive: true, force: true })
}
