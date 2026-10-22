/** Official Qianwen CLI bridge (#146). Credentials remain owned by the CLI. */
import { bridgeCode, resolveNpmCli, runCliJson } from './cli-bridge.js'

export const QWEN_CLI_ARGS = Object.freeze(['usage', 'summary', '--format', 'json'])
export const QWEN_SUBSCRIPTION_ARGS = Object.freeze(['subscription', 'status', '--format', 'json'])
export const QWEN_CLI_TIMEOUT_MS = 15000
export const QWEN_SUBSCRIPTION_TIMEOUT_MS = 60000
const MESSAGES = {
  zh: {
    missing: '未找到千问 CLI。请在 DSH 所在机器安装 @qianwenai/qianwen-cli，运行 qianwen auth login，并重启 DSH 以更新 PATH。',
    auth: '千问 CLI 未登录或登录已过期，请在 DSH 所用系统账号下运行 qianwen auth login。',
    failed: '千问 CLI 查询失败，请运行 qianwen usage summary --format json 检查后重试。',
    timeout: '千问 CLI 响应超时（额度查询本身可能需要 30 秒以上，未必是网络问题），请稍后刷新；若持续超时，请运行 qianwen subscription status --format json 检查耗时。',
    invalid: '千问 CLI 返回的订阅额度格式无效，请更新 CLI 后重试。',
    unavailable: '千问 CLI 未返回有效订阅额度（可能未订阅、已失效或上游查询失败），请检查 CLI 或切换本地估算。',
    expiry: 'CLI 订阅到期', addon: '加量包剩余',
  },
  en: {
    missing: 'Qianwen CLI not found. Install @qianwenai/qianwen-cli on the DSH host, run qianwen auth login, then restart DSH to refresh PATH.',
    auth: 'Qianwen CLI login is missing or expired. Run qianwen auth login as the same OS user running DSH.',
    failed: 'Qianwen CLI query failed. Check qianwen usage summary --format json and retry.',
    timeout: 'Qianwen CLI responded too slowly (quota queries can take over 30 seconds; this is not necessarily a network problem). Refresh later; if it keeps timing out, time qianwen subscription status --format json.',
    invalid: 'Qianwen CLI returned invalid subscription quota data. Update the CLI and retry.',
    unavailable: 'Qianwen CLI returned no valid subscription quota (unsubscribed, inactive, or an upstream failure). Check the CLI or select local estimates.',
    expiry: 'CLI subscription expiry', addon: 'Add-on remaining',
  },
}
const message = (locale, code) => MESSAGES[locale === 'en' ? 'en' : 'zh'][code]
const fail = (locale, code) => Object.assign(new Error(message(locale, code)), { code, soft: code === 'unavailable' || code === 'missing' || code === 'auth' })
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function parseQwenSummary(payload, locale = 'zh') {
  const plan = record(payload) ? payload.token_plan : null
  if (!record(plan) || typeof plan.subscribed !== 'boolean') throw fail(locale, 'invalid')
  // The official CLI absorbs some upstream failures into subscribed=false.
  // Exhausted subscriptions also have subscribed=false in CLI 1.6.x, but their
  // explicit status and valid credit totals still provide a usable 100% reading.
  if ((!plan.subscribed && plan.status !== 'exhaust') || (plan.status !== undefined && !['valid', 'exhaust'].includes(plan.status))) throw fail(locale, 'unavailable')
  const total = plan.totalCredits, remaining = plan.remainingCredits
  if (!finite(total) || total <= 0 || !finite(remaining) || remaining > total) throw fail(locale, 'invalid')
  const used = total - remaining
  const fmt = value => value.toLocaleString('en-US', { maximumFractionDigits: 6 })
  const windows = {
    // Do not feed the ambiguous CLI period into monthly token estimates.
    quota: { percent: Math.round(used / total * 1000) / 10, resetsAt: '' },
    credits: { resetsAt: '', text: `${fmt(used)} / ${fmt(total)} Credits (CLI)` },
  }
  if (plan.addonRemaining !== undefined) {
    if (!finite(plan.addonRemaining)) throw fail(locale, 'invalid')
    windows.addon = { resetsAt: '', text: `${message(locale, 'addon')}: ${fmt(plan.addonRemaining)} Credits` }
  }
  // CLI 1.6.x maps resetDate from subscription EndTime, not the monthly reset.
  // Render it as text; never use it as a quota reset or a sampling boundary.
  if (typeof plan.resetDate === 'string' && plan.resetDate.length > 0) {
    const ms = Date.parse(plan.resetDate)
    if (!Number.isFinite(ms)) throw fail(locale, 'invalid')
    windows.expiry = { resetsAt: '', text: `${message(locale, 'expiry')}: ${new Date(ms).toISOString()}` }
  }
  return { windows }
}

// CLI individual subscriptions expose monthly/weekly percentages even when the
// legacy usage summary says subscribed=false (#260). usedPct is already 0–100.
// Source: QianWen-AI/qianwen-cli@054b874, src/services/tokenplan-service.ts.
export function parseQwenSubscription(payload, locale = 'zh') {
  if (!record(payload)) throw fail(locale, 'invalid')
  const plan = payload.individual
  if (!record(plan) || plan.status !== 'active') throw fail(locale, 'unavailable')
  const windows = {}
  for (const [key, field] of [['monthly', 'monthlyCredits'], ['weekly', 'weeklyCredits']]) {
    const quota = plan[field]
    if (quota == null) continue
    if (!record(quota) || !finite(quota.usedPct) || quota.usedPct > 100) throw fail(locale, 'invalid')
    let resetsAt = ''
    if (quota.resetTime != null) {
      if (typeof quota.resetTime !== 'string' || !Number.isFinite(Date.parse(quota.resetTime))) throw fail(locale, 'invalid')
      resetsAt = new Date(quota.resetTime).toISOString()
    }
    windows[key] = { percent: quota.usedPct, resetsAt }
    if (quota.total != null) {
      if (!finite(quota.total) || quota.total <= 0) throw fail(locale, 'invalid')
      const label = locale === 'en' ? `${key === 'monthly' ? 'Monthly' : 'Weekly'} total` : `${key === 'monthly' ? '月' : '周'}总额度`
      // Upstream omits unknown absolute used/remaining Credits. Keep that boundary
      // instead of presenting Credits derived from a rounded percentage as exact.
      windows[key + 'Credits'] = { resetsAt: '', text: `${label}: ${quota.total.toLocaleString('en-US', { maximumFractionDigits: 6 })} Credits (CLI)` }
    }
  }
  if (!Object.keys(windows).length) throw fail(locale, 'unavailable')
  return { windows }
}

/** Resolve PATH without a shell; Windows npm .cmd shims are never evaluated. */
export const resolveQwenCli = (options = {}) =>
  resolveNpmCli({ packageName: '@qianwenai/qianwen-cli', binName: 'qianwen', ...options })
export async function queryQwenCli(locale = 'zh', options = {}) {
  const command = await resolveQwenCli(options)
  if (!command) throw fail(locale, 'missing')
  // CLI 1.10 takes ~5 s for usage summary but 30–36 s for subscription status,
  // so the fallback gets its own budget; an explicit timeoutMs applies to both.
  const { env = process.env, signal, timeoutMs, maxBuffer = 1024 * 1024, runJson = runCliJson } = options
  const run = async (args, defaultTimeoutMs) => {
    try {
      return await runJson({ ...command, args: [...command.args, ...args], env, signal, timeoutMs: timeoutMs ?? defaultTimeoutMs, maxBuffer })
    } catch (error) {
      // Never expose child output, command paths or credential-bearing errors.
      throw fail(locale, bridgeCode(error, { authExitCode: 2 }))
    }
  }
  const payload = await run(QWEN_CLI_ARGS, QWEN_CLI_TIMEOUT_MS)
  try {
    return parseQwenSummary(payload, locale)
  } catch (error) {
    if (!['unavailable', 'invalid'].includes(error.code)) throw error
  }
  return parseQwenSubscription(await run(QWEN_SUBSCRIPTION_ARGS, QWEN_SUBSCRIPTION_TIMEOUT_MS), locale)
}
