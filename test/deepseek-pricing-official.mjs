import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_PRICE_TABLE, DEFAULT_PRICE_TABLE_CNY, parsePricingHtml, upgradeDeepSeekPriceTable, providerPriceEntryFor, costOf, DEFAULT_PEAK_WINDOWS } from '../lib/pricing.js'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'
import { pricingConfigAt } from '../lib/billing-history.js'
import { apply, runStartupImports } from '../lib/index.js'
import { stateSchema } from '../lib/typert.host.js'

const previous = JSON.parse(readFileSync(new URL('./fixtures/deepseek-defaults-1.8.32.json', import.meta.url), 'utf8'))
const pages = Object.fromEntries(['USD', 'CNY'].map(currency => [currency, readFileSync(new URL('./fixtures/deepseek-official-2026-10-16.' + (currency === 'CNY' ? 'zh-CN' : 'en') + '.html', import.meta.url), 'utf8')]))
const at = Date.parse('2026-10-16T04:30:00Z'), peakAt = Date.parse('2026-10-16T06:30:00Z')
const peak = { enabled: true, effectiveAtMs: Date.parse('2026-08-16T16:00:00Z'), windows: DEFAULT_PEAK_WINDOWS }
const buckets = { input: 1e6, cacheRead: 1e6, output: 1e6 }
const values = entry => [entry.cacheHit, entry.cacheMiss, entry.output]
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
for (const [currency, table, pro, flash] of [
  ['USD', DEFAULT_PRICE_TABLE, [.022, .66, 1.98], [.003, .15, .6]],
  ['CNY', DEFAULT_PRICE_TABLE_CNY, [.15, 4.5, 13.5], [.02, 1, 4]],
]) {
  // 实抓官网双语 HTML；不能用错误默认表生成预期值。
  const parsed = parsePricingHtml(pages[currency])
  assert.equal(parsed.currency, currency)
  for (const candidate of [table, parsed]) {
    assert.deepEqual(values(candidate.models['deepseek-v4-pro']), pro)
    assert.deepEqual(values(candidate.models['deepseek-v4-pro'].peak), pro.map(value => value * 2))
    assert.equal(candidate.models['deepseek-v4-pro'].rateHistory, undefined)
    for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4.1-flash']) {
      assert.deepEqual(values(candidate.models[model]), flash)
      assert.deepEqual(values(candidate.models[model].peak), flash.map(value => value * 2))
    }
  }
  for (const provider of ['deepseek', 'deepseek-official', 'deepseek-account']) {
    const entry = providerPriceEntryFor(provider, 'deepseek-v4-pro', { ...parsed, currency }).entry
    near(costOf(buckets, entry, at, peak), pro.reduce((a, b) => a + b))
    near(costOf(buckets, entry, peakAt, peak), pro.reduce((a, b) => a + b) * 2)
  }
  const prices = { ...structuredClone(previous[currency]), currency }
  prices.models['deepseek-v4-pro'].multiplier = .7
  prices.providers = { custom: { models: { 'deepseek-v4-pro': { cacheMiss: 99, output: 88 } } } }
  const thirdParty = structuredClone(prices.providers)
  assert.ok(upgradeDeepSeekPriceTable(prices).includes('deepseek-v4-pro'), '修正带错误 rateHistory 的真实旧默认表')
  assert.deepEqual(values(prices.models['deepseek-v4-pro']), pro)
  assert.equal(prices.models['deepseek-v4-pro'].multiplier, .7)
  assert.equal(prices.models['deepseek-v4-pro'].rateHistory, undefined)
  assert.deepEqual(prices.providers, thirdParty)
  assert.deepEqual(upgradeDeepSeekPriceTable(prices), [], '升级幂等')
  for (const modify of [entry => { entry.cacheMiss = 9.99 }, entry => { entry.peak.output = 99 }, entry => { entry.rateHistory[0].output = 42 }, entry => { entry.rateHistory[0].before = '2026-09-15T00:00:00Z' }, entry => { entry.billingMode = 'flat' }, entry => { entry.unpriced = true }, entry => { entry.cacheWrite = .3 }, entry => { entry.legacyBase.cacheMiss = 9 }, entry => { entry.peak.cacheWrite = .3 }]) {
    const custom = { ...structuredClone(previous[currency]), currency }
    modify(custom.models['deepseek-v4-pro'])
    const kept = structuredClone(custom.models['deepseek-v4-pro'])
    upgradeDeepSeekPriceTable(custom)
    assert.deepEqual(custom.models['deepseek-v4-pro'], kept, '自定义价格、档位、历史和固定价不覆盖')
  }
}

// 官方新报价必须原样生效，不能被与内置旧数字的匹配重写回低价。
const changedPage = pages.CNY.replace('4.5元', '5.5元').replace('9.0元', '11.0元')
assert.equal(parsePricingHtml(changedPage).models['deepseek-v4-pro'].cacheMiss, 5.5)

const root = mkdtempSync(join(tmpdir(), 'cm-issue292-'))
const oldHome = process.env.DSH_HOME, oldFetch = globalThis.fetch, oldTimeout = globalThis.setTimeout
const disposers = []
let service
try {
  const path = join(root, 'storages', 'cost-meter', 'ledger.json')
  const config = sanitizeConfig({ locale: 'zh', legacyAutoImportedAt: 1, exchangeRate: 7.2, exchangeRateAuto: false, pricingCurrency: 'CNY', hideOfficialBalance: true, balance: { display: 'off' }, goQuota: { enabled: false }, prices: { ...structuredClone(previous.CNY), currency: 'CNY' } })
  const ledger = new Ledger(config, {}, path, ['deepseek-september-2026-prices-v1'])
  ledger.account(buckets, 'deepseek-v4-pro', 'affected', at, 'deepseek')
  const oldDays = structuredClone(ledger.days), oldVersions = structuredClone(ledger.pricingHistory.versions), oldFx = structuredClone(ledger.pricingHistory.fxChanges)
  const records = [
    { type: 'session', id: 'affected', version: 0, createdAt: at - 60000 },
    { type: 'request/header', seq: 0, time: at - 1, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-pro' } } } },
    { type: 'assistant/message', seq: 1, time: at, data: { turn: 1, step: 1, usage: { inputTokens: 1e6, cacheReadTokens: 1e6, outputTokens: 1e6 } } },
  ]
  const sessionDir = join(root, 'sessions', 'project', 'affected'); mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'session.jsonl'), records.map(row => JSON.stringify(row)).join('\n') + '\n')
  await runStartupImports(ledger, join(root, 'sessions'))
  assert.equal(ledger.config.prices.models['deepseek-v4-pro'].cacheMiss, 4.5, '旧九月标记不阻止本次修正')
  assert.deepEqual(ledger.days, oldDays, '启动修正不自动重算已记录金额')
  for (const [id, value] of Object.entries(oldVersions)) assert.deepEqual(ledger.pricingHistory.versions[id], value)
  assert.deepEqual(ledger.pricingHistory.fxChanges, oldFx)
  assert.equal(pricingConfigAt(ledger.config, at, 'affected').prices.models['deepseek-v4-pro'].cacheMiss, 1)
  assert.equal(pricingConfigAt(ledger.config, Date.now() + 1).prices.models['deepseek-v4-pro'].cacheMiss, 4.5)
  const changes = JSON.stringify(ledger.pricingHistory.changes)
  await runStartupImports(ledger, join(root, 'sessions'))
  assert.equal(JSON.stringify(ledger.pricingHistory.changes), changes)
  ledger.close()

  process.env.DSH_HOME = root
  const requests = []
  globalThis.fetch = async url => {
    requests.push(String(url))
    if (String(url).startsWith('https://api-docs.deepseek.com/')) return new Response(String(url).includes('/zh-cn/') ? pages.CNY : pages.USD)
    if (['https://openrouter.ai/api/v1/models', 'https://amr-api.open-design.ai/api/v1/public/model-prices'].includes(String(url))) return new Response(JSON.stringify({ data: [] }))
    throw new Error('Unexpected network request: ' + url)
  }
  globalThis.setTimeout = (fn, delay, ...args) => oldTimeout(fn, delay === 3000 || delay === 5000 ? 3600000 : delay, ...args)
  apply({ on: () => () => {}, inject() {}, logger: { info() {}, warn() {}, error() {} }, effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) }, provide: (name, value) => { if (name === 'costMeter') service = value }, get: key => key === 'settings' ? { get: () => ({}) } : undefined })
  globalThis.setTimeout = oldTimeout
  const synced = await service.fetchPrices()
  assert.equal(synced.ok, true)
  stateSchema.parse(synced.state)
  assert.equal(synced.state.config.prices.models['deepseek-v4-pro'].cacheMiss, 4.5)
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) assert.equal(synced.state.config.prices.models[model].cacheMiss, 1)
  await assert.rejects(service.repriceHistory(false), /confirmation/)
  const recosted = await service.repriceHistory(true)
  assert.equal(recosted.ok, true)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  near(saved.days[localDayKey(at)].cost * 7.2, 18.15)
  const backup = readdirSync(join(root, 'storages', 'cost-meter')).find(name => name.includes('before-reprice'))
  assert.ok(backup)
  near(JSON.parse(readFileSync(join(root, 'storages', 'cost-meter', backup), 'utf8')).days[localDayKey(at)].cost, oldDays[localDayKey(at)].cost)
  assert.ok(requests.every(url => url.startsWith('https://api-docs.deepseek.com/') || ['https://openrouter.ai/api/v1/models', 'https://amr-api.open-design.ai/api/v1/public/model-prices'].includes(url)), '只访问模拟的公开价目源：' + JSON.stringify(requests))
} finally {
  for (const dispose of disposers.reverse()) await dispose()
  globalThis.fetch = oldFetch; globalThis.setTimeout = oldTimeout
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] #292：官网双币种 Pro/Flash、旧名称同步、错误模板升级、倍率与手动价保留、历史不变及确认重算备份')
