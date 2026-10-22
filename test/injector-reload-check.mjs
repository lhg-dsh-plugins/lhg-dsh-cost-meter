// Execute the upstream reload implementation, not its plugin startup or tools.
// A caller supplies the pinned public TypeScript source; all host data is isolated.
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { parse } from 'acorn'

export async function checkInjectorReload(host, repo, home, bounded) {
  const source = (await transform(fs.readFileSync(process.env.DSH_TEST_INJECTOR_SOURCE, 'utf8'), { loader: 'ts', format: 'esm', target: 'node22' })).code
  const functions = new Map()
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'FunctionDeclaration') functions.set(node.id.name, source.slice(node.start, node.end))
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value)
  }
  visit(parse(source, { sourceType: 'module', ecmaVersion: 'latest' }))
  const names = ['reloadPackage', 'handoff', 'buildFreshnessProblems', 'withOpLock', 'sleep']
  for (const name of names) assert.ok(functions.has(name), 'upstream implementation ' + name)
  // Force the no-internals path used by normal Desktop launches. Auxiliary UI
  // notifications are no-ops; loading, disposal, registry and fibers are real.
  const loader = new Proxy(host.loader, { get: (target, key) => key === 'internal' ? undefined : typeof target[key] === 'function' ? target[key].bind(target) : target[key] })
  const ctx = Object.create(host); Object.defineProperty(ctx, 'loader', { value: loader })
  const api = vm.runInNewContext('let opChain=Promise.resolve();const OP_HOLD_MAX_MS=30000,HANDOFF_MS=6000,bgOps=new Map();\n' + names.map(name => functions.get(name)).join('\n') + '\n({reload:()=>withOpLock(()=>reloadPackage("dsh-cost-meter",repo))})', {
    ...fs, ...path, ...url, ctx, repo, dshHome: home, profileNodeModules: path.join(home, 'node_modules'),
    setTimeout, clearTimeout, console, logger: { warn() {}, info() {}, error() {} },
    findEntry: () => [...host.loader.entries()].find(entry => String(entry.options.name).includes('dsh-cost-meter')),
    matchesSelf: () => false, bumpDir: () => 1, auditLog() {}, normalizeEntriesByName() {},
  })
  const started = performance.now()
  const result = await bounded('upstream injector reload', () => api.reload())
  assert.match(result, /^OK:/); await host.loader.await()
  for (let n = 0; n < 100 && !host.get('costMeter'); n++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(host.get('costMeter'), result)
  console.log(JSON.stringify({ check: 'upstream super-injector reload implementation', milliseconds: performance.now() - started, result }))
}
