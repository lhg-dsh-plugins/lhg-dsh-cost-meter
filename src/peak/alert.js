    function PeakAlert(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const config = costStore?.state?.config
      const [now, setNow] = useState(Date.now())
      const [dismissedAt, setDismissedAt] = useState(null)
      const [preview, setPreview] = useState(null)
      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 10000)
        return () => window.clearInterval(timer)
      }, [])
      // 预览通道:监听自定义事件(事件由 activate 顶层的 window.cmPeakAlertPreview 派发),
      // 组件挂载期间置在线标志,供 API 判断弹窗宿主是否可用。
      useEffect(() => {
        const onPreview = event => {
          const kind = event.detail?.kind === 'offpeak' ? 'offpeak' : 'peak'
          setPreview(kind)
          // 预览系统通知:遵循 Web 通知开关与授权,标题加预览标记。
          const cfg = costStore?.state?.config
          if (cfg?.peakAlertWebNotify === true && window.Notification && Notification.permission === 'granted') {
            const pt = makeT(resolveLocale(cfg))
            try {
              new Notification(pt(kind === 'peak' ? 'peakAlertTitlePeak' : 'peakAlertTitleOffPeak') + pt('peakAlertPreviewTag'),
                { body: pt('peakAlertBody', { time: pt('countdownMinute', { m: 2 }), phase: pt(kind === 'peak' ? 'peakAlertPhasePeak' : 'peakAlertPhaseOffPeak') }) })
            } catch (_) { /* 通知被系统拒绝时静默 */ }
          }
        }
        window.addEventListener(PEAK_ALERT_PREVIEW_EVENT, onPreview)
        window.__cmPeakAlertLive = true
        return () => {
          window.removeEventListener(PEAK_ALERT_PREVIEW_EVENT, onPreview)
          window.__cmPeakAlertLive = false
        }
      }, []) // eslint-disable-line react-hooks/exhaustive-deps
      useEffect(() => {
        // Web 通知:每次 tick 自包含重算切换点,按切换点(nextAtMs)在模块级去重,
        // 同一切换点只发一次(旧实现比较 tick 时间戳,每 10 秒都"未通知过",会连发)。
        if (!config || config.peakAlertEnabled !== true || config.peakEnabled !== true) return
        if (config.peakAlertWebNotify !== true || !window.Notification || Notification.permission !== 'granted') return
        const wv = peakPhaseAt(now, Array.isArray(config.peakWindows) ? config.peakWindows : [], config.peakHolidays)
        if (wv === null) return
        const tgt = config.peakAlertTarget === 'peak' || config.peakAlertTarget === 'offpeak' ? config.peakAlertTarget : 'both'
        const intoPeak = wv.nextIntoPeak === true
        if (tgt !== 'both' && tgt !== (intoPeak ? 'peak' : 'offpeak')) return
        const mins = Number(config.peakAlertAhead)
        const aheadMs = (Number.isFinite(mins) && mins >= 1 ? mins : 2) * 60000
        if (now < wv.nextAtMs - aheadMs || now >= wv.nextAtMs) return
        if (lastPeakNotifyAtMs === wv.nextAtMs) return
        const t = makeT(resolveLocale(config))
        lastPeakNotifyAtMs = wv.nextAtMs
        try {
          new Notification(
            t(intoPeak ? 'peakAlertTitlePeak' : 'peakAlertTitleOffPeak'),
            { body: t('peakAlertBody', { time: countdownText(wv, now, t), phase: t(intoPeak ? 'peakAlertPhasePeak' : 'peakAlertPhaseOffPeak') }) })
        } catch (_) { /* 通知被系统拒绝时静默 */ }
      }, [now]) // eslint-disable-line react-hooks/exhaustive-deps
      if (!config || config.peakEnabled !== true) return null
      // 真实弹窗判定:提醒开关开启 + 已生效 + 相位/类型/提前量窗口内 + 未手动关闭。
      let real = null
      if (config.peakAlertEnabled === true) {
        const effectiveAtMs = Date.parse(config.peakEffectiveAt || '')
        if (!(Number.isFinite(effectiveAtMs) && now < effectiveAtMs)) {
          const view = peakPhaseAt(now, Array.isArray(config.peakWindows) ? config.peakWindows : [], config.peakHolidays)
          if (view !== null) {
            const target = config.peakAlertTarget === 'peak' || config.peakAlertTarget === 'offpeak' ? config.peakAlertTarget : 'both'
            const aheadMinutes = Number(config.peakAlertAhead)
            const aheadMs = (Number.isFinite(aheadMinutes) && aheadMinutes >= 1 ? aheadMinutes : 2) * 60000
            if ((target === 'both' || target === (view.nextIntoPeak ? 'peak' : 'offpeak'))
              && now >= view.nextAtMs - aheadMs && now < view.nextAtMs && dismissedAt !== view.nextAtMs) real = view
          }
        }
      }
      // 渲染:真实窗口激活用真实切换点;否则若有预览请求,用虚拟切换点(2 分钟后)。
      let view = null, intoPeak = false, dismiss = null
      if (real !== null) {
        view = real
        intoPeak = real.nextIntoPeak === true
        dismiss = () => setDismissedAt(real.nextAtMs)
      } else if (preview !== null) {
        view = { nextAtMs: now + 2 * 60000, nextIntoPeak: preview === 'peak' }
        intoPeak = preview === 'peak'
        dismiss = () => setPreview(null)
      } else return null
      const t = makeT(resolveLocale(config))
      const position = config.peakAlertPosition === 'center' ? 'cm-peak-alert-center' : 'cm-peak-alert-corner'
      return el(FloatingCard, { actions: { dismiss }, className: 'cm-peak-alert ' + position + ' ' + (intoPeak ? 'cm-peak-alert-peak' : 'cm-peak-alert-offpeak'), role: 'alert' },
        el('div', { className: 'cm-peak-alert-badge' }, t(intoPeak ? 'peakAlertBadgePeak' : 'peakAlertBadgeOffPeak')),
        el('div', { className: 'cm-peak-alert-title' }, t(intoPeak ? 'peakAlertTitlePeak' : 'peakAlertTitleOffPeak')),
        el('div', { className: 'cm-peak-alert-body' }, t('peakAlertBody', {
          time: countdownText(view, now, t),
          phase: t(intoPeak ? 'peakAlertPhasePeak' : 'peakAlertPhaseOffPeak'),
        })),
        el('div', { className: 'cm-peak-alert-actions' },
          el('button', { type: 'button', className: 'cm-btn', 'data-cm-action': 'dismiss', onClick: dismiss }, t('peakAlertBtn'))))
    }
