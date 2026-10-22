import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/**
 * Upgrading from v1.9.12 must not reprice recorded Ollama Cloud calls. The fixture ledger was
 * accounted by the v1.9.12 library (fixtures/ollama-cloud-upgrade-1.9.12/generate.mjs): its
 * frozen price version has no calendar policy and therefore keeps DeepSeek's windows. Calls
 * after the upgrade use Ollama's calendar; old calls change only through explicit model repricing.
 * A ledger saved before pricing versions existed (no pricingHistory), or with an unusable one,
 * gets its first version seeded from the saved table with the same pre-v1.9.13 policy; only a
 * genuinely new ledger starts on Ollama's calendar.
 * The fixture's day keys are UTC dates, so the check runs under TZ=UTC.
 */
if (process.env.TZ !== 'UTC') {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8' })
  process.stdout.write(child.stdout); process.stderr.write(child.stderr)
  assert.equal(child.status, 0, 'Ollama Cloud upgrade regression')
} else await run()

async function run() {
  // The real v1.9.12 file; the same file before pricing versions existed; an unusable timeline.
  await scenario('versioned', data => data)
  await scenario('missing history', ({ pricingHistory, ...data }) => data)
  await scenario('invalid history', data => ({ ...data, pricingHistory: { ...data.pricingHistory, changes: {} } }))
  for (const automatic of [false, true]) {
    await scenario('v1.9.16 snapshots', data => data, { automatic })
    await scenario('v1.9.16 snapshots missing history', ({ pricingHistory, ...data }) => data, { automatic })
    await scenario('v1.9.16 snapshots invalid history', data => ({ ...data, pricingHistory: { ...data.pricingHistory, changes: {} } }), { automatic })
  }
  await freshLedger()
}

async function scenario(variant, edit, snapshots = null) {
  const { Ledger, localDayKey } = await import('../lib/store.js')
  const { apply, __testProjection } = await import('../lib/index.js')
  const { replaySessionRecords, recomputeLedgerPricingBasis } = await import('../lib/backfill.js')
  const { turnCostFromRecords } = await import('../lib/turn-cost.js')
  const { pricingConfigAt } = await import('../lib/billing-history.js')
  const fixture = new URL(snapshots ? './fixtures/ollama-snapshots-1.9.16/' : './fixtures/ollama-cloud-upgrade-1.9.12/', import.meta.url)
  const sessions = JSON.parse(readFileSync(new URL('sessions.json', fixture), 'utf8'))
  const root = mkdtempSync(join(tmpdir(), 'cm-ollama-upgrade-')), home = process.env.DSH_HOME
  const path = join(root, 'storages', 'cost-meter', 'ledger.json'), sessionsRoot = join(root, 'sessions')
  const oldFetch = globalThis.fetch, oldTimer = globalThis.setTimeout, oldNow = Date.now, disposers = []
  const flashId = 'deepseek-v4.1-flash' + (snapshots ? ':1017' : ''), proId = 'deepseek-v4-pro' + (snapshots ? ':0813' : '')
  const flash = 'ollama-cloud:' + flashId, pro = 'ollama-cloud:' + proId, official = 'deepseek-official:deepseek-v4.1-flash'
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-10, `${variant}: ${label}: ${actual} != ${expected}`)
  const oldDay = '2026-10-19', newDay = '2026-10-20', originalRate = snapshots ? 7.2 : 7
  // v1.9.12 amounts: DeepSeek's windows (06:30 UTC Monday peak, 13:00 off-peak).
  const OLD = { morning: { [flash]: snapshots?.automatic ? 0 : .30, [pro]: snapshots?.automatic ? 0 : 1.32, [official]: .30 }, afternoon: { [flash]: snapshots?.automatic ? 0 : .15 } }
  // Tuesday after the upgrade: Ollama's calendar.
  sessions.upgraded = [{ at: `${newDay}T06:30:00.000Z`, provider: 'ollama-cloud', model: flashId, input: 1e6 },
    { at: `${newDay}T13:00:00.000Z`, provider: 'ollama-cloud', model: flashId, input: 1e6 }]
  const records = {}
  for (const [id, calls] of Object.entries(sessions)) {
    const rows = records[id] = [{ type: 'session', id, version: 0, createdAt: Date.parse(calls[0].at) - 1000 }, { type: 'turn/start', seq: 0, time: Date.parse(calls[0].at) - 1, data: { turn: 1 } }]
    for (const [i, { at, provider, model, input }] of calls.entries()) rows.push(
      { type: 'request/header', seq: i * 3 + 1, time: Date.parse(at), data: { header: { config: { provider, model } } } },
      { type: 'step/start', seq: i * 3 + 2, time: Date.parse(at), data: { turn: 1, step: i + 1 } },
      { type: 'assistant/message', seq: i * 3 + 3, time: Date.parse(at) + 1, data: { turn: 1, step: i + 1, usage: { inputTokens: input } } })
    rows.push({ type: 'turn/end', seq: calls.length * 3 + 1, time: Date.parse(calls.at(-1).at) + 2, data: { turn: 1 } })
    const dir = join(sessionsRoot, 'project', id); mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  }
  const cells = (data, date, id) => data.days[date].sessions.find(row => row.id === id).byProviderModel
  const replayed = (config, id) => replaySessionRecords(records[id], config, null).days[localDayKey(Date.parse(sessions[id][0].at))]
  const detail = (config, id) => turnCostFromRecords(records[id], config, 0, sessions[id].length * 3 + 1).calls.reduce((sum, call) => ({ ...sum, [`${call.provider}:${call.model}`]: (sum[`${call.provider}:${call.model}`] ?? 0) + call.cost }), {})
  const projected = (ledger, id) => {
    const projection = __testProjection.makeCostUsageProjection(ledger)
    return records[id].slice(1).reduce((state, event) => projection.apply(state, event), projection.init({ id, createdAt: records[id][0].createdAt }, 0)).byProviderModel
  }
  const expectAll = (ledger, expected, label) => {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    for (const [id, models] of Object.entries(expected)) {
      const date = localDayKey(Date.parse(sessions[id][0].at)), replay = replayed(ledger.config, id), calls = detail(ledger.config, id), projection = projected(ledger, id)
      for (const [key, cost] of Object.entries(models)) {
        near(cells(data, date, id)[key].cost, cost, `${label} recorded ${id} ${key}`)
        near(replay[key].cost, cost, `${label} replay ${id} ${key}`)
        near(calls[key], cost, `${label} detail ${id} ${key}`)
        near(projection[key].cost, cost, `${label} projection ${id} ${key}`)
      }
    }
  }
  let clock = Date.parse(`${newDay}T00:00:00Z`), service
  try {
    process.env.DSH_HOME = root
    Date.now = () => clock
    mkdirSync(join(root, 'storages', 'cost-meter'), { recursive: true })
    const saved = JSON.parse(readFileSync(new URL(snapshots ? (snapshots.automatic ? 'automatic.json' : 'aliased.json') : 'ledger.json', fixture), 'utf8'))
    assert.equal(saved.version !== undefined && Object.keys(saved.pricingHistory.versions).length, 1, 'fixture holds one v1.9.12 price version')
    writeFileSync(path, JSON.stringify(edit(saved)))
    const original = JSON.parse(readFileSync(path, 'utf8'))
    for (const [id, models] of Object.entries(OLD)) for (const [key, cost] of Object.entries(models)) near(cells(original, oldDay, id)[key].cost, cost, `fixture ${id} ${key}`)

    // Load (upgrade at 2026-10-20 00:00 UTC): the old version keeps DeepSeek's calendar.
    let ledger = Ledger.load(path)
    const [initial] = Object.values(ledger.pricingHistory.changes).filter(row => row.at === 0)
    assert.equal(ledger.pricingHistory.versions[initial.version].prices.snapshotTags, false, `${variant}: saved matching policy is frozen`)
    if (!snapshots) assert.equal(ledger.pricingHistory.versions[initial.version].prices.ollamaPeak, false)
    assert.equal(pricingConfigAt(ledger.config, clock + 1).prices.snapshotTags, true, 'new calls use snapshot matching')
    assert.equal(pricingConfigAt(ledger.config, clock + 1).prices.ollamaPeak, true, 'calls after the upgrade use Ollama\'s calendar')
    assert.deepEqual(ledger.pricingHistory.runs, {})
    for (const [id, models] of Object.entries(OLD)) for (const [key, cost] of Object.entries(models)) near(replayed(ledger.config, id)[key].cost, cost, `first-load replay ${id} ${key}`)
    ledger.account({ input: 1e6 }, flashId, 'upgraded', Date.parse(sessions.upgraded[0].at), 'ollama-cloud')
    ledger.account({ input: 1e6 }, flashId, 'upgraded', Date.parse(sessions.upgraded[1].at), 'ollama-cloud')
    clock = Date.parse(`${newDay}T20:00:00Z`)
    // Automatic (non-explicit) repricing replays with the frozen versions and changes nothing.
    await recomputeLedgerPricingBasis(ledger, sessionsRoot, null)
    ledger.close()
    const NEW = { upgraded: { [flash]: .15 + .30 } }
    for (const call of ['morning', 'afternoon']) assert.deepEqual(cells(JSON.parse(readFileSync(path, 'utf8')), oldDay, call), cells(original, oldDay, call), `${call} unchanged by load and replay`)
    ledger = Ledger.load(path)
    expectAll(ledger, { ...OLD, ...NEW }, 'after upgrade')
    assert.deepEqual(turnCostFromRecords(records.upgraded, ledger.config, 0, 7).calls.map(call => call.cost), [.15, .30], 'new 06:30 off-peak, 13:00 peak')
    ledger.close()

    // Explicit target-model repricing opts old calls into the new calendar with the original FX.
    globalThis.fetch = async () => { throw Error('Unexpected network request') }
    globalThis.setTimeout = (fn, delay, ...args) => oldTimer(fn, delay === 3000 || delay === 5000 ? 3600000 : delay, ...args)
    apply({ on: () => () => {}, inject() {}, logger: { info() {}, warn() {}, error() {} }, effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) }, provide: (key, value) => { if (key === 'costMeter') service = value }, get: key => key === 'settings' ? { get: () => ({}) } : undefined })
    globalThis.setTimeout = oldTimer
    await service.updateConfig({ exchangeRate: 9 })
    assert.equal((await service.repriceModelHistory(true, flash)).ok, true)
    for (const dispose of disposers.splice(0).reverse()) await dispose()
    const REPRICED = { morning: { [flash]: .15, [pro]: OLD.morning[pro], [official]: .30 }, afternoon: { [flash]: .30 } }
    const repriced = JSON.parse(readFileSync(path, 'utf8'))
    near(cells(repriced, oldDay, 'morning')[flash].costCny, .15 * originalRate, 'original FX')
    near(cells(repriced, oldDay, 'afternoon')[flash].costCny, .30 * originalRate, 'original FX')
    for (const key of [pro, official]) assert.deepEqual(cells(repriced, oldDay, 'morning')[key], cells(original, oldDay, 'morning')[key], `${key} untouched`)

    // Restart keeps the opted-in calls, untouched siblings, other providers and new calls.
    ledger = Ledger.load(path)
    expectAll(ledger, { ...REPRICED, ...NEW }, 'after reprice and restart')
    assert.equal(pricingConfigAt(ledger.config, Date.parse(sessions.morning[0].at), 'morning', flash).fxRates.CNY, originalRate)
    assert.equal(Object.values(ledger.pricingHistory.runs).filter(row => row.model === flash).length, 1)
    ledger.close()
  } finally {
    for (const dispose of disposers.reverse()) await dispose()
    globalThis.fetch = oldFetch; globalThis.setTimeout = oldTimer; Date.now = oldNow
    if (home === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = home
    rmSync(root, { recursive: true, force: true })
  }
  console.log(`[ok] Ollama Cloud upgrade (${variant}): saved amounts kept on load/replay/detail/projection; new calls on Ollama's calendar; explicit model repricing opts in with original FX; restart`)
}

/** No ledger yet (or one that cannot be read): history starts on Ollama's calendar at time zero. */
async function freshLedger() {
  const { Ledger, sanitizeConfig } = await import('../lib/store.js')
  const { replaySessionRecords } = await import('../lib/backfill.js')
  const { pricingConfigAt, createPricingHistory, normalizePricingHistory, encodePricingHistory } = await import('../lib/billing-history.js')
  const root = mkdtempSync(join(tmpdir(), 'cm-ollama-fresh-')), oldNow = Date.now, flash = 'ollama-cloud:deepseek-v4.1-flash'
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: ${actual} != ${expected}`)
  const initialPolicy = ledger => ledger.pricingHistory.versions[Object.values(ledger.pricingHistory.changes).find(row => row.at === 0).version].prices.ollamaPeak
  // Calls from before the first start (a backfill) are priced like any other new call.
  const morning = Date.parse('2026-10-19T06:30:00Z'), afternoon = Date.parse('2026-10-19T13:00:00Z')
  const records = [{ type: 'session', id: 'fresh', version: 0, createdAt: morning - 1000 }, { type: 'turn/start', seq: 0, time: morning - 1, data: { turn: 1 } },
    ...[morning, afternoon].flatMap((at, i) => [{ type: 'request/header', seq: i * 3 + 1, time: at, data: { header: { config: { provider: 'ollama-cloud', model: 'deepseek-v4.1-flash' } } } },
      { type: 'step/start', seq: i * 3 + 2, time: at, data: { turn: 1, step: i + 1 } },
      { type: 'assistant/message', seq: i * 3 + 3, time: at + 1, data: { turn: 1, step: i + 1, usage: { inputTokens: 1e6 } } }]),
    { type: 'turn/end', seq: 7, time: afternoon + 2, data: { turn: 1 } }]
  try {
    Date.now = () => Date.parse('2026-10-20T00:00:00Z')
    const path = join(root, 'ledger.json')
    let ledger = Ledger.load(path)
    assert.equal(initialPolicy(ledger), true, 'first install starts on Ollama\'s calendar')
    ledger.account({ input: 1e6 }, 'deepseek-v4.1-flash', 'fresh', morning, 'ollama-cloud')
    ledger.account({ input: 1e6 }, 'deepseek-v4.1-flash', 'fresh', afternoon, 'ollama-cloud')
    ledger.close()
    ledger = Ledger.load(path)
    near(JSON.parse(readFileSync(path, 'utf8')).days['2026-10-19'].sessions.find(row => row.id === 'fresh').byProviderModel[flash].cost, .45, 'fresh recorded')
    assert.equal(pricingConfigAt(ledger.config, morning).prices.ollamaPeak, true, 'restart keeps the fresh calendar')
    near(replaySessionRecords(records, ledger.config, null).days['2026-10-19'][flash].cost, .45, 'fresh replay')
    ledger.close()
    for (const next of [new Ledger(sanitizeConfig({}), {}, join(root, 'direct.json')), (writeFileSync(join(root, 'future.json'), JSON.stringify({ version: 999, days: {} })), Ledger.load(join(root, 'future.json')))]) {
      assert.equal(initialPolicy(next), true, 'a new ledger, or one replacing an unsupported file, starts on Ollama\'s calendar')
      next.close()
    }
    // A saved timeline that lost its start but holds a v1.9.13 version was written after the update.
    const config = sanitizeConfig({}), seeded = raw => normalizePricingHistory(raw, config, undefined, true)
    const policy = history => history.versions[Object.values(history.changes).find(row => row.at === 0).version].prices.ollamaPeak
    assert.equal(policy(seeded({ ...JSON.parse(JSON.stringify(encodePricingHistory(createPricingHistory(config)))), changes: {} })), true, 'saved v1.9.13 version without a start')
    assert.equal(policy(seeded('unusable')), false, 'unusable saved timeline keeps the saved table\'s policy')
    assert.equal(policy(normalizePricingHistory(undefined, config)), true, 'no saved timeline in a new ledger')
  } finally {
    Date.now = oldNow
    rmSync(root, { recursive: true, force: true })
  }
  console.log('[ok] Ollama Cloud upgrade: a new ledger starts on Ollama\'s calendar, including backfilled calls and restart')
}
