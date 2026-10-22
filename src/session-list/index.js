/** Session row amounts, loaded only when enabled. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.session-list.js', factory: require => {
    const React = require('react'), { createElement: el, useEffect, useRef, useSyncExternalStore } = React
    const number = value => { if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('Invalid session amount'); return value }
    const string = value => { if (typeof value !== 'string') throw Error('Invalid session identity'); return value }
    const parseQuery = value => {
      if (!Array.isArray(value?.sessionIds) || value.sessionIds.length > 100 || !value.sessionIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 512) || !['total', 'today'].includes(value.period)) throw Error('Invalid session list query')
      return { sessionIds: value.sessionIds, period: value.period }
    }
    const parseRows = value => {
      if (!Array.isArray(value)) throw Error('Invalid session list amounts')
      return value.map(row => {
        if (typeof row?.found !== 'boolean') throw Error('Invalid session amount status')
        return { id: string(row.id), found: row.found,
          ...Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'calls', 'cost'].map(key => [key, number(row[key])])),
          ...Object.fromEntries(['apiCost', 'reasoning', 'costCny', 'apiCostCny', 'costEur', 'apiCostEur'].filter(key => row[key] !== undefined).map(key => [key, number(row[key])])) }
      })
    }
    const codec = (name, parse) => { const schema = { parse }; return { mode: 'strict', typeSymbol: 'dsh-cost-meter#' + name, schema, create: () => schema } }
    const CONTRIBUTION = { package: 'dsh-cost-meter-session-list', face: 'host', descriptors: [{ id: 'dsh-cost-meter#costMeter/getSessionListCosts', service: 'costMeter', namespace: 'costMeter', method: 'getSessionListCosts', invocation: { kind: 'direct' },
      parameters: [{ name: 'query', wire: 'query', source: 'json', codec: codec('SessionListQuery', parseQuery) }], result: codec('SessionListCosts', parseRows) }] }

    function createBatchReader(read, current) {
      const visible = new Map(), cache = new Map(), listeners = new Set()
      let revision = 0, generation = 0, timer, pending = false, disposed = false
      const publish = () => { revision++; for (const listener of listeners) listener() }
      const schedule = () => { if (!disposed && !timer) timer = setTimeout(flush, 30) }
      async function flush() {
        timer = null
        const state = current()
        if (disposed || pending || !state?.config?.sessionListCosts || document.hidden) return
        const ids = [...visible.keys()].filter(id => Date.now() - (cache.get(id)?.at ?? 0) >= 5000).slice(0, 100)
        if (!ids.length) return
        const stamp = generation; pending = true
        try {
          const rows = parseRows(await read({ sessionIds: ids, period: state.config.sessionListCostPeriod ?? 'total' }))
          if (disposed || generation !== stamp) return
          for (const row of rows) if (ids.includes(row.id)) cache.set(row.id, { at: Date.now(), row })
          while (cache.size > 500) cache.delete(cache.keys().next().value)
          publish()
        } catch { /* Keep known amounts on a transient read failure; missing data remains —. */ }
        finally { pending = false; if (!disposed && (generation !== stamp || [...visible.keys()].some(id => !ids.includes(id) && !cache.has(id)))) schedule() }
      }
      return {
        subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, snapshot: () => revision,
        row: id => cache.get(id)?.row,
        show: id => { visible.set(id, (visible.get(id) ?? 0) + 1); schedule(); return () => { const count = visible.get(id) - 1; if (count > 0) visible.set(id, count); else visible.delete(id) } },
        refresh: schedule,
        invalidate: () => { generation++; cache.clear(); publish(); schedule() },
        dispose: () => { disposed = true; generation++; clearTimeout(timer); visible.clear(); cache.clear(); listeners.clear() },
      }
    }

    async function mount(ctx, source, resolveLocale, { formatMoneyUsd, displayCostOf, formatTokens }) {
      const unmount = await ctx.get('remote').$mount(CONTRIBUTION), remote = ctx.get('remote.costMeter')
      const current = () => source.getSnapshot().state
      const reader = createBatchReader(async query => {
        const result = await remote.getSessionListCosts(query)
        if (!result?.ok) throw Error('Session list amounts unavailable')
        return result.value
      }, current)
      const style = document.createElement('style')
      style.textContent = '.cm-session-list-price{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;order:-1}.cm-session-list-detail{font-size:12px;white-space:pre-line;color:var(--dsw-alias-label-secondary)}span:has(>.cm-session-list-price){display:inline-flex}:not(:hover):not(:focus-within)>span:has(>.cm-session-list-price)>:not(.cm-session-list-price){display:none}'
      document.head.append(style)
      function Row({ sessionId, detail = false }) {
        const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot), state = snapshot.state, config = state?.config ?? {}, node = useRef(null)
        useSyncExternalStore(reader.subscribe, reader.snapshot)
        const enabled = config.sessionListCosts === true
        useEffect(() => {
          if (!enabled || !sessionId) return
          let hide
          if (detail || typeof IntersectionObserver === 'undefined') return reader.show(sessionId)
          const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { if (!hide) hide = reader.show(sessionId) }
            else { hide?.(); hide = null }
          })
          if (node.current) observer.observe(node.current)
          return () => { observer.disconnect(); hide?.() }
        }, [sessionId, enabled, detail])
        if (!enabled) return null
        const row = reader.row(sessionId), en = resolveLocale(config) === 'en'
        const label = config.sessionListCostPeriod === 'today' ? (en ? 'Today' : '今日') : (en ? 'Total' : '累计')
        const money = row?.found ? formatMoneyUsd(displayCostOf(row, config), config) : '—'
        const title = label + ' ' + money + (row?.found ? '\n' + (en ? 'Input ' : '输入 ') + formatTokens(row.input) + ' · ' + (en ? 'Cache ' : '缓存 ') + formatTokens(row.cacheRead + row.cacheWrite) + ' · ' + (en ? 'Output ' : '输出 ') + formatTokens(row.output) : '')
        return el(detail ? 'div' : 'span', { ref: node, className: detail ? 'cm-session-list-detail' : 'cm-session-list-price', title, 'aria-label': title }, detail ? title : money)
      }
      const slots = ctx.get('slots'), disposers = []
      for (const [name, detail] of [['sidebar.workspaces.session.row.action', false], ['sidebar.session.row.hover', true]]) {
        const register = () => slots.register({ name, id: 'cost-meter-session-list', order: 10 }, props => el(Row, { ...props, detail }))
        disposers.push(slots.inject(name, register))
      }
      let key
      const sync = () => {
        const state = current(), next = JSON.stringify([state?.config?.sessionListCosts, state?.config?.sessionListCostPeriod, state?.config?.includeSubagentCost, state?.meta?.dayKey, state?.total?.calls, state?.total?.cost])
        if (next !== key) { key = next; reader.invalidate() }
      }
      sync()
      const stop = source.subscribe(sync), interval = setInterval(reader.refresh, 10000)
      document.addEventListener('visibilitychange', reader.refresh)
      ctx.effect(() => () => { stop(); clearInterval(interval); document.removeEventListener('visibilitychange', reader.refresh); reader.dispose(); style.remove(); for (const dispose of disposers) dispose?.(); unmount() }, 'cost-meter: session list amounts')
      return { Row }
    }
    return { mount, CONTRIBUTION, createBatchReader, parseQuery, parseRows }
  },
})
