import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkInlineBalance(page, output) {
  const initial = await page.evaluate(() => window.current())
  const host = page.locator('#actual-sidebar')
  const row = key => host.locator('[data-cm-display="' + key + '"]').first()
  const inline = page.getByRole('switch', { name: '今日消费与余额同行', exact: true })
  await page.evaluate(() => {
    window.setFixtureState({ balance: { status: 'ok', totalBalance: 120, grantedBalance: 20, toppedUpBalance: 100, currency: 'CNY', fetchedAt: Date.now() } })
    document.getElementById('actual-sidebar').style.cssText = 'position:relative;width:311px;font-size:14px;line-height:1.6'
  })
  const oldHeight = await host.evaluate(n => n.getBoundingClientRect().height)
  await inline.check()
  await page.waitForFunction(() => window.current().sidebarTodayBalanceInline === true && document.querySelector('#actual-sidebar .cm-inline-ready'))
  assert.equal(await page.evaluate(() => window.current().sidebarTodayMetric), 'cost')
  assert.equal(await page.evaluate(() => window.current().sidebarStyle), initial.sidebarStyle, 'switch does not select a new layout')
  const sameRow = async () => {
    const a = await row('today').boundingBox(), b = await host.locator('.cm-inline-balance').boundingBox()
    assert.ok(Math.abs(a.y - b.y) <= 1 && a.x + a.width <= b.x, 'today and balance occupy one row without overlap')
  }
  await sameRow()
  await row('balance').click()
  await page.waitForFunction(() => window.balanceRefreshes === 1 && !document.querySelector('#actual-sidebar .busy') && document.querySelector('#actual-sidebar .cm-inline-balance'))
  await sameRow()
  assert.ok(await host.evaluate(n => n.getBoundingClientRect().height) < oldHeight, 'inline setting reduces sidebar height')
  assert.match(await row('today').getAttribute('data-test-tooltip'), /调用|请求/)
  assert.match(await row('balance').getAttribute('data-test-tooltip'), /赠送.*充值/)
  for (const mode of ['standard', 'compact', 'summary', 'simple']) for (const metric of ['cost', 'tokens', 'both']) {
    await page.evaluate(({ mode, metric }) => window.configure({ sidebarStyle: mode === 'simple' ? 'standard' : mode, sidebarSimple: mode === 'simple', sidebarTodayMetric: metric, balance: { ...window.current().balance, showProgressBar: true, budgetCap: 200 } }), { mode, metric })
    await sameRow()
    assert.ok(await row('balance').locator('.cm-balance-bar').count() || await row('balance').locator('.cm-bbox-bar').count(), 'balance progress remains')
    for (const width of [311, 280, 220]) {
      await host.evaluate((n, width) => { n.style.width = width + 'px' }, width)
      await sameRow()
      assert.ok(await host.evaluate(n => n.scrollWidth <= n.clientWidth + 1), mode + ' stays within narrow sidebar')
      const geometry = await host.evaluate(node => {
        const today = node.querySelector('.cm-inline-today')
        const value = today.querySelector('[data-cm-today=cost]') ?? today.querySelector('[data-cm-today=tokens]')
        const balance = node.querySelector('.cm-inline-balance .cm-bbox-head .cm-bbox-pct')
        const cost = value.getBoundingClientRect(), other = balance.getBoundingClientRect()
        const tokens = today.querySelector('[data-cm-today=tokens]')?.getBoundingClientRect()
        return { top: cost.top, balanceTop: other.top, bottom: cost.bottom, tokenTop: tokens?.top }
      })
      assert.ok(Math.abs(geometry.top - geometry.balanceTop) <= 1, `${mode}/${metric}/${width} today amount aligns with balance: ` + JSON.stringify(geometry))
      if (metric === 'both') assert.ok(geometry.tokenTop >= geometry.bottom, 'tokens follow the amount without shifting its first line')
    }
  }
  await host.evaluate(n => { n.style.width = '311px' })
  await page.evaluate(() => window.configure({ sidebarStyle: 'summary', sidebarSimple: false }))
  await host.screenshot({ path: join(output, 'today-balance-inline.png') })
  await page.evaluate(() => window.configure({ hideTodayCost: true }))
  await page.waitForFunction(() => !document.querySelector('#actual-sidebar .cm-inline-ready'))
  await page.evaluate(() => window.configure({ hideTodayCost: false, hideOfficialBalance: true, customBalances: [{ enabled: true, label: '自定义服务余额', unit: 'CNY', display: 'sidebar', refreshMinutes: 15, request: { url: 'https://example.com/balance', method: 'GET' }, extract: { remaining: 'balance' } }] }))
  await page.evaluate(() => window.setFixtureState({ customBalances: [{ status: 'ok', remaining: 88, fetchedAt: Date.now() }] }))
  await page.waitForFunction(() => document.querySelector('#actual-sidebar [data-cm-display=customBalance].cm-inline-balance'))
  await sameRow()
  await page.evaluate(() => window.remount())
  await page.getByRole('tab', { name: '显示', exact: true }).click()
  assert.equal(await inline.isChecked(), true, 'saved flag survives remount and schema round trip')
  await inline.uncheck()
  await page.waitForFunction(() => !document.querySelector('#actual-sidebar .cm-inline-ready'))
  await page.evaluate(async initial => {
    await window.configure(initial)
    window.setFixtureState({ balance: { status: 'error', message: 'Synthetic balance error' }, customBalances: [] })
    document.getElementById('actual-sidebar').style.cssText = 'position:fixed;left:-2000px;width:352px;font-size:14px;line-height:1.6'
  }, initial)
  console.log('[ok] inline switch: existing layouts, compact height, tooltip data, progress, custom balance, visibility, narrow widths and saved config')
}
