// 轮询载荷去重(getStateSince 的 pricesRev 协商):契约与正确性回归。
//
// 契约:
//   1. getState()                 → 必带完整 config.prices(首屏/旧客户端)
//   2. getStateSince(相同 rev)     → 省略 config.prices,客户端沿用上一份
//   3. getStateSince(陈旧/未知 rev) → 必带完整 config.prices(不能静默沿用旧价)
//   4. 改价后 rev 必变           → 下一次轮询必带新价表
//   5. 宿主重启后 rev 不得与上一进程相等(否则客户端会跳过下发、沿用陈旧价格)
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

const root = mkdtempSync(join(tmpdir(), 'cm-prices-rev-'))
const oldHome = process.env.DSH_HOME
const cleanups = []
let armed = false, entered, release
const previousFetch = globalThis.fetch
const previousTimeout = globalThis.setTimeout
// Public price refreshes are unrelated to this test; keep them from racing the fixture.
globalThis.setTimeout = (fn, ms, ...args) => previousTimeout(fn, ms === 3000 ? 3600_000 : ms, ...args)
let externalRequests = 0
globalThis.fetch = async () => { externalRequests++; throw new Error('network disabled in revision test') }
const credentials = {
  resolve: async () => undefined,
  describe: async ref => {
    if (armed && JSON.stringify(ref).includes('DEEPSEEK_BALANCE_API_KEY')) {
      armed = false; entered()
      await new Promise(resolve => { release = resolve })
    }
    return { configured: false }
  },
}

/** Boot a service against a fresh storage directory and return its API. */
const boot = name => {
  process.env.DSH_HOME = join(root, name)
  mkdirSync(join(process.env.DSH_HOME, 'storages', 'cost-meter'), { recursive: true })
  let api
  apply({
    on: () => () => {}, inject() {}, get: key => key === 'credentials' ? credentials : undefined,
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    provide: (_, service) => { api = service },
  })
  return api
}

try {
  const api = boot('a')
  await api.updateConfig({ locale: 'zh', balance: { display: 'off' }, goQuota: { enabled: false } })
  const stateDescriptor = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState')
  const wire = state => {
    const plain = JSON.parse(JSON.stringify(state))
    stateSchema.parse(plain)
    // 客户端 codec 也必须接受(旧客户端会拿到全量;新客户端会额外收到省略形态)。
    stateDescriptor.result.create().parse(plain)
    return plain
  }

  // 1. 无 rev:必带完整价格表。
  const first = wire(await api.getState())
  assert.ok(first.config.prices !== undefined, '无 rev 时必须下发完整价格表')
  assert.ok(Object.keys(first.config.prices.providers?.openrouter?.models ?? {}).length > 0, '价格表内容非空')
  assert.equal(typeof first.pricesRev, 'string', '必须下发价格表版本号')

  // 旧宿主的无参调用等价于「不带 rev」。
  const legacy = wire(await api.getState())
  assert.ok(legacy.config.prices !== undefined, '旧客户端无参调用仍应拿到完整价格表')

  // 2. 相同 rev:省略价格表,且其余字段仍在。
  const second = wire(await api.getStateSince(first.pricesRev))
  assert.equal(second.config.prices, undefined, '版本一致时应省略 config.prices')
  assert.equal(second.pricesRev, first.pricesRev, '版本号不变')
  assert.deepEqual(second.history, first.history, '省略价格表不影响其它字段')
  assert.deepEqual(second.today, first.today, '省略价格表不影响今日用量')
  assert.equal(second.config.exchangeRate, first.config.exchangeRate, '省略价格表不影响其它配置键')

  // 3. 陈旧 rev:必须回全量,不能静默沿用旧价。
  for (const stale of ['not-a-real-rev', first.pricesRev + 'x', '']) {
    const full = wire(await api.getStateSince(stale))
    assert.ok(full.config.prices !== undefined, `陈旧 rev(${stale || '空串'})必须回全量价格表`)
  }

  // 4. 改价后版本号必变,且下一次(带旧 rev)必须携带新价表。
  const models = first.config.prices.providers.openrouter.models
  const target = Object.keys(models)[0]
  await api.updateConfig({ prices: { providers: { openrouter: { models: { [target]: { ...models[target], cacheMiss: 7 } } } } } })
  const afterEdit = wire(await api.getStateSince(first.pricesRev))
  assert.notEqual(afterEdit.pricesRev, first.pricesRev, '改价后版本号必须变化')
  assert.ok(afterEdit.config.prices !== undefined, '改价后下一次轮询必须携带新价表')
  assert.equal(afterEdit.config.prices.providers.openrouter.models[target].cacheMiss, 7, '新价必须已下发')

  // 5. 宿主重启:新进程的版本号不得与上一进程相等,否则客户端会沿用陈旧价格。
  const reborn = boot('b')
  await reborn.updateConfig({ locale: 'zh', balance: { display: 'off' }, goQuota: { enabled: false } })
  const rebornState = await reborn.getStateSince(afterEdit.pricesRev)
  assert.notEqual(rebornState.pricesRev, afterEdit.pricesRev, '重启后的版本号不得等于上一进程(否则跳过下发)')
  assert.ok(rebornState.config.prices !== undefined, '重启后带旧 rev 必须回全量价格表')

  // Replacing unrelated configuration creates a new prices object with identical content.
  const unchanged = await api.updateConfig({ decimals: afterEdit.config.decimals === 4 ? 5 : 4 })
  assert.equal(unchanged.pricesRev, afterEdit.pricesRev, '非价格设置变化不重发价格表')
  assert.equal((await api.getStateSince(unchanged.pricesRev)).config.prices, undefined)

  // Hold an old snapshot at its async credential read while a newer price is saved.
  const checkpoint = new Promise(resolve => { entered = resolve })
  armed = true
  const inFlight = api.getState()
  let timeout
  await Promise.race([checkpoint, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('snapshot checkpoint not reached')), 5000) })]).finally(() => clearTimeout(timeout))
  const current = wire(await api.updateConfig({ prices: { providers: { openrouter: { models: { [target]: { ...afterEdit.config.prices.providers.openrouter.models[target], cacheMiss: 77 } } } } } }))
  release()
  const stale = wire(await inFlight)
  assert.equal(stale.config.prices.providers.openrouter.models[target].cacheMiss, 7)
  assert.equal(current.config.prices.providers.openrouter.models[target].cacheMiss, 77)
  assert.notEqual(stale.pricesRev, current.pricesRev, '旧快照不能贴上新价格版本号')
  const recovered = wire(await api.getStateSince(stale.pricesRev))
  assert.equal(recovered.config.prices.providers.openrouter.models[target].cacheMiss, 77, '旧响应之后的轮询会补发新价格')
  assert.equal((await api.getStateSince(recovered.pricesRev)).config.prices, undefined, '新价格接收后恢复省略')
  assert.equal(externalRequests, 0)
  console.log('[ok] 轮询载荷去重:首屏/命中/陈旧/改价/重启/非价格配置/并发快照版本通过；外部请求 0')
} finally {
  release?.()
  globalThis.fetch = previousFetch
  globalThis.setTimeout = previousTimeout
  for (const cleanup of cleanups.reverse()) cleanup()
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  rmSync(root, { recursive: true, force: true })
}
