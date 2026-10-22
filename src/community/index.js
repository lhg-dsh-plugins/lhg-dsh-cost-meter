/** Community entry, loaded only when opening Cost settings. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.community.js',
  factory: require => {
    const React = require('react')
    const { createElement: el, useState, useEffect } = React
    // Keep this key across releases: updating the plugin must not renew the notice.
    const SEEN_KEY = 'dsh-cost-meter:community-notice-seen'
    const listeners = new Set()
    let dismissed = false
    function hasSeen() {
      if (dismissed) return true
      try { return window.localStorage.getItem(SEEN_KEY) === '1' } catch (_) { return false }
    }
    function Community({ locale, footer = false }) {
      const [seen, setSeen] = useState(hasSeen)
      const en = locale === 'en'
      const url = 'https://github.com/Han-1413141/dsh-cost-meter/blob/master/' + (en ? 'README.md#community' : 'README.zh-CN.md#交流与反馈')
      const dismiss = () => {
        dismissed = true
        try { window.localStorage.setItem(SEEN_KEY, '1') } catch (_) { /* Closing still works without browser storage. */ }
        setSeen(true)
        for (const update of listeners) update(true)
      }
      useEffect(() => {
        listeners.add(setSeen)
        const sync = event => { if (event.key === SEEN_KEY && event.newValue === '1') { dismissed = true; for (const update of listeners) update(true) } }
        window.addEventListener('storage', sync)
        return () => { listeners.delete(setSeen); window.removeEventListener('storage', sync) }
      }, [])
      const linkProps = { href: url, target: '_blank', rel: 'noopener noreferrer' }
      if (footer) return seen ? el('footer', { className: 'cm-community-entry' }, el('a', linkProps, en ? 'Community & feedback ↗' : '交流与反馈 ↗')) : null
      return seen ? null : el('aside', { className: 'cm-community-notice', role: 'status' },
          el('span', null, en ? 'The plugin WeChat group is open' : '插件交流群已开放'),
          el('a', linkProps, en ? 'View QR code ↗' : '查看二维码 ↗'),
          el('button', { type: 'button', className: 'cm-btn small', 'aria-label': en ? 'Dismiss community notice' : '关闭交流群提示', onClick: dismiss }, '×'))
    }
    function mount(ctx) {
      const style = document.createElement('style')
      style.textContent = '.cm-community-notice{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-secondary)}.cm-community-notice button{margin-left:auto;flex:none;min-width:28px;min-height:28px}.cm-community-notice a,.cm-community-entry a{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#4d6bfe));text-decoration:none}.cm-community-notice a:hover,.cm-community-entry a:hover{text-decoration:underline}.cm-community-entry{display:flex;border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px;font-size:12px}.cm-community-notice :focus-visible,.cm-community-entry a:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:3px;border-radius:4px}'
      // dsh-pocket 手机端适配(task-10):窄屏收紧提示条内边距;桌面端规则不变。
      style.textContent += '@media (max-width:1023px){.cm-community-notice{padding:8px 10px;gap:8px}}body[data-dsh-pocket-layout="mobile"] .cm-community-notice{flex-wrap:wrap}'
      document.head.appendChild(style)
      ctx.effect(() => () => style.remove(), 'cost-meter: community styles')
      return Community
    }
    return { mount }
  },
})
