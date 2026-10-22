import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { sanitizeConfig } from '../lib/store.js'

const dir = new URL('../src/client/', import.meta.url)
const src = readdirSync(dir).filter(n => n.endsWith('.js')).sort().map(n => readFileSync(new URL(n, dir), 'utf8')).join('')
let factory
const now = Date.parse('2026-09-10T07:00:00Z')
class Clock extends Date { static now() { return now } }
const el = (type, props, ...children) => ({ type, props: props ?? {}, children })
vm.runInNewContext(src.replace('exports.apply = apply', 'exports.test = { SidebarFooter, BudgetBoxContent, BalanceBox, BalanceRowContent, codexQuotaCache }; exports.apply = apply'), {
  Date: Clock, navigator: { language: 'zh' }, window: { __ModuleLoader__: { load: v => { factory = v.factory } }, localStorage: { getItem: () => null } },
})
const ui = factory(name => name === 'react' ? { createElement: el, Fragment: 'fragment', useRef: value => ({ current: value }), useEffect() {}, useState: value => [typeof value === 'function' ? value() : value, () => {}] } : { Tooltip: 'tooltip' }).test
const render = n => Array.isArray(n) ? n.map(render) : n && typeof n === 'object'
  ? typeof n.type === 'function' ? render(n.type(n.props)) : { ...n, children: n.children.map(render) } : n
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.children)] : []
const text = n => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.children) : n == null ? '' : String(n)
const hasClass = (n, cls) => n.props.className?.split(' ').includes(cls)
ui.codexQuotaCache.status = 'off'
const totals = cost => ({ cost, apiCost: cost, calls: 1, input: 100, output: 20, cacheRead: 0, cacheWrite: 0 })
const state = { today: totals(1 / 7.2), month: totals(8 / 7.2), total: totals(9 / 7.2), budgetUsed: 8 / 7.2,
  balance: { status: 'ok', totalBalance: 47.68, grantedBalance: 0, toppedUpBalance: 47.68, currency: 'CNY', fetchedAt: now },
  codingPlans: {}, gatewayQuotas: { sources: [] }, goQuota: { status: 'ok', rolling: { percent: 20 }, weekly: { percent: 40 }, monthly: { percent: 60 }, fetchedAt: now } }

let combinations = 0
for (const sidebarSimple of [false, true]) for (const wide of [false, true]) for (const budget of [false, true])
for (const hideTodayCost of [false, true]) for (const peakEnabled of [false, true]) for (const peakNotice of [false, true])
for (const peakStyle of ['compact', 'classic']) for (const go of [false, true]) {
  state.config = sanitizeConfig({ sidebarSimple, hideTodayCost, peakEnabled, peakNotice, peakStyle,
    balance: { display: 'sidebar', showProgressBar: true }, budget: { enabled: budget, amount: 10 }, goQuota: { enabled: go, display: 'sidebar' } })
  const tree = render(ui.SidebarFooter({ wide, useCost: pick => pick({ state }) }))
  for (const tooltip of nodes(tree).filter(n => n.type === 'tooltip')) {
    assert.equal(tooltip.props.portal, true, '侧栏提示挂到宿主浮层，避免被相邻插件的层级或裁剪遮住')
  }
  const peakClasses = ['cm-peak-strip', 'cm-peak-classic', 'cm-peak-rail', 'cm-peak-rail-classic']
  const strips = nodes(tree).filter(n => peakClasses.some(cls => hasClass(n, cls)))
  const expected = peakEnabled && peakNotice ? 1 : 0
  assert.equal(strips.length, expected, JSON.stringify({ sidebarSimple, wide, budget, hideTodayCost, peakEnabled, peakNotice, peakStyle, go }))
  if (expected) assert.ok(hasClass(strips[0], wide ? peakStyle === 'classic' ? 'cm-peak-classic' : 'cm-peak-strip' : peakStyle === 'classic' ? 'cm-peak-rail-classic' : 'cm-peak-rail'))
  const summaries = nodes(tree).filter(n => hasClass(n, 'cm-simple-summary'))
  assert.equal(summaries.length, sidebarSimple && wide ? Number(!hideTodayCost) + Number(budget) : 0)
  if (sidebarSimple && wide && budget) {
    const summary = summaries.find(n => n.props['data-cm-display'] === 'budget')
    assert.match(text(summary), /预算\(本月\).*¥8 \/ ¥10/)
    assert.ok(hasClass(summary, 'warn'), '预算摘要按本月已用 80% 预警')
    assert.ok(nodes(tree).some(n => n.type === 'tooltip' && String(n.props.label).includes('80.0%')))
  }
  combinations++
}

for (const [period, label, used] of [['day', '今日', 1], ['month', '本月', 8], ['all', '累计', 9], ['custom', '自定义区间', 5]]) {
  state.config = sanitizeConfig({ locale: 'zh', sidebarSimple: true, budget: { enabled: true, amount: 10, period, customStart: '2026-09-01', customEnd: '2026-09-10' } })
  state.budgetUsed = used / 7.2
  const tree = render(ui.BudgetBoxContent({ state, wide: true, summary: true }))
  assert.ok(text(tree).includes(`预算(${label})`))
  assert.match(String(tree.props.label), new RegExp(`已用 ¥${used} / ¥10`))
}
for (const sidebarSimple of [false, true]) for (const sidebarStyle of ['standard', 'compact']) for (const wide of [false, true])
for (const budget of [false, true]) for (const today of [false, true]) for (const peak of [false, true]) for (const detail of [false, true]) {
  state.config = sanitizeConfig({ locale: 'zh', sidebarSimple, sidebarStyle, sidebar: today, hideTodayCost: !today,
    hideOfficialBalance: true, balance: { display: 'off' }, goQuota: { enabled: false }, sidebarModels: { enabled: false },
    budget: { enabled: true, amount: 10, detail }, hideBudget: !budget, peakEnabled: true, peakNotice: peak })
  const tree = render(ui.SidebarFooter({ wide, useCost: pick => pick({ state }) }))
  const marked = key => nodes(tree).filter(n => n.props['data-cm-display'] === key)
  assert.equal(marked('budget').length, Number(budget), 'budget visibility is independent of today and peak')
  assert.equal(marked('today').length, Number(today), 'today remains visible with a hidden budget or collapsed budget details')
  assert.equal(nodes(tree).filter(n => ['cm-peak-strip','cm-peak-rail'].some(cls => hasClass(n, cls))).length, Number(peak), 'peak works as the only visible component')
  for (const card of marked('budget')) assert.equal(nodes(card).filter(n => ['today','peak'].includes(n.props['data-cm-display'])).length, 0, 'budget does not own sibling display targets')
  assert.equal(tree === null, !budget && !today && !peak, 'all hidden leaves no empty footer')
  combinations++
}
let stopped = 0
const box = render(ui.BalanceBox({ state, wide: true }))
const link = nodes(box).find(n => n.type === 'a')
assert.equal(link.props.href, 'https://platform.deepseek.com/usage')
assert.equal(link.props.target, '_blank')
assert.ok(nodes(link).some(n => n.type === 'svg'), '充值链接使用矢量图标且保留无障碍名称')
assert.ok(link.props['aria-label'])
link.props.onClick({ stopPropagation: () => { stopped++ } })
link.props.onKeyDown({ stopPropagation: () => { stopped++ } })
assert.equal(stopped, 2, '充值链接不触发外层余额刷新')
console.log(`[ok] #122/#123：${combinations} 种组合的峰谷条唯一性、隐藏项、预算周期/合并口径及充值图标交互`)
