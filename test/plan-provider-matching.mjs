import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Ledger, sanitizeConfig, applyConfigPatch, localDayKey } from '../lib/store.js'
import { billingClassOf, planProviderIdOf, enabledPlanSetOf, buildPlanStats } from '../lib/plan-billing.js'
import { inferPlanProviderId } from '../lib/plan-provider-match.js'
import { repairPlanHourBuckets } from '../lib/backfill.js'
import { stateSchema } from '../lib/typert.host.js'
import { qwenTokenPlanWindows, scnetTokenPlanWindows } from '../lib/coding-plans.js'
import { apply } from '../lib/index.js'

const source = readdirSync(new URL('../src/client/', import.meta.url)).filter(name => name.endsWith('.js')).sort()
  .map(name => readFileSync(new URL('../src/client/' + name, import.meta.url), 'utf8')).join('')
let factory, hooks = [], cursor = 0
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: 'fragment', useEffect() {}, useRef: value => ({ current: value }),
  useState: value => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof value === 'function' ? value() : value; return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next }] },
}
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { ModelStatsPanel, makeT, parseConfig, billingClassOfLocal, planProviderIdOfLocal, inferPlanProviderIdLocal }; exports.apply = apply'), {
  window: { __ModuleLoader__: { load: module => { factory = module.factory } }, localStorage: { getItem: () => '1' } }, navigator: { language: 'zh-CN' },
})
const ui = factory(name => name === 'react' ? React : {}).test
const names = [
  ['Codex Plan', 'gpt-6.1-sol', 'codex'], ['ChatGPT subscription', 'm', 'codex'],
  ['my-ark-agent-plan', 'm', 'volcengine-agent'], ['VolcengineAgentPlan', 'm', 'volcengine-agent'],
  ['Tencent Coding Plan', 'm', 'tencent-coding'], ['TokenHubTokenPlan', 'm', 'tencent-token'],
  ['腾讯 Token Plan', 'm', 'tencent-token'], ['腾讯套餐', 'm', null],
  ['Tencent Coding Plan Token Plan', 'm', null], ['OpenCode Go Plus Plan', 'm', 'go'],
  ['Baidu Coding Plan', 'm', 'baidu-coding'], ['千帆套餐', 'm', 'baidu-coding'],
  ['openai', 'gpt-6.1-sol', null], ['tencent', 'hy3', null], ['baidu', 'ernie', null],

  ['my-ark-coding-plan', 'm', 'volcengine'], ['VolcengineCodingPlan', 'm', 'volcengine'],
  ['火山方舟CodingPlan', 'm', 'volcengine'], ['MiniMaxTokenPlan', 'm', 'minimax'],
  ['my-claude-subscription', 'm', 'anthropic'], ['Z.ai CodingPlan', 'm', 'zai'],
  ['kimi-tokenplan', 'm', 'kimi'], ['SCNetPlan', 'm', 'scnet'], ['qwenplan', 'm', 'qwen'],
  ['MiMoTokenPlan', 'm', 'mimo'], ['FactoryPlan', 'm', 'factory'], ['OpenCodeGoPlan', 'm', 'go'],
  ['OpenRouterTokenPlan', 'm', 'openrouter'], ['SiliconFlowPlan', 'm', 'siliconflow'], ['CommandCodePlan', 'm', 'commandcode'],
  // 自定义渠道名:渠道名带 plan 标记 + cline-pass 片段时必须两端都识别为 clinepass。
  ['my-cline-pass-plan', 'm', 'clinepass'], ['ClinePassPlan', 'm', 'clinepass'],
  ['cline-pass-plan', 'm', 'clinepass'], ['relay', 'cline-pass-plan', 'clinepass'], ['cline', 'm', null],
  ['relay', 'ark-coding-plan', 'volcengine'], ['relay', 'claude', null], ['ark-api', 'doubao', null],
  ['my-relay', 'gpt-5.6', null], ['ark-kimi-plan', 'ark-plan', null], ['marketplace', 'm', null],
]
for (const [provider, model, expected] of names) {
  assert.equal(inferPlanProviderId(provider, model), expected, provider)
  assert.equal(ui.inferPlanProviderIdLocal(provider, model), expected, 'client parity: ' + provider)
}
let config = sanitizeConfig({ codingPlans: { volcengine: { enabled: true }, minimax: { enabled: true } } })
assert.equal(planProviderIdOf('llm-VolcEngine'), 'volcengine')
assert.equal(billingClassOf('ark-api', 'm', config.planBilling, enabledPlanSetOf(config)), 'api')
assert.equal(billingClassOf('my-ark-coding-plan', 'm', config.planBilling, enabledPlanSetOf(config)), 'plan')

// Cline Pass:启用后,自定义渠道名的归属在服务端与客户端必须一致
// (客户端投影排除 API 费用,服务端账本也要归 Plan,否则同一调用两端口径不同)。
const clineConfig = sanitizeConfig({ codingPlans: { clinepass: { enabled: true } } })
for (const [provider, model] of [
  ['my-cline-pass-plan', 'm'],
  ['cline-pass', 'm'],
  ['ClinePassPlan', 'm'],
]) {
  assert.equal(planProviderIdOf(provider, clineConfig.planBilling, model), 'clinepass', '服务端 plan id: ' + provider)
  assert.equal(ui.planProviderIdOfLocal(provider, clineConfig, model), 'clinepass', '客户端 plan id: ' + provider)
  assert.equal(billingClassOf(provider, model, clineConfig.planBilling, enabledPlanSetOf(clineConfig)), 'plan', '服务端计费分类: ' + provider)
  assert.equal(ui.billingClassOfLocal(provider, model, clineConfig), 'plan', '客户端计费分类: ' + provider)
}

const key = 'relay:example-model'
// #364: WorkBuddy international calls share the WorkBuddy classification,
// including explicit overrides and the disabled/default API behavior.
const workbuddyModel = 'deepseek-v4.1-flash'
function assertBilling(provider, model, cfg, expected) {
  assert.equal(billingClassOf(provider, model, cfg.planBilling, enabledPlanSetOf(cfg), cfg.prices), expected, 'server: ' + provider)
  assert.equal(ui.billingClassOfLocal(provider, model, cfg), expected, 'client: ' + provider)
}
const workbuddyConfig = sanitizeConfig({ codingPlans: { workbuddy: { enabled: true } } })
for (const provider of ['workbuddy', 'workbuddy-subscription', 'workbuddy-ai', 'llm-workbuddy-ai', ' WorkBuddy-AI ', 'workbuddy-global', 'llm-workbuddy-global']) {
  assert.equal(planProviderIdOf(provider, workbuddyConfig.planBilling, workbuddyModel), 'workbuddy')
  assert.equal(ui.planProviderIdOfLocal(provider, workbuddyConfig, workbuddyModel), 'workbuddy')
  assertBilling(provider, workbuddyModel, workbuddyConfig, 'plan')
  assertBilling(provider, workbuddyModel, sanitizeConfig({}), 'api')
  assertBilling(provider, workbuddyModel, sanitizeConfig({ planBilling: { providers: { workbuddy: 'plan' } } }), 'plan')
  assertBilling(provider, workbuddyModel, sanitizeConfig({ ...workbuddyConfig, planBilling: { providers: { workbuddy: 'api' } } }), 'api')
}
assertBilling('workbuddy-ai', workbuddyModel, sanitizeConfig({ ...workbuddyConfig,
  planBilling: { models: { ['workbuddy-ai:' + workbuddyModel]: 'api' } },
}), 'api')

// Explicit route overrides must survive the real config/RPC/client pipeline.
const routePatch = applyConfigPatch(workbuddyConfig, { planBilling: {
  providers: { 'custom-credits': 'plan', 'workbuddy-ai': 'api', 'workbuddy': 'plan' },
} })
assert.deepEqual(routePatch.errors, [])
const routeConfig = ui.parseConfig(stateSchema.shape.config.parse(routePatch.config), 'config')
assert.equal(routeConfig.planBilling.providers['custom-credits'], 'plan')
assertBilling('custom-credits', 'm', routeConfig, 'plan')
assertBilling('llm-custom-credits', 'm', routeConfig, 'api') // Raw overrides match the request provider exactly.
assertBilling('unconfigured-route', 'm', routeConfig, 'api')
assertBilling('workbuddy-ai', workbuddyModel, routeConfig, 'api')
assertBilling('workbuddy', workbuddyModel, routeConfig, 'plan')
assertBilling('workbuddy-ai', workbuddyModel, sanitizeConfig({ ...routeConfig,
  planBilling: { ...routeConfig.planBilling, models: { ['workbuddy-ai:' + workbuddyModel]: 'plan' } },
}), 'plan')
assertBilling('workbuddy-ai', workbuddyModel, sanitizeConfig({ ...routeConfig,
  planBilling: { providers: { workbuddy: 'plan', 'workbuddy-ai': 'auto' } },
}), 'plan')
assertBilling('custom-credits', 'm', sanitizeConfig({ planBilling: { providers: { 'custom-credits': 'auto' } } }), 'api')
for (const model of ['deepseek-web-search', 'deepseek-web-fetch', 'deepseek-search-api', 'deepseek-fetch-api', 'deepseek-search-server']) {
  assertBilling('deepseek-official', model, sanitizeConfig({ planBilling: {
    providers: { 'deepseek-official': 'plan' }, models: { ['deepseek-official:' + model]: 'plan' },
  } }), 'api')
}
assert.ok(applyConfigPatch(workbuddyConfig, { planBilling: { providers: { ' ': 'plan' } } }).errors.length)
assert.ok(applyConfigPatch(workbuddyConfig, { planBilling: { providers: { 'custom-credits': 'invalid' } } }).errors.length)
assert.equal(sanitizeConfig({ planBilling: { providers: { ' ': 'plan', 'custom-credits': 'invalid' } } }).planBilling.providers[' '], undefined)
assert.equal(sanitizeConfig({ planBilling: { providers: { 'custom-credits': 'invalid' } } }).planBilling.providers['custom-credits'], undefined)

const selected = { providers: config.planBilling.providers, models: { [key]: 'plan' }, modelPlans: { [key]: 'volcengine' } }
const patch = applyConfigPatch(config, { planBilling: selected })
assert.deepEqual(patch.errors, [])
config = ui.parseConfig(stateSchema.shape.config.parse(patch.config), 'config')
assert.equal(config.planBilling.modelPlans[key], 'volcengine', 'assignment survives sanitization, RPC and client decoding')
assert.equal(planProviderIdOf('relay', config.planBilling, 'example-model'), 'volcengine')
assert.equal(ui.planProviderIdOfLocal('relay', config, 'example-model'), 'volcengine')
assert.equal(ui.billingClassOfLocal('relay', 'example-model', config), 'plan')
assert.ok(applyConfigPatch(config, { planBilling: { ...selected, modelPlans: { [key]: 'unknown-plan' } } }).errors.length)
const explicitApi = { ...selected, models: { [key]: 'api' } }
assert.equal(billingClassOf('relay', 'example-model', explicitApi, enabledPlanSetOf(config)), 'api', 'manual API wins over family assignment')
assert.equal(billingClassOf('my-ark-coding-plan', 'm', { models: { 'my-ark-coding-plan:m': 'api' } }, enabledPlanSetOf(config)), 'api', 'manual API wins over inferred subscription')

const creditConfig = sanitizeConfig({ codingPlans: { qwen: { enabled: true }, scnet: { enabled: true } }, planBilling: {
  models: { 'custom:qwen3.7-plus': 'plan', 'custom:GLM-5.2': 'plan', 'custom:deepseek-v4-flash': 'api' },
  modelPlans: { 'custom:qwen3.7-plus': 'qwen', 'custom:GLM-5.2': 'scnet', 'custom:deepseek-v4-flash': 'qwen' },
} })
const creditNow = new Date(2026, 9, 14).getTime()
const creditDays = { '2026-10-14': { byProviderModel: {
  'custom:qwen3.7-plus': { input: 1e6 }, 'custom:GLM-5.2': { input: 1e6 },
  'custom:deepseek-v4-flash': { input: 1e6 }, 'my-qwen-tokenplan:qwen3.7-plus': { input: 1e6 },
  'unassigned:GLM-5.2': { input: 1e6 },
} } }
const includeCredit = (provider, model) => billingClassOf(provider, model, creditConfig.planBilling, enabledPlanSetOf(creditConfig)) === 'plan'
const belongsTo = id => (provider, model) => planProviderIdOf(provider, creditConfig.planBilling, model) === id
assert.equal(qwenTokenPlanWindows(creditDays, { planCredits: 1000 }, creditNow, includeCredit, belongsTo('qwen')).used, 30, 'manual and inferred Qwen attribution, API and other plans excluded')
assert.equal(scnetTokenPlanWindows(creditDays, { planCredits: 60000 }, creditNow, includeCredit, belongsTo('scnet')).used, 7543, 'custom SCNet attribution, shared model names excluded')

const now = Date.now(), root = mkdtempSync(join(tmpdir(), 'cm-plan-matching-'))
const ledgerPath = join(root, 'ledger.json'), logs = join(root, 'sessions')
const dir = join(logs, 'example-project', 'example-session')
mkdirSync(dir, { recursive: true })
const log = join(dir, 'session.jsonl'), at = now - 20 * 60000
const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
const records = [
  { type: 'session', id: 'example-session', createdAt: at - 5000 },
  { type: 'request/header', time: at, data: { header: { config: { provider: 'relay', model: 'example-model' } } } },
  { type: 'assistant/message', seq: 2, time: at + 100, data: { turn: 1, step: 1, usage, content: 'Private text must never enter the ledger' } },
]
writeFileSync(log, records.map(record => JSON.stringify(record)).join('\n') + '\n')
const ledger = new Ledger(sanitizeConfig({ codingPlans: { volcengine: { enabled: true } }, planBilling: { models: { [key]: 'plan' } } }), {}, ledgerPath)
// Calls can belong to yesterday when this test runs shortly after midnight.
const usageDay = target => target.copyDay(target.days[localDayKey(at)])
const stats = () => buildPlanStats({ days: ledger.days, hourBuckets: ledger.planHourBuckets, samples: ledger.planSamples, config: ledger.config, nowMs: now,
  codingPlans: { volcengine: { status: 'ok', windows: { fiveHour: { percent: 10 }, weekly: { percent: 10 }, monthly: { percent: 10 } } } } }).providers.volcengine.windows
try {
  ledger.account({ input: 1000, output: 200 }, 'example-model', 'example-session', at + 100, 'relay')
  assert.equal(stats().fiveHour.localTokens, 0, 'reproduce the previous unassigned Plan call')
  const original = usageDay(ledger)
  ledger.config = sanitizeConfig({ ...ledger.config, planBilling: selected })
  ledger.planSamples = { volcengine: { fiveHour: [{ t: at, p: 10, lt: 0, lc: 0 }] }, minimax: { fiveHour: [{ t: at, p: 5, lt: 10, lc: 0 }] } }
  await repairPlanHourBuckets(ledger, logs, { nowMs: now })
  for (const value of Object.values(stats())) assert.equal(value.localTokens, 1200, 'replayed call is counted in its actual windows')
  assert.equal(usageDay(ledger).calls, original.calls)
  assert.equal(usageDay(ledger).cost, original.cost)
  assert.equal(ledger.planSamples.volcengine, undefined, 'incompatible per-1% sample baseline is discarded')
  assert.ok(ledger.planSamples.minimax, 'unrelated sample history remains')
  await repairPlanHourBuckets(ledger, logs, { nowMs: now })
  assert.equal(stats().fiveHour.localTokens, 1200, 'repair is idempotent')
  const baseline = readFileSync(ledgerPath, 'utf8')
  await repairPlanHourBuckets(ledger, logs, { nowMs: now, isActive: () => false })
  assert.equal(readFileSync(ledgerPath, 'utf8'), baseline, 'disposed jobs never write')
  assert.ok(!baseline.includes('Private text'), 'only usage metadata is persisted')

  ledger.account({ input: 300 }, 'example-model', 'example-session', at + 1000, 'relay')
  await repairPlanHourBuckets(ledger, logs, { nowMs: now })
  assert.equal(stats().fiveHour.localTokens, 1500, 'incomplete replay cannot overwrite a newer live call')
  appendFileSync(log, JSON.stringify({ type: 'assistant/message', seq: 3, time: at + 1000, data: { turn: 1, step: 2, usage: { ...usage, inputTokens: 300, outputTokens: 0 } } }) + '\n')
  await repairPlanHourBuckets(ledger, logs, { nowMs: now })
  assert.equal(stats().fiveHour.localTokens, 1500, 'complete replay still counts both calls once')
  const reopened = Ledger.load(ledgerPath)
  try { assert.equal(reopened.config.planBilling.modelPlans[key], 'volcengine'); assert.equal(usageDay(reopened).calls, 2) } finally { reopened.close() }

  // A complete replay prepared before another process writes must not replace its call.
  let repairs
  const commitRepair = ledger.repairPlanHours.bind(ledger)
  ledger.repairPlanHours = value => { repairs = value }
  await repairPlanHourBuckets(ledger, logs, { nowMs: now })
  ledger.repairPlanHours = commitRepair
  const other = Ledger.load(ledgerPath)
  try { other.account({ input: 10 }, 'example-model', 'example-session', at + 2000, 'relay'); other.flush() } finally { other.close() }
  commitRepair(repairs)
  assert.equal(usageDay(ledger).calls, 3, 'concurrent calls are retained under the write lock')
  assert.equal(stats().fiveHour.localTokens, 1510, 'stale maintenance operations cannot erase concurrent hourly usage')

  let draft = ledger.config
  const day = usageDay(ledger)
  const state = { config: draft, today: day, month: day, total: day, history: [day], meta: { dayKey: day.date } }
  const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(nodes)] : []
  const t = ui.makeT('zh')
  hooks = ['today', true]
  const render = () => { cursor = 0; return ui.ModelStatsPanel({ state, config: draft, draft, setDraft: value => { draft = value }, t }) }
  const select = () => nodes(render()).find(node => node.type === 'select' && node.props.title === t('billingClassLabel'))
  assert.equal(select().props.value, 'plan:volcengine')
  assert.ok(nodes(select()).some(node => node.type === 'option' && node.props.value === 'plan:minimax'), 'all plan families can be selected')
  for (const id of ['codex', 'volcengine-agent', 'tencent-coding', 'tencent-token', 'baidu-coding']) {
    assert.ok(nodes(select()).some(node => node.type === 'option' && node.props.value === 'plan:' + id), id + ' option')
    select().props.onChange({ target: { value: 'plan:' + id } })
    const saved = applyConfigPatch(ledger.config, { planBilling: draft.planBilling })
    assert.deepEqual(saved.errors, [])
    const roundTrip = ui.parseConfig(stateSchema.shape.config.parse(saved.config), 'config')
    assert.equal(roundTrip.planBilling.modelPlans[key], id)
    assert.equal(billingClassOf('relay', 'example-model', roundTrip.planBilling, enabledPlanSetOf(roundTrip)), 'plan')
    assert.equal(ui.billingClassOfLocal('relay', 'example-model', roundTrip), 'plan')
  }
  select().props.onChange({ target: { value: 'plan:minimax' } })
  assert.equal(draft.planBilling.modelPlans[key], 'minimax', 'selecting another family changes attribution')
  select().props.onChange({ target: { value: 'api' } })
  assert.equal(draft.planBilling.models[key], 'api')
  assert.equal(draft.planBilling.modelPlans[key], undefined, 'manual API removes the family assignment')
  assert.deepEqual(applyConfigPatch(ledger.config, { planBilling: draft.planBilling }).errors, [])

  const previousHome = process.env.DSH_HOME, disposers = []
  try {
    const home = join(root, 'service'), storage = join(home, 'storages', 'cost-meter'), session = join(home, 'sessions', 'project', 'example-session')
    mkdirSync(storage, { recursive: true }); mkdirSync(session, { recursive: true })
    writeFileSync(join(session, 'session.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n')
    const serviceConfig = sanitizeConfig({ hideOfficialBalance: true, goQuota: { enabled: false }, planBilling: { models: { [key]: 'plan' } } })
    const serviceLedger = new Ledger(serviceConfig, {}, join(storage, 'ledger.json'))
    serviceLedger.account({ input: 1000, output: 200 }, 'example-model', 'example-session', at + 100, 'relay'); serviceLedger.close()
    process.env.DSH_HOME = home
    let service
    apply({ on: () => () => {}, inject() {}, get: name => name === 'settings' ? { get: () => ({}) } : undefined,
      effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
      provide: (name, value) => { if (name === 'costMeter') service = value }, logger: console })
    const saved = await service.updateConfig({ planBilling: selected })
    assert.equal(saved.config.planBilling.modelPlans[key], 'volcengine', 'actual RPC saves the selected family')
    const deadline = Date.now() + 3000
    let stored
    do {
      await new Promise(resolve => setTimeout(resolve, 50))
      stored = JSON.parse(readFileSync(join(storage, 'ledger.json'), 'utf8'))
    } while (!stored.planHourBuckets.volcengine && Date.now() < deadline)
    assert.equal(Object.values(stored.planHourBuckets.volcengine ?? {}).reduce((sum, bucket) => sum + bucket.tokens, 0), 1200, 'actual service schedules and persists historical attribution')
    assert.equal(stored.days[original.date].calls, 1)
    // Closing the plugin also cancels a queued reassignment repair.
    await service.updateConfig({ planBilling: { ...selected, modelPlans: { [key]: 'minimax' } } })
  } finally {
    for (const dispose of disposers.reverse()) await dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
} finally { ledger.close(); rmSync(root, { recursive: true, force: true }) }
console.log('[ok] 自定义套餐归属：双端自动识别与歧义、手动优先、配置持久化、历史小时恢复、防重复与覆盖保护、实际 UI 选择')
