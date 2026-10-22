import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { sanitizeConfig, applyConfigPatch, zeroDay } from '../lib/store.js'

const baseline = process.argv.includes('--baseline')
const artifact = process.argv.includes('--artifact')
const read = name => baseline
  ? execFileSync('git', ['show', 'origin/master:' + name], { encoding: 'utf8' })
  : readFileSync(new URL('../' + name, import.meta.url), 'utf8')
const source = artifact ? read('lib/client.js') : readdirSync(new URL('../src/client/', import.meta.url))
  .filter(name => name.endsWith('.js')).sort().map(name => read('src/client/' + name)).join('')
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { for (let tick = 0; tick < 20; tick++) await Promise.resolve() }
const copy = value => JSON.parse(JSON.stringify(value))

async function fixture({ initial = false, deferStartup = false, initialSkin = false } = {}) {
  let config = sanitizeConfig({ locale: 'en', followSkinTransparency: initialSkin, hideOfficialBalance: true, goQuota: { enabled: false },
    codingPlans: { opendesign: { enabled: initial, workspaceId: 'workspace-1' } } })
  const snapshot = () => ({ config: copy(config), today: zeroDay(), month: zeroDay(), total: zeroDay(), history: [] })
  let factory, nextRead, pendingRead, nextWrite, reads = 0, writes = 0
  const startupRead = deferStartup ? deferred() : null
  const readState = async () => {
    reads++
    const value = snapshot(), gate = nextRead
    nextRead = null
    if (gate) { pendingRead = gate; await gate.promise }
    return { ok: true, value }
  }
  const rpc = {
    getLocalState: readState,
    getState: async () => {
      if (startupRead) { const value = snapshot(); await startupRead.promise; return { ok: true, value } }
      return readState()
    },
    getStateSince: readState,
    updateConfig: async patch => {
      writes++
      const gate = nextWrite; nextWrite = null
      if (gate) await gate.promise
      const result = applyConfigPatch(config, patch)
      assert.deepEqual(result.errors, [])
      config = result.config
      return { ok: true, value: snapshot() }
    },
  }
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { factory = value.factory } }, addEventListener() {}, removeEventListener() {} },
    navigator: { language: 'en' }, document: { querySelector: () => ({}), addEventListener() {}, removeEventListener() {}, hidden: false },
    setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout, AbortController, console,
  })
  const registrations = new Map(), disposers = []
  const slots = { entries: () => [], inject: (_name, fn) => fn(), register: (options, component) => {
    registrations.set(options.name + ':' + options.id, { options, component }); return () => {}
  } }
  const context = { remote: { $mount: async () => () => {} }, fiber: { uid: 1 }, on: () => () => {}, inject() {},
    get: name => name === 'remote.costMeter' ? rpc : name === 'slots' ? slots : undefined,
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return dispose },
  }
  const loaded = [], require = name => name === 'react' ? { Component: class {}, createElement() {}, Fragment: 'fragment' } : {}
  require.async = async path => ({ mount: (_ctx, store) => { loaded.push({ path, store }); return () => null } })
  await factory(require).apply(context)
  await settle()
  const { hooks, api } = registrations.get('settings.section:cost-meter').options.inject()
  return {
    api, store: hooks.cost, startupRead, loaded,
    blockRead: () => { nextRead = deferred(); return nextRead },
    blockWrite: () => { nextWrite = deferred(); return nextWrite },
    update: enabled => api.updateConfig({ codingPlans: { opendesign: { ...config.codingPlans.opendesign, enabled } } }),
    setWorkspace: workspaceId => api.updateConfig({ codingPlans: { opendesign: { ...config.codingPlans.opendesign, workspaceId } } }),
    enabled: () => hooks.cost.getSnapshot().state.config.codingPlans.opendesign.enabled,
    workspace: () => hooks.cost.getSnapshot().state.config.codingPlans.opendesign.workspaceId,
    counts: () => ({ reads, writes }), pendingRead: () => pendingRead,
    close: () => { for (const dispose of disposers.reverse()) dispose() },
  }
}

for (const initial of [false, true]) {
  const view = await fixture({ initial })
  try {
    const gate = view.blockRead(), polling = view.api.reload()
    await settle(); assert.equal(view.pendingRead(), gate)
    await view.update(!initial)
    assert.equal(view.enabled(), !initial)
    gate.resolve(); await polling
    assert.equal(view.enabled(), !initial, 'an older poll cannot undo an OpenDesign toggle saved after that poll started')
    assert.equal(view.counts().writes, 1, 'discarding a stale result never repeats the configuration write')
    await view.api.reload(); assert.equal(view.enabled(), !initial, 'polling resumes after the save')
  } finally { view.close() }
}
{
  const view = await fixture({ initial: true })
  try {
    const gate = view.blockRead(), polling = view.api.reload(); await settle()
    await view.setWorkspace('workspace-2')
    gate.resolve(); await polling
    assert.equal(view.workspace(), 'workspace-2', 'an obsolete poll cannot restore the previous workspace')
  } finally { view.close() }
}
{
  const view = await fixture()
  try {
    const stale = view.blockRead(), polling = view.api.reload(); await settle()
    const write = view.blockWrite(), saving = view.update(true); await settle()
    const before = view.counts().reads
    await view.api.reload(); assert.equal(view.counts().reads, before, 'a pending save does not start another stale read')
    stale.reject(new Error('obsolete query failed')); await polling
    assert.equal(view.store.getSnapshot().status, 'ready', 'an obsolete read error does not replace the settings status')
    write.resolve(); await saving
    assert.equal(view.enabled(), true)
    const failedWrite = view.blockWrite(), failedSave = view.update(false)
    failedWrite.reject(new Error('save rejected'))
    await assert.rejects(failedSave, /save rejected/)
    await view.api.reload(); assert.equal(view.enabled(), true, 'a failed save releases polling and retains the last saved setting')
  } finally { view.close() }
}
{
  const view = await fixture({ deferStartup: true })
  try {
    await view.update(true)
    view.startupRead.resolve(); await settle()
    assert.equal(view.enabled(), true, 'the second startup read cannot overwrite a setting saved after the local first paint')
  } finally { view.close() }
}
if (!baseline) for (const initialSkin of [false, true]) {
  const view = await fixture({ initialSkin })
  try {
    assert.equal(view.loaded.filter(x => x.path === './client.display.js').length, Number(initialSkin), 'saved skin transparency is restored without opening settings')
    await view.api.updateConfig({ followSkinTransparency: true })
    await settle()
    const loaded = view.loaded.filter(x => x.path === './client.display.js')
    assert.equal(loaded.length, 1, 'display styles load once')
    assert.equal(loaded[0].store, view.store, 'styles subscribe to the live store')
    await view.api.updateConfig({ followSkinTransparency: false })
    assert.equal(loaded[0].store.getSnapshot().state.config.followSkinTransparency, false)
  } finally { view.close() }
}
console.log('[ok] settings snapshots: OpenDesign enable/disable, stale success/error, pending/failed saves, startup refresh, polling and persisted skin styles' + (artifact ? ' (bundle)' : ' (source)'))
