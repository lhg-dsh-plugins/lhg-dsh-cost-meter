// Exercise the same mount -> React component contract used by the main lazy loader.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

for (const path of ['../src/codex/index.js', '../lib/client.codex.js']) {
  let factory
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useRef: value => ({ current: value }), useEffect() {}, useState: value => [typeof value === 'function' ? value() : value, () => {}],
  }
  vm.runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: spec => { factory = spec.factory } } },
  })
  const page = factory(() => React).mount()
  assert.equal(typeof page, 'function', `${path}: mount returns a renderable component, as other lazy chunks do`)
  const text = node => node == null ? '' : typeof node === 'object' ? node.children.map(text).join('') : String(node)
  const state = { codexCompat: { installed: true, enabled: true, version: '3.0.0', planClass: 'plan', promptDue: false,
    usage: { calls: 22, cost: 2, tokens: 15000, days: 2 }, historyAppliedAt: 0 } }
  const props = { state, view: 'panel', t: key => key, api: {}, locale: 'zh' }
  const render = value => { const element = page(value); return element.type(element.props) }
  assert.ok(text(render(props)).includes('检测版本：v3.0.0'))
  assert.ok(text(render(props)).includes('22 次调用'))
  assert.ok(text(render({ ...props, locale: 'en' })).includes('Detected version: v3.0.0'))
  assert.equal(render({ ...props, state: { codexCompat: { installed: false } } }), null)
  assert.equal(render({ ...props, state: { codexCompat: { ...state.codexCompat, enabled: false } } }), null, 'installed but disabled plugin has no settings panel')
  assert.equal(render({ ...props, view: 'prompt', state: { codexCompat: { ...state.codexCompat, enabled: false, promptDue: true } } }), null, 'disabled plugin cannot show a stale prompt')
  assert.equal(render({ ...props, view: 'prompt' }), null, 'dismissed prompt does not render or reclassify anything')
  const prompt = render({ ...props, view: 'prompt', state: { codexCompat: { ...state.codexCompat, promptDue: true } } })
  assert.equal(prompt.type, 'dialog')
  assert.ok(text(prompt).includes('保持现状'))
  assert.ok(text(prompt).includes('统一归类为 Plan'))
}
console.log('[ok] Codex lazy chunk: renderable mount, actual panel, bilingual usage, missing plugin and gated one-time prompt (source + bundle)')

const nodes = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : []
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function fixture(path, storage = new Map(), blocked = false) {
  let factory, hook = 0, hooks = [], effects = [], cleanups = [], closed = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useRef: initial => { const i = hook++; return hooks[i] ??= { current: initial } },
    useState: initial => {
      const i = hook++
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
      return [hooks[i], value => { hooks[i] = value }]
    },
    useEffect: effect => { const i = hook++; if (!(i in hooks)) { hooks[i] = true; effects.push(effect) } },
  }
  vm.runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    Promise,
    window: { __ModuleLoader__: { load: spec => { factory = spec.factory } }, localStorage: {
      getItem: key => { if (blocked) throw Error('storage blocked'); return storage.get(key) ?? null },
      setItem: (key, value) => { if (blocked) throw Error('storage blocked'); storage.set(key, value) },
    } },
  })
  const page = factory(() => React).mount()
  const props = { view: 'prompt', locale: 'zh', t: key => key,
    state: { codexCompat: { installed: true, enabled: true, promptDue: true, usage: {} } }, api: {} }
  return {
    props,
    render() {
      hook = 0
      const component = page(props), node = component.type(component.props)
      if (node?.type === 'dialog') node.props.ref.current = { open: false, showModal() { this.open = true }, close() { closed++; this.open = false } }
      for (const effect of effects.splice(0)) cleanups.push(effect())
      return node
    },
    remount() { for (const cleanup of cleanups) cleanup?.(); cleanups = []; hooks = [] },
    get closed() { return closed },
  }
}
for (const path of ['../src/codex/index.js', '../lib/client.codex.js']) {
  for (const action of ['close', 'escape', 'keep']) for (const blocked of [false, true]) {
    const storage = new Map(), ui = fixture(path, storage, blocked)
    let applications = 0, dismissals = 0, rejectApply
    ui.props.api = {
      applyCodexCompatHistory: () => { applications++; return new Promise((_, reject) => { rejectApply = reject }) },
      dismissCodexCompat: () => { dismissals++; return Promise.reject(Error('HTTP 404')) },
    }
    let prompt = ui.render()
    nodes(prompt).find(node => node.props.className === 'cm-btn primary').props.onClick()
    await settle()
    prompt = ui.render()
    assert.equal(nodes(prompt).find(node => node.props.className === 'cm-btn primary').props.disabled, true)
    const buttons = nodes(prompt).filter(node => node.type === 'button')
    assert.ok(!buttons[0].props.disabled && !buttons[1].props.disabled, 'closing stays available while apply is pending')
    if (action === 'escape') prompt.props.onCancel({ preventDefault() {} })
    else buttons[action === 'close' ? 0 : 1].props.onClick()
    assert.equal(ui.closed, 1, 'native dialog closes synchronously, before the RPC settles')
    assert.equal(ui.render(), null)
    await settle()
    assert.equal(dismissals, 1)
    rejectApply(Error('HTTP 404')); await settle()
    assert.equal(ui.render(), null, 'failed apply and failed dismiss cannot reopen the modal')
    assert.equal(applications, 1, 'dismissal never applies historical changes')
    ui.remount(); assert.equal(ui.render(), null, 'reopening the UI keeps the prompt dismissed')
    if (!blocked) assert.equal(fixture(path, storage).render(), null, 'reloading the chunk respects browser persistence')
  }
  const ui = fixture(path)
  ui.props.view = 'panel'
  ui.props.api.applyCodexCompatHistory = () => { throw Error('HTTP 404') }
  nodes(ui.render()).find(node => node.type === 'button').props.onClick()
  await settle()
  assert.ok(nodes(ui.render()).some(node => node.props.role === 'alert' && node.children.join('').includes('HTTP 404')), 'settings show action errors instead of swallowing them')
}
console.log('[ok] Codex close/ESC/keep: immediate during pending apply, rejected RPC, persistent dismissal, blocked storage and visible settings errors (source + bundle)')
