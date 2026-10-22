import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.community.js', import.meta.url), 'utf8')
function fixture(storage = new Map(), blocked = false) {
  let factory, hook = 0, hooks = []
  const listeners = new Map(), styles = [], cleanups = []
  const window = {
    __ModuleLoader__: { load: module => { factory = module.factory } },
    localStorage: {
      getItem: key => { if (blocked) throw Error('storage disabled'); return storage.get(key) ?? null },
      setItem: (key, value) => { if (blocked) throw Error('storage disabled'); storage.set(key, value) },
    },
    addEventListener: (key, fn) => listeners.set(key, fn),
    removeEventListener: key => listeners.delete(key),
  }
  vm.runInNewContext(source, {
    window,
    document: { createElement: () => ({ remove() { styles.pop() } }), head: { appendChild: style => styles.push(style) } },
  })
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: initial => {
      const i = hook++
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
      return [hooks[i], value => { hooks[i] = value }]
    },
    useEffect: effect => { const i = hook++; if (!(i in hooks)) { hooks[i] = true; cleanups.push(effect()) } },
  }
  const Community = factory(name => { assert.equal(name, 'react'); return React }).mount({ effect: effect => cleanups.push(effect()) })
  return {
    render(locale = 'zh', footer = false) { hook = 0; return Community({ locale, footer }) },
    remount() { hooks = [] },
    sync(event) { listeners.get('storage')(event) },
    dispose() { for (const cleanup of cleanups) cleanup?.() },
    styles, listeners,
  }
}
const nodes = node => [node, ...node.children.filter(child => child && typeof child === 'object').flatMap(nodes)]
const storage = new Map()
let ui = fixture(storage)
const notice = ui.render()
assert.equal(notice.type, 'aside')
assert.equal(notice.props.role, 'status', 'community notice stays in-page without a modal')
const qrLink = nodes(notice).find(node => node.type === 'a')
assert.equal(decodeURI(qrLink.props.href), 'https://github.com/Han-1413141/dsh-cost-meter/blob/master/README.zh-CN.md#交流与反馈')
assert.equal(qrLink.props.rel, 'noopener noreferrer')
const close = nodes(notice).find(node => node.type === 'button')
assert.equal(close.props['aria-label'], '关闭交流群提示')
close.props.onClick()
assert.equal(ui.render(), null, 'closing removes the top notice completely')
assert.equal(ui.render('zh', true).type, 'footer', 'the permanent entry belongs in the settings footer')
assert.equal(nodes(ui.render('zh', true)).filter(node => node.type === 'button').length, 0)
ui.remount()
assert.equal(ui.render(), null, 'leaving and reopening settings preserves dismissal')
ui.dispose()
assert.equal(ui.styles.length, 0)
assert.equal(ui.listeners.size, 0)
ui = fixture(storage)
assert.equal(ui.render(), null, 'a new module/browser session reads the saved dismissal')
assert.match(nodes(ui.render('en', true)).find(node => node.type === 'a').props.href, /README\.md#community$/)
ui.dispose()

ui = fixture(new Map(), true)
nodes(ui.render()).find(node => node.type === 'button').props.onClick()
ui.remount()
assert.equal(ui.render(), null, 'unavailable storage never prevents closing or same-session reopening')
ui.dispose()

ui = fixture()
ui.render()
ui.sync({ key: 'unrelated', newValue: '1' })
assert.equal(ui.render().type, 'aside')
ui.sync({ key: 'dsh-cost-meter:community-notice-seen', newValue: '1' })
assert.equal(ui.render(), null, 'another window can dismiss the notice through the storage event')
ui.dispose()
console.log('[ok] 交流群提示：立即关闭、重开与刷新持久化、英文入口、存储不可用兜底及监听清理')
