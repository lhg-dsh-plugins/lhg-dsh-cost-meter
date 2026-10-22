/**
 * issue #300 defense-in-depth: a session row whose frozen FX amount is a finite 0
 * (legacy row / lost merge) must fall back to the recorded USD amount instead of
 * displaying ¥0, while genuine frozen amounts stay authoritative.
 */
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(name => name.endsWith('.js')).sort()
  .map(name => readFileSync(new URL(name, dir), 'utf8')).join('')
let factory
vm.runInNewContext(source.replace('exports.apply = apply',
  'exports.test = { displayCostOf, sessionCostParts, modelCostDetail, formatMoneyUsd }; exports.apply = apply'), {
  navigator: { language: 'zh' },
  window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: () => null } },
})
const ui = factory(name => name === 'react'
  ? { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), Fragment: 'fragment',
      useRef: value => ({ current: value }), useEffect() {}, useState: value => [typeof value === 'function' ? value() : value, () => {}] }
  : { Tooltip: 'tooltip' }).test
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? 'amount'}: ${actual} != ${expected}`)

const config = { currency: 'CNY', exchangeRate: 7.2, symbol: '¥', decimals: 4, showTotalWithPlan: false }
// Fields dropped by the pre-fix merge / never written by 1.8.26 exist as finite 0.
const lostFrozen = { cost: 1, apiCost: 1, costCny: 0, apiCostCny: 0, costEur: 0, apiCostEur: 0 }
assert.equal(ui.displayCostOf(lostFrozen, config), 1, 'finite 0 frozen CNY falls back to the recorded USD cost')
assert.equal(ui.formatMoneyUsd(ui.displayCostOf(lostFrozen, config), config), '¥7.2', 'fallback renders the real cost in the display currency')
assert.equal(ui.displayCostOf(lostFrozen, { ...config, showTotalWithPlan: true }), 1, 'total-equivalent view also falls back')
assert.equal(ui.displayCostOf({ cost: 2, apiCost: 2 }, config), 2, 'missing frozen fields fall back')
assert.equal(ui.displayCostOf(lostFrozen, { ...config, currency: 'EUR' }), 1, 'EUR display falls back too')
assert.equal(ui.displayCostOf(lostFrozen, { ...config, currency: 'USD' }), 1, 'USD display ignores frozen fields')

// Genuine frozen amounts (including historical rates) remain authoritative.
const historical = { cost: 1, apiCost: 1, costCny: 5, apiCostCny: 5, costEur: 0.8, apiCostEur: 0.8 }
near(ui.displayCostOf(historical, config), 5 / 7.2, 'non-zero frozen CNY stays authoritative')
near(ui.displayCostOf({ cost: 1, apiCost: 2, costCny: 7.2, apiCostCny: 10 }, config), 10 / 7.2, 'API basis reads apiCostCny')
assert.equal(ui.displayCostOf({ cost: 1, apiCost: 0, costCny: 7.2, apiCostCny: 0 }, config), 0, 'a genuine 0 API cost stays 0')
assert.equal(ui.formatMoneyUsd(ui.displayCostOf(historical, config), config), '¥5')

// Session badge: the finite 0 path must not report a ¥0 session/Plan split.
const badgeUsage = { cost: 0.5, apiCost: 0.2, costCny: 0, apiCostCny: 0, costEur: 0, apiCostEur: 0 }
const apiParts = ui.sessionCostParts(badgeUsage, config)
near(apiParts.cost, 0.2, 'session badge shows the API-basis cost instead of 0')
near(apiParts.planPart, 0.3, 'session badge plan part is derived from the real total')
const totalParts = ui.sessionCostParts(badgeUsage, { ...config, showTotalWithPlan: true })
near(totalParts.cost, 0.5, 'with-plan badge uses the real total')
assert.equal(totalParts.planPart, 0)

// Per-channel details follow the same fallback.
const detail = ui.modelCostDetail({ byProviderModel: {
  'deepseek:deepseek-v4-flash': { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0.5, apiCost: 0.5, costCny: 0, apiCostCny: 0, costEur: 0, apiCostEur: 0 },
  'deepseek:deepseek-v4-pro': { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0.5, apiCost: 0.5, costCny: 4, apiCostCny: 4, costEur: 0.6, apiCostEur: 0.6 },
} }, config)
assert.match(detail, /deepseek:DeepSeek V4.1 Flash ¥3\.6/, 'channel detail falls back to the USD amount')
assert.match(detail, /deepseek:deepseek-v4-pro ¥4/, 'channel detail keeps the frozen amount when present')

console.log('[ok] issue #300: client display falls back from finite ¥0 frozen FX to recorded USD cost (badge, totals, channel details)')
