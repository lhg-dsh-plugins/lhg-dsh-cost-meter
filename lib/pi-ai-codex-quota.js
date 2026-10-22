/** Read the native pi-ai Codex OAuth record through DSH; return quota facts only. */
import * as credentialsApi from '@deepseek-ai/dsh-credentials'
import { fetchWithRetry, readJsonBounded } from './net.js'

const URL = 'https://chatgpt.com/backend-api/wham/usage'
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function parsePiAiCodexQuota(payload, now = Date.now()) {
  const windows = {}
  const limits = payload?.rate_limit
  for (const row of [limits?.primary_window, limits?.secondary_window]) {
    if (!object(row)) continue
    const name = row.limit_window_seconds === 18000 ? 'five' : row.limit_window_seconds === 604800 ? 'weekly' : null
    if (!name || typeof row.used_percent !== 'number' || !Number.isFinite(row.used_percent) || row.used_percent < 0 || row.used_percent > 100) continue
    const reset = typeof row.reset_at === 'number' && Number.isFinite(row.reset_at) && row.reset_at > 0 ? row.reset_at * 1000
      : typeof row.reset_after_seconds === 'number' && Number.isFinite(row.reset_after_seconds) && row.reset_after_seconds >= 0 ? now + row.reset_after_seconds * 1000 : NaN
    const date = new Date(reset)
    windows[name] = { percent: row.used_percent, resetsAt: Number.isFinite(date.getTime()) ? date.toISOString() : '' }
  }
  return Object.keys(windows).length ? windows : null
}

export function createPiAiCodexQuota(ctx, { enabled = () => true, locale = () => 'zh', fetchImpl, timeoutMs = 8000 } = {}) {
  let stopped = false, pending = null
  const controllers = new Set()
  const snapshot = (status, windows = {}, message = '') => ({ status, windows, message })
  const text = (zh, en) => locale() === 'en' ? en : zh
  return {
    read() {
      if (stopped || !enabled()) return Promise.resolve(snapshot('off'))
      if (pending) return pending
      const controller = new AbortController()
      controllers.add(controller)
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])
      let onAbort
      const cancelled = new Promise((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true }) })
      const operation = Promise.resolve().then(async () => {
        const credentials = ctx.get?.('credentials')
        // Older DSH hosts do not expose structured records; other Codex sources remain available.
        if (typeof credentials?.readRecord !== 'function' || typeof credentialsApi.credentialKey !== 'function') return snapshot('off')
        const record = await credentials.readRecord(credentialsApi.credentialKey('llm-pi-ai', 'openai-codex'))
        signal.throwIfAborted()
        const grant = record?.kind === 'grant' && object(record.payload) ? record.payload : null
        if (!grant || grant.type !== 'oauth' || typeof grant.access !== 'string' || !grant.access || /[\r\n]/.test(grant.access)) return snapshot('off')
        if (typeof grant.expires === 'number' && grant.expires <= Date.now()) return snapshot('error', {}, text('pi-ai Codex 登录已过期，请在模型设置中刷新登录后重试。', 'The pi-ai Codex login has expired. Refresh the login in model settings and retry.'))
        const accountId = typeof grant.accountId === 'string' && grant.accountId.length <= 512 && !/[\r\n]/.test(grant.accountId) ? grant.accountId : ''
        const response = await fetchWithRetry(URL, { method: 'GET', redirect: 'error', signal,
          headers: { accept: 'application/json', authorization: 'Bearer ' + grant.access, ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}) } }, { attempts: 1, timeoutMs, fetchImpl })
        if (!response.ok) {
          try { await response.body?.cancel?.() } catch {}
          return snapshot('error', {}, response.status === 401 || response.status === 403
            ? text('pi-ai Codex 登录无法读取额度，请在模型设置中确认登录状态。', 'The pi-ai Codex login cannot read quota. Check its sign-in status in model settings.')
            : text('pi-ai Codex 额度服务暂时不可用，请稍后重试。', 'The pi-ai Codex quota service is unavailable. Retry later.'))
        }
        const windows = parsePiAiCodexQuota(await readJsonBounded(response, 256 * 1024))
        signal.throwIfAborted()
        return windows ? snapshot('ok', windows) : snapshot('error', {}, text('pi-ai Codex 返回的额度数据无效。', 'The pi-ai Codex quota response is invalid.'))
      })
      const task = Promise.race([operation, cancelled]).catch(() => snapshot('error', {}, text('pi-ai Codex 额度查询未完成，请重试。', 'The pi-ai Codex quota query did not complete. Retry.')))
        .finally(() => { signal.removeEventListener('abort', onAbort); controllers.delete(controller); if (pending === task) pending = null })
      pending = task
      return task
    },
    dispose() { stopped = true; for (const controller of controllers) controller.abort() },
  }
}
