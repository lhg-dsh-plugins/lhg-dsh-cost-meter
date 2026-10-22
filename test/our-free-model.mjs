import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Ledger, sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { providerPriceEntryFor } from '../lib/pricing.js'
import { replaySessionRecords } from '../lib/backfill.js'
import { costFromSamples } from '../lib/turn-cost.js'
import { ourFreeModelStatus } from '../lib/our-free-model.js'

const routes = ['our-free-model', 'our-free-model-region']
const free = Object.fromEntries(routes.map(route => [route + ':*', '__free__']))
const at = Date.now(), root = mkdtempSync(join(tmpdir(), 'cm-our-free-'))
const config = sanitizeConfig({ priceOverrides: free, exchangeRate: 7.2 })
assert.deepEqual(applyConfigPatch(sanitizeConfig({}), { priceOverrides: free }).errors, [])
for (const route of [...routes, 'llm-our-free-model']) {
  const price = providerPriceEntryFor(route, 'deepseek-v4.1-flash', config.prices, { overrides: free })
  assert.equal(price.priced, true, 'free is a known zero price, not a missing quote')
  assert.equal(price.entry.output, 0)
}
assert.ok(providerPriceEntryFor('deepseek', 'deepseek-v4.1-flash', config.prices, { overrides: free }).entry.output > 0)
assert.equal(ourFreeModelStatus({ registry: new Map([[1, { name: 'our-free-model', fibers: [{ state: 2 }] }]]) })?.enabled, true)
for (const state of [0, 1, 3]) assert.equal(ourFreeModelStatus({ registry: new Map([[1, { name: 'our-free-model', fibers: [{ state }] }]]) }), null)
assert.equal(ourFreeModelStatus({ get: () => ({ entries: () => [{ options: { name: 'dsh-our-free-model' }, disabled: true, fiber: { state: 2 } }] }) }), null)
assert.equal(ourFreeModelStatus({}), null)
let uiFactory
vm.runInNewContext(readFileSync(new URL('../src/pricing/index.js', import.meta.url),'utf8').replace('return { mount, CONTRIBUTION }','return { mount, CONTRIBUTION, OurFreeModelSettings }'), {window:{__ModuleLoader__:{load:mod=>{uiFactory=mod.factory}}}})
const element=(type,props,...children)=>({type,props:props??{},children})
const {OurFreeModelSettings}=uiFactory(name=>name==='react'?{createElement:element}:{})
let draft={priceOverrides:{'other:model':'deepseek:__default__'}}
const props={state:{config,ourFreeModel:{enabled:true}},draft,setDraft:next=>{draft=next},locale:'zh'}
assert.equal(OurFreeModelSettings({...props,state:{config}}),null)
const control=OurFreeModelSettings(props).children.find(node=>node?.type==='label').children.find(node=>node?.type==='input')
control.props.onChange({target:{checked:true}})
assert.equal(draft.priceOverrides['our-free-model:*'],'__free__')
assert.equal(draft.priceOverrides['other:model'],'deepseek:__default__')
OurFreeModelSettings({...props,draft}).children.find(node=>node?.type==='label').children.find(node=>node?.type==='input').props.onChange({target:{checked:false}})
assert.equal(draft.priceOverrides['our-free-model:*'],undefined)
const ledger = new Ledger(config, {}, join(root, 'ledger.json'))
try {
  for (const route of routes) ledger.account({ input: 1000000, output: 1000, cacheRead: 20, cacheWrite: 30, reasoning: 40 }, 'deepseek-v4.1-flash', 'free-test', at, route)
  assert.equal(ledger.sumDays().cost, 0)
  assert.equal(ledger.sumDays().apiCost, 0)
  assert.equal(ledger.sumDays().input, 2000000)
  ledger.account({ input: 1000000, output: 1000 }, 'deepseek-v4.1-flash', 'free-test', at + 1, 'deepseek')
  assert.ok(ledger.sumDays().cost > 0, 'same model through another provider remains paid')
  const records = [
    { type: 'session', id: 'free-replay', createdAt: at },
    { type: 'request/header', seq: 1, time: at, data: { header: { config: { provider: routes[0], model: 'deepseek-v4.1-flash' } } } },
    { type: 'step/start', seq: 2, time: at, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: 3, time: at + 1, data: { turn: 1, step: 1, message: { source: { provider: routes[0], model: 'deepseek-v4.1-flash' } }, usage: { inputTokens: 1000000, outputTokens: 1000 } } },
  ]
  const { samples } = replaySessionRecords(records, config, null, true)
  assert.ok(samples.length > 0)
  const detail = costFromSamples(samples, config)
  assert.equal(detail.cost, 0)
  assert.ok(detail.rows.length > 0 && detail.rows.every(row => row.rate === 0 && row.cost === 0))
  const noFree = { ...config, priceOverrides: {} }
  assert.ok(costFromSamples(replaySessionRecords(records, noFree, null, true).samples, noFree).cost > 0)
  // Optional actual published provider source, supplied by CI without executing its plugin entry point.
  if (process.env.DSH_TEST_FREE_MODEL_DIR) {
    const { FreeModelAdapter, ROUTE_MAIN, ROUTE_REGION } = await import(pathToFileURL(resolve(process.env.DSH_TEST_FREE_MODEL_DIR, 'src/adapter.js')).href)
    assert.deepEqual([ROUTE_MAIN, ROUTE_REGION], routes)
    const adapter = new FreeModelAdapter({ state: () => ({ catalog: [], membership: {}, settings: {} }) })
    for (const route of routes) assert.equal(adapter.providerInfo(route).id, route)
  }
  console.log('[ok] our-free-model: active-runtime detection, explicit route-only free mode, real tokens, paid siblings and replay/detail consistency')
} finally {
  ledger.close()
  assert.ok(root.startsWith(join(tmpdir(), 'cm-our-free-')))
  rmSync(root, { recursive: true, force: true })
}
