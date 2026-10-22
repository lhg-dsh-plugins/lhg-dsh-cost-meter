// #253: real published SlotRegistry + Cordis, including synchronous mutation
// events. Header enumeration is the host's shipped function, not a projection
// of winning entries. No DOM/model/network/account requests are made here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const host = resolve(process.env.DSH_TEST_NODE_MODULES ?? '.tmp-context-host/node_modules')
const req = createRequire(join(host, '__context_lifecycle.cjs'))
const uiReq = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES ?? host), '__context_lifecycle.cjs'))
const React = uiReq('react'), reactDom = uiReq('react-dom'), reactDomClient = uiReq('react-dom/client')
const cordis = await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href)
const slotsCore = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-client-ui-slots')).href)
const documentListeners = new Map(), windowListeners = new Map()
const events = listeners => ({
  addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
  removeEventListener(name, fn) { listeners.get(name)?.delete(fn) },
})
const localStorage = { getItem: () => '1', setItem() {} }
const document = { hidden: false, ...events(documentListeners) }
const window = { localStorage, ...events(windowListeners) }
function moduleFrom(source) {
  let factory
  window.__ModuleLoader__ = { load: value => { factory = value.factory } }
  vm.runInNewContext(source, { window, document, localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console })
  return factory(name => {
    const modules = { react: React, 'react-dom': reactDom, 'react-dom/client': reactDomClient,
      'react/jsx-runtime': uiReq('react/jsx-runtime'), '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-ui-slots': slotsCore }
    assert.ok(name in modules, 'unexpected browser dependency ' + name)
    return modules[name]
  })
}
const { SlotRegistry } = moduleFrom(readFileSync(req.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8'))
const ui = moduleFrom(readFileSync(resolve(process.env.CM_TEST_STATISTICS_BUNDLE ?? 'lib/client.statistics.js'), 'utf8'))
const conversationSource = readFileSync(join(dirname(req.resolve('@deepseek-ai/dsh-client-ui-conversation')), 'client.js'), 'utf8')
const viewTabsSource = conversationSource.match(/const viewTabs = \(\) => \{([\s\S]*?)\n\s*\};\n\s*const activateView =/)
assert.ok(viewTabsSource, 'published conversation header viewTabs function is present')
const hostHeaderTabs = slots => vm.runInNewContext('(() => {' + viewTabsSource[1] + '})()', {
  slots, ctx: { configForms: { developerTools: { enabled: { getSnapshot: () => false } } } },
  _deepseek_ai_dsh_client_ui_slots: slotsCore,
})
const targets = [['conversation.view', 'id', 'context'], ['sidebar.right.pane.tab', 'key', 'dsh-context'], ['conversation.input.overlay', 'id', 'context-modal']]
const registrant = 'dsh-cost-meter-context-bridge'
const ready = { version: '0.68.1', compatible: true, reason: 'ready' }
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 5)) }
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value }); return { promise, resolve } }
const asyncErrors = []
const recordError = error => { asyncErrors.push(error) }
process.on('uncaughtException', recordError)
process.on('unhandledRejection', recordError)
const fixtures = []
async function environment({ peerRead, saveGate } = {}) {
  const client = new cordis.Context()
  await client.plugin(ctx => { new SlotRegistry(ctx) })
  const slots = client.get('slots')
  let disposeDeclaration
  const declare = () => { disposeDeclaration = slots.register({ name: 'root', children: Object.fromEntries(targets.map(([name, key]) => [name, { kind: key === 'id' ? 'list' : 'keyed', scope: 'session' }])) }, () => null) }
  declare()
  let snapshot = { state: { config: { contextCostsEnabled: false, contextCostsPromptSeen: true } } }
  const listeners = new Set(), saves = []
  const store = { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    set: value => { snapshot = value; for (const fn of listeners) fn() } }
  const peerDisposers = [], originals = new Map()
  function installPeer() {
    for (const [name, key, id] of targets) {
      const component = () => null
      peerDisposers.push(slots.register({ name, [key]: id, order: 20, locale: 'dsh-context', label: () => 'Context', registrant: 'dsh-context' }, component))
      originals.set(name, slots.entries(name).find(entry => entry.component === component))
    }
  }
  function uninstallPeer() { for (const dispose of peerDisposers.splice(0)) dispose() }
  installPeer()
  let manager
  const api = { getContextIntegration: () => peerRead ? peerRead() : Promise.resolve(ready), saveIntegration: async enabled => {
    saves.push(enabled)
    if (saveGate) await saveGate.promise
    store.set({ state: { config: { contextCostsEnabled: enabled, contextCostsPromptSeen: true } } })
  } }
  const plugin = client.plugin(ctx => {
    manager = ui.createContextIntegration(ctx, api, store, () => 'en', reactDom.createPortal)
    ctx.effect(() => manager.dispose, 'test: integration lifetime')
  })
  await plugin
  await settle()
  const fixture = { client, slots, store, manager, plugin, originals, saves, listeners, installPeer, uninstallPeer,
    collapseDeclaration: () => disposeDeclaration(), restoreDeclaration: declare,
    dispose: async () => { manager.dispose(); await plugin.dispose(); await client.fiber.dispose(); await settle() } }
  fixtures.push(fixture)
  return fixture
}
function bridgeEntries(env) { return targets.flatMap(([name]) => env.slots.entries(name).filter(entry => entry.registrant === registrant)) }
function assertOriginals(env) {
  for (const [name] of targets) assert.ok(env.slots.entries(name).includes(env.originals.get(name)), name + ': original registration identity is preserved')
}
function assertHeader(env) {
  const tabs = hostHeaderTabs(env.slots)
  assert.equal(tabs.filter(tab => tab.id === 'context').length, 1, 'published host header contains exactly one native Context tab')
  assert.equal(tabs.find(tab => tab.id === 'context').label, 'Context', 'native label is preserved')
  assert.equal(env.slots.entries('conversation.view').length, 1, 'the raw conversation view ledger stays unchanged')
}
function assertOff(env) {
  assert.equal(bridgeEntries(env).length, 0, 'disabling removes every owned main/sidebar/modal registration')
  assertOriginals(env); assertHeader(env)
}
function assertOn(env) {
  assertOriginals(env); assertHeader(env)
  assert.equal(bridgeEntries(env).length, 3, 'there is exactly one owned contribution for each surface')
  assert.equal(env.slots.entries('conversation.input.overlay').filter(entry => entry.options.id === 'cost-meter-context-main').length, 1, 'main card adapter has a fixed non-tab registration')
  for (const [name, key, id] of targets.slice(1)) {
    const winner = env.slots.entriesOfSlot(name).find(entry => entry.options[key] === id)
    assert.equal(winner?.registrant, registrant, name + ': one wrapper wins')
  }
}
try {
  for (const reentrant of [false, true]) {
    const env = await environment()
    assert.equal(env.manager.getSnapshot().available, true)
    const stop = reentrant ? env.client.on('slots/changed', () => env.store.set(env.store.getSnapshot())) : () => {}
    for (let cycle = 0; cycle < 5; cycle++) {
      await env.manager.choose(true); await settle(); assertOn(env)
      env.manager.refresh(); await settle(); assertOn(env)
      await env.manager.choose(false); await settle(); assertOff(env)
    }
    await Promise.all([env.manager.choose(true), env.manager.choose(false), env.manager.choose(true)])
    await settle(); assertOn(env)
    assert.deepEqual(env.saves.slice(-3), [true, false, true], 'rapid choices persist in request order')
    await env.manager.choose(false); await settle(); assertOff(env)
    stop(); await env.dispose()
    assert.equal(env.listeners.size, 0, 'unload releases the store subscription')
    console.log('[ok] real SlotRegistry: native header, original identity, five switches, rapid writes, refresh and unload; reentrant=' + reentrant)
  }

  const replacement = await environment()
  await replacement.manager.choose(true); await settle(); assertOn(replacement)
  replacement.uninstallPeer(); await settle()
  assert.equal(replacement.manager.getSnapshot().available, false)
  assert.equal(bridgeEntries(replacement).length, 0, 'peer removal tears down all owned contributions')
  replacement.installPeer(); await settle(); assertOn(replacement)
  replacement.collapseDeclaration(); replacement.uninstallPeer(); await settle()
  assert.equal(replacement.manager.getSnapshot().available, false, 'collapsed host declarations disable integration')
  assert.equal(bridgeEntries(replacement).length, 0, 'declaration collapse leaves no owned entries')
  replacement.restoreDeclaration(); replacement.installPeer(); await settle(); assertOn(replacement)
  // A competing higher-priority owner must not be overridden or removed.
  const stopCompetitor = replacement.slots.register({ name: 'conversation.view', id: 'context', priority: -10, registrant: 'another-plugin' }, () => null)
  await settle()
  assert.equal(replacement.slots.entries('conversation.input.overlay').filter(entry => entry.options.id === 'cost-meter-context-main').length, 0, 'main adapter stops when a different component owns that view')
  assert.equal(replacement.slots.entriesOfSlot('conversation.view').find(entry => entry.options.id === 'context').registrant, 'another-plugin')
  assertOriginals(replacement)
  stopCompetitor(); await settle(); assertOn(replacement)
  await replacement.plugin.dispose(); await settle(); assertOff(replacement)
  assert.equal(replacement.listeners.size, 0)
  // Changes after unload must not resurrect a controller or orphan subscription.
  replacement.uninstallPeer(); replacement.installPeer(); await settle()
  assert.equal(bridgeEntries(replacement).length, 0)
  await replacement.client.fiber.dispose()
  console.log('[ok] peer uninstall/reinstall, declaration collapse/recreation, competing owner, plugin unload and post-unload mutation')

  for (const action of ['disable', 'dispose']) {
    const env = await environment(); let interrupted = false, closing
    const stop = env.client.on('slots/changed', () => {
      if (interrupted || bridgeEntries(env).length === 0) return
      interrupted = true
      if (action === 'disable') closing = env.manager.choose(false)
      else env.manager.dispose()
    })
    await env.manager.choose(true); await closing; await settle()
    assert.ok(interrupted, action + ' occurs synchronously during registration')
    assertOff(env)
    if (action === 'disable') assert.equal(env.manager.getSnapshot().enabled, false)
    else assert.equal(env.listeners.size, 0)
    stop(); await env.dispose()
    console.log('[ok] ' + action + ' during a synchronous registration event leaves no owned entries')
  }

  const failure = await environment()
  let subscriptions = 0
  const failingSlots = {
    entries: name => failure.slots.entries(name), entriesOfSlot: name => failure.slots.entriesOfSlot(name),
    spec: name => failure.slots.spec(name), subscribe: (name, fn) => {
      subscriptions++
      const stop = failure.slots.subscribe(name, fn)
      return () => { subscriptions--; stop() }
    }, register: (options, component) => {
      if (options.name === 'sidebar.right.pane.tab') throw new Error('synthetic second registration failure')
      return failure.slots.register(options, component)
    },
  }
  assert.throws(() => ui.installContextCosts({ get: () => failingSlots }, {}, () => 'en', reactDom.createPortal, failure.store), /synthetic second registration failure/)
  await settle(); assertOff(failure)
  assert.equal(subscriptions, 0, 'partial installation failure releases all installed subscriptions')
  await failure.dispose()
  console.log('[ok] partial installation failure rolls back owned entries and subscriptions')

  const checkGate = deferred(), checking = await environment({ peerRead: () => checkGate.promise })
  checking.manager.dispose(); checkGate.resolve(ready); await settle(); assertOff(checking)
  assert.equal(checking.listeners.size, 0)
  await checking.dispose()
  const saveGate = deferred(), saving = await environment({ saveGate })
  const write = saving.manager.choose(true)
  await settle(); saving.manager.dispose(); saveGate.resolve(); await write; await settle(); assertOff(saving)
  assert.equal(saving.listeners.size, 0)
  await saving.dispose()
  console.log('[ok] late compatibility and settings results cannot install after disposal')

  await settle()
  assert.equal(asyncErrors.length, 0, 'no stale async listeners or inactive-context errors: ' + asyncErrors.map(String).join('; '))
  assert.equal([...documentListeners.values(), ...windowListeners.values()].reduce((count, set) => count + set.size, 0), 0, 'all browser event subscriptions are released')
} finally {
  for (const fixture of fixtures) await fixture.dispose()
  process.removeListener('uncaughtException', recordError)
  process.removeListener('unhandledRejection', recordError)
}
