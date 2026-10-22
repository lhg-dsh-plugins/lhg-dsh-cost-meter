import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkSidebarUpdates(page, output) {
  await page.setViewportSize({width:1100,height:1000})
  await page.evaluate(async () => {
    await window.configure({ locale: 'zh' })
    window.setFixtureState({ codexCompat: { installed: true, enabled: true, version: 'synthetic', usage: {} } })
    window.remount()
  })
  await page.getByRole('tab', { name: '显示', exact: true }).click()
  const geometry = await page.locator('.cm-tabs>.cm-tab').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect(), css = getComputedStyle(node)
    return { text: node.textContent, middle: box.top + box.height / 2, left: css.paddingLeft, right: css.paddingRight, height: box.height }
  }))
  assert.ok(geometry.some(row => row.text === 'Codex'))
  assert.ok(geometry.every(row => row.middle === geometry[0].middle && row.left === row.right && row.height === geometry[0].height), 'Codex and every peer tab share center, padding and height')
  await page.getByRole('tab', { name: '侧栏', exact: true }).click()
  const hidingSkin = await page.addStyleTag({ content: 'html body dialog { display:none !important; visibility:hidden !important }' })
  await page.evaluate(async () => {
    window.setFixtureState({ codexCompat: undefined, balance: { status: 'ok', totalBalance: 4.98, grantedBalance: 0, toppedUpBalance: 4.98, currency: 'CNY' }, today: { input: 16400000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 1.23, apiCost: 1.23 } })
    await window.configure({ sidebarSummaryPromptSeen: false, sidebar: true, hideTodayCost: false, hideOfficialBalance: false, hideBudget: true, sidebarModels: { enabled: false }, codexQuotaEnabled: false, balance: { display: 'both' }, peakEnabled: true, peakNotice: true })
    localStorage.removeItem('dsh-cost-meter:sidebar-summary-intro-v1')
    window.showSummaryGuide()
  })
  const guide = page.getByRole('dialog', { name: '新增合并侧栏样式' })
  await page.waitForFunction(() => !document.querySelector('dialog:modal'))
  await hidingSkin.evaluate(node => node.remove())
  await page.evaluate(() => { window.disposeSummaryGuide(); window.showSummaryGuide() })
  await guide.waitFor({ state: 'visible' })
  assert.equal(await guide.evaluate(node => node.matches(':modal')), false, 'update notice does not lock the host')
  await guide.getByRole('button', { name: '使用合并卡片', exact: true }).click()
  await guide.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.current().sidebarStyle === 'summary' && window.current().sidebarSummaryPromptSeen)
  assert.equal(await page.evaluate(() => window.current().sidebarTodayMetric), 'both')
  await page.evaluate(() => { window.disposeSummaryGuide(); window.showSummaryGuide() })
  assert.equal(await guide.count(), 0, 'introduction is not repeated after acknowledgement')
  const sidebar = page.locator('#actual-sidebar')
  await sidebar.evaluate(node => { node.style.position = 'static'; node.style.left = 'auto' })
  for (const width of [352, 280, 220]) {
    await sidebar.evaluate((node, width) => { node.style.width = width + 'px' }, width)
    await page.waitForTimeout(30)
    const fits = await sidebar.evaluate(node => {
      const outer = node.getBoundingClientRect()
      return [...node.querySelectorAll('[data-cm-today],.cm-peak-progress-time')].every(value => { const box = value.getBoundingClientRect(); return box.left >= outer.left - 1 && box.right <= outer.right + 1 })
    })
    assert.equal(fits, true, 'summary tokens, amount and switch time fit at ' + width + 'px')
  }
  await sidebar.evaluate(node => { node.style.width = '280px' })
  const summary = sidebar.locator('.cm-footer-stack.summary')
  assert.equal(await summary.locator('[data-cm-display=today]').count(), 1)
  assert.equal(await summary.locator('[data-cm-display=balance]').count(), 1)
  await summary.locator('.variant-summary').waitFor()
  for (const theme of ['light', 'dark']) {
    const skin = await page.addStyleTag({ content: `#actual-sidebar{--dsw-alias-bg-layer-1:${theme === 'dark' ? '#222' : '#fafafa'};--dsw-alias-bg-layer-2:${theme === 'dark' ? '#303030' : '#fff'};--dsw-alias-label-secondary:${theme === 'dark' ? '#ddd' : '#555'}}` })
    for (const simple of [false, true]) {
      await page.evaluate(simple => window.configure({ sidebarSimple: simple }), simple)
      const card = sidebar.locator('.cm-footer-stack')
      const geometry = await card.evaluate(node => {
        const css = getComputedStyle(node), today = node.querySelector('[data-cm-display=today]'), balance = node.querySelector('[data-cm-display=balance]')
        return { left: css.paddingLeft, right: css.paddingRight, top: css.paddingTop, bottom: css.paddingBottom,
          scroll: node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1,
          today: getComputedStyle(today).backgroundColor, surface: css.backgroundColor, balance: getComputedStyle(balance).backgroundColor,
          height: node.getBoundingClientRect().height, handles: node.querySelectorAll('.cm-order-handle,.cm-order-status').length }
      })
      assert.equal(geometry.scroll, false, 'three-row card has no inner scrollbar')
      assert.equal(geometry.handles, 0)
      if (!simple) {
        assert.equal(geometry.left, geometry.right); assert.equal(geometry.top, geometry.bottom)
        assert.ok(geometry.height < 115, 'summary spacing stays compact')
        assert.equal(geometry.today, 'rgba(0, 0, 0, 0)')
      } else assert.equal(geometry.today, geometry.surface, 'sticky today header uses the same card material')
      assert.equal(geometry.balance, 'rgba(0, 0, 0, 0)')
      await card.screenshot({ path: join(output, `sidebar-${simple ? 'simple' : 'combined'}-${theme}.png`) })
    }
    await skin.evaluate(node => node.remove())
  }
  await page.evaluate(() => window.configure({ sidebarSimple: false }))
  await page.locator('.cm-display-general summary').click()
  const preference = page.getByRole('switch', { name: '弹出 billion-context 计费兼容提醒', exact: true })
  await preference.uncheck()
  await page.waitForFunction(() => window.current().billionContextNoticeEnabled === false)
  await page.evaluate(() => window.disposeSummaryGuide())
  return { combinedCard: true, introductionOnce: true, narrowWidths: [352, 280, 220], codexTabAlignment: true, notificationSetting: true }
}
