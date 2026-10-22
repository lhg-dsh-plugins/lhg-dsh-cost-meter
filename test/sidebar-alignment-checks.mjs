import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkSidebarAlignment(page, output) {
  await page.evaluate(async () => {
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.removeAttribute('style')
    window.setFixtureState({
      balance: { status: 'ok', totalBalance: 129.8025, grantedBalance: 0, toppedUpBalance: 129.8025, currency: 'CNY' },
      today: { input: 1200000, output: 12000, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 1.3744, apiCost: 1.3744, byProviderModel: {
        'deepseek-account:deepseek-v4.1-flash': { input: 1100000, output: 10000, cost: 1.3483, apiCost: 1.3483 },
        'deepseek-official:deepseek-v4.1-flash': { input: 100000, output: 2000, cost: 0.0261, apiCost: 0.0261 },
      } },
      modelLabels: {
        'deepseek-account:deepseek-v4.1-flash': 'DeepSeek Account:DeepSeek V4.1 Flash',
        'deepseek-official:deepseek-v4.1-flash': 'deepseek-official:DeepSeek V4.1 Flash',
      },
    })
    await window.configure({
      locale: 'zh', sidebar: false, hideBudget: true, sidebarTodayBalanceInline: false,
      sidebarOrder: ['peak', 'balance', 'models'], hideOfficialBalance: false,
      balance: { display: 'sidebar', showProgressBar: false },
      sidebarModels: { enabled: true, defaultOpen: true, remember: false, summary: 'total', period: 'today', shares: true },
    })
  })
  const sidebar = page.locator('#actual-sidebar')
  const header = sidebar.locator('.cm-model-costs .cm-collapse-h')
  for (const layout of ['standard', 'compact', 'summary', 'simple']) {
    await page.evaluate(layout => window.configure({ sidebarStyle: layout === 'simple' ? 'standard' : layout, sidebarSimple: layout === 'simple' }), layout)
    for (const peakStyle of ['compact', 'classic', 'progress']) {
      await page.evaluate(peakStyle => window.configure({ peakStyle }), peakStyle)
      await sidebar.locator(peakStyle === 'progress' ? '.cm-peak-progress-track' : '.cm-peak-track').waitFor()
      for (const width of [352, 280, 220]) {
        await sidebar.evaluate((node, width) => { node.style.width = width + 'px' }, width)
        const geometry = await sidebar.evaluate(node => {
          const rect = selector => node.querySelector(selector).getBoundingClientRect()
          const balance = rect('[data-cm-display=balance] .cm-balance-name')
          const peak = rect('.cm-peak-track,.cm-peak-progress:not(.variant-compact) .cm-peak-progress-track,.variant-compact .cm-peak-progress-phase')
          const label = rect('[data-cm-display=models] .cm-bal-label')
          const amount = rect('[data-cm-display=balance] .cm-bal-amt')
          const modelAmounts = [...node.querySelectorAll('[data-cm-display=models] .cm-bal-amt')].map(n => n.getBoundingClientRect().right)
          const modelLabels = [...node.querySelectorAll('.cm-model-costs .cm-bbox-head>.cm-bal-label')].map(n => n.getBoundingClientRect().left)
          return { left: [balance.left, peak.left, label.left, ...modelLabels], right: [amount.right, ...modelAmounts], overflow: node.scrollWidth > node.clientWidth + 1 }
        })
        const context = `${layout}/${peakStyle}/${width}`
        assert.ok(Math.max(...geometry.left) - Math.min(...geometry.left) <= 1, context + ' label and track left edges align: ' + geometry.left)
        assert.ok(Math.max(...geometry.right) - Math.min(...geometry.right) <= 1, context + ' amounts share the right edge: ' + geometry.right)
        assert.equal(geometry.overflow, false, context + ' fits without horizontal scrolling')
      }
    }
  }
  await page.evaluate(() => window.configure({ sidebarStyle: 'standard', sidebarSimple: false, peakStyle: 'compact' }))
  await sidebar.evaluate(node => { node.style.width = '280px' })
  await header.waitFor()
  await page.mouse.move(0, 0)
  await sidebar.screenshot({ path: join(output, 'sidebar-alignment-expanded.png') })
  const before = await header.locator('.cm-bal-label').boundingBox()
  await header.click()
  assert.equal(await header.getAttribute('aria-expanded'), 'false')
  const after = await header.locator('.cm-bal-label').boundingBox()
  assert.equal(after.x, before.x, 'collapsing keeps the heading aligned')
  await header.focus()
  await page.keyboard.press('Enter')
  assert.equal(await header.getAttribute('aria-expanded'), 'true', 'keyboard expansion still works')
  await page.evaluate(async () => {
    const plans = { minimax: {}, zai: {}, volcengine: {}, workbuddy: {} }
    const windows = { '5h': { percent: 7 }, weekly: { percent: 35 }, monthly: { percent: 100 } }
    window.setFixtureState({
      goQuota: { status: 'ok', rolling: { percent: 7 }, weekly: { percent: 35 }, monthly: { percent: 14 } },
      codingPlans: Object.fromEntries(Object.keys(plans).map(id => [id, { status: 'ok', windows }])),
      customBalances: [{ status: 'ok', remaining: 88, spend: 12, maxBudget: 100, unit: 'CNY' }],
      displayPreviewCodex: { status: 'ok', windows: { five: { percent: 19 }, weekly: { percent: 76 } } },
      gatewayQuotas: [{ id: 'alignment', status: 'ok', accounts: [{ id: 'a', label: 'Test account', provider: 'codex', status: 'ok', windows: [{ id: 'five', label: '5h', percent: 12 }, { id: 'weekly', label: '7d', percent: 42 }] }] }],
    })
    await window.configure({
      sidebar: true, hideTodayCost: false, hideBudget: false, budget: { enabled: true, amount: 200 },
      sidebarTodayMetric: 'both', codexQuotaEnabled: true, codexQuotaSidebar: true,
      goQuota: { enabled: true, display: 'sidebar' },
      codingPlans: Object.fromEntries(Object.keys(plans).map(id => [id, { enabled: true, display: 'sidebar' }])),
      customBalances: [{ enabled: true, label: '自定义服务余额', unit: 'CNY', display: 'sidebar', refreshMinutes: 15, request: { url: 'https://example.invalid', method: 'GET' }, extract: { remaining: 'balance' } }],
      gatewayQuotas: { sources: [{ id: 'alignment', type: 'cliproxyapi', label: 'CLIProxyAPI 网关额度', baseURL: 'https://example.invalid', enabled: true, display: 'sidebar', refreshMinutes: 5, includeProviders: ['codex'], allowedHosts: ['example.invalid'], allowInsecureHttp: false }] },
    })
    const host = document.createElement('div')
    host.id = 'alignment-all'
    host.style.cssText = 'width:280px;font-size:14px;line-height:1.6'
    document.body.append(host)
    window.attachFixtureSidebar(host, true)
  })
  const all = page.locator('#alignment-all')
  await all.locator('[data-cm-display=codex] .cm-mm-row').first().waitFor()
  for (const layout of ['standard', 'compact', 'summary', 'simple']) {
    await page.evaluate(layout => window.configure({ sidebarStyle: layout === 'simple' ? 'standard' : layout, sidebarSimple: layout === 'simple' }), layout)
    for (const width of [352, 280, 220]) {
      await all.evaluate((node, width) => { node.style.width = width + 'px' }, width)
      const cards = await all.locator('[data-cm-display]').evaluateAll(nodes => nodes.map(node => ({
        key: node.dataset.cmDisplay, left: node.firstElementChild.getBoundingClientRect().left,
        overflow: node.scrollWidth > node.clientWidth + 1,
      })))
      assert.deepEqual([...new Set(cards.map(c => c.key))].sort(), ['balance', 'budget', 'codex', 'customBalance', 'gateway', 'go', 'models', 'peak', 'plan', 'today'])
      assert.ok(Math.max(...cards.map(c => c.left)) - Math.min(...cards.map(c => c.left)) <= 1, `${layout}/${width} all component content aligns: ` + JSON.stringify(cards))
      assert.ok(cards.every(c => !c.overflow), `${layout}/${width} cards fit: ` + JSON.stringify(cards))
    }
    await all.evaluate(node => { node.style.width = '280px' })
    await all.screenshot({ path: join(output, `sidebar-all-${layout}.png`) })
    if (layout === 'simple') {
      const card = all.locator('.cm-footer-stack')
      assert.equal(await card.evaluate(node => getComputedStyle(node).scrollbarWidth), 'none', 'simple card hides its scrollbar and arrow buttons')
      assert.ok(await card.evaluate(node => node.scrollHeight > node.clientHeight), 'many visible components still have scrollable content')
      await card.focus()
      await card.press('End')
      await page.waitForFunction(() => document.querySelector('#alignment-all .cm-footer-stack').scrollTop > 0)
    }
  }
  return { layouts: 4, peakStyles: 3, components: 10, widths: [352, 280, 220], headingAndAmountAlignment: true }
}
