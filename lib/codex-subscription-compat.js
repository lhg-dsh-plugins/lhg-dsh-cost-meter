/**
 * dsh-codex-subscription 兼容(契约 A/C/D)。
 *
 * dsh-codex-subscription 注册 `openai-codex` 等 LLM provider,用量消耗的是 ChatGPT
 * 订阅额度,不应计入 API 真金白银。本模块负责:
 *  1. 纯本地检测该插件是否安装(与本包同级的 node_modules / profile 目录 /
 *     $DSH_HOME/profiles/*);检测只读 package.json,任何异常按未安装处理;
 *     检测逻辑已泛化为 detectSubscriptionPackage(packageName, options),供其他
 *     订阅插件(如 @eddyskywalker/dsh-chatgpt-subscription)复用;
 *  2. 统计账本中按当前 plan 归属规则属于 codex 的历史用量;
 *  3. 生成下发客户端的兼容状态(一次性提示状态机 + 设置页数据);
 *  4. 启动时把 codex 归类写为 plan(新用量归 Plan),历史归类等待用户确认后经
 *     splitLedgerApiCost 统一重算(apiCost 归零)。
 *
 * **绝不发起网络请求**;文件系统只用于读取 dsh-codex-subscription 的 package.json。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { splitLedgerApiCost } from './store.js'
import { planProviderIdOf } from './plan-billing.js'

/** dsh-codex-subscription 的 npm 包名(检测与前端展示共用)。 */
export const CODEX_SUBSCRIPTION_PACKAGE = 'dsh-codex-subscription'

/** 历史归类完成的一次性账本迁移标记(ledger.migrations)。 */
const CODEX_COMPAT_MIGRATION_ID = 'codex-subscription-plan-v1'

/** 缺省文件系统接口;测试可注入假实现。 */
const DEFAULT_FS = { existsSync, readFileSync, readdirSync }
const NOT_INSTALLED = { installed: false, version: '', detection: 'none', packagePath: '' }

/** 有限数或 0(负值/NaN/字符串一律按 0,避免污染账本统计)。 */
const finiteOr0 = value => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 有限正数保留,否则归零(0 = 未应用)。 */
const positiveOr0 = value => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** moduleUrl(file: URL 或路径)→ 绝对路径;非法输入抛错由调用方兜底。 */
function modulePathOf(moduleUrl) {
  return moduleUrl.startsWith('file:') ? fileURLToPath(moduleUrl) : moduleUrl
}

/** 读取包清单;不存在/不可解析返回 null(检测静默降级)。 */
function readPackageJson(fsImpl, packagePath) {
  try {
    if (!fsImpl.existsSync(packagePath)) return null
    const parsed = JSON.parse(String(fsImpl.readFileSync(packagePath, 'utf8')))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return { version: typeof parsed.version === 'string' ? parsed.version : '', packagePath }
  } catch {
    return null
  }
}

/**
 * 泛化检测任意订阅插件包是否安装(纯本地,按序三条路径)。
 *
 * 三条路径:
 *  1. 与本模块同级的 node_modules(普通安装 / 依赖提升最常见形态);
 *  2. 显式 profile 目录(options.profileDir 或 env.DSH_PROFILE_DIR);
 *  3. $DSH_HOME/profiles/* 下全部 profile(排序取首个命中)。
 * 包名支持 scoped 形式(如 `@scope/name`);任何 fs/env 异常静默降级为未安装。
 *
 * @param packageName - npm 包名。
 * @param options - 可选注入(测试用):{ moduleUrl, env, homeDir, profileDir,
 *   fs: { existsSync, readFileSync, readdirSync } }。
 * @returns {{ installed: boolean, version: string, detection: 'package'|'profile'|'none', packagePath: string }}
 *   packagePath 为命中的 package.json 绝对路径;未安装时为空串。
 */
export function detectSubscriptionPackage(packageName, options = {}) {
  const name = typeof packageName === 'string' ? packageName.trim() : ''
  if (name.length === 0) return { ...NOT_INSTALLED }
  try {
    const fsImpl = options?.fs ?? DEFAULT_FS
    const env = options?.env ?? process.env
    const moduleUrl = typeof options?.moduleUrl === 'string' && options.moduleUrl.length > 0 ? options.moduleUrl : import.meta.url
    // 1) 与本包同级的 node_modules(普通安装 / 依赖提升最常见形态):
    //    <node_modules>/dsh-cost-meter/lib/xxx.js → 查 <node_modules>/<packageName>。
    const packageRoot = dirname(dirname(modulePathOf(moduleUrl)))
    if (basename(dirname(packageRoot)) === 'node_modules') {
      const hit = readPackageJson(fsImpl, join(dirname(packageRoot), name, 'package.json'))
      if (hit !== null) return { installed: true, version: hit.version, detection: 'package', packagePath: hit.packagePath }
    }
    // 2) 显式 profile 目录(DSH_PROFILE_DIR):<profileDir>/node_modules/<packageName>。
    const profileDir = options?.profileDir ?? env?.DSH_PROFILE_DIR
    if (typeof profileDir === 'string' && profileDir.trim().length > 0) {
      const hit = readPackageJson(fsImpl, join(profileDir, 'node_modules', name, 'package.json'))
      if (hit !== null) return { installed: true, version: hit.version, detection: 'profile', packagePath: hit.packagePath }
    }
    // 3) 全部 profile:<homeDir>/profiles/*/node_modules/<packageName>(排序取首个命中)。
    const homeDir = options?.homeDir
      ?? (typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0 ? env.DSH_HOME : resolveDshHome())
    if (typeof homeDir === 'string' && homeDir.trim().length > 0) {
      const profilesDir = join(homeDir, 'profiles')
      let names = []
      try { names = fsImpl.readdirSync(profilesDir) } catch { names = [] }
      const sorted = (Array.isArray(names) ? names : []).filter(name => typeof name === 'string').sort()
      for (const profileName of sorted) {
        const hit = readPackageJson(fsImpl, join(profilesDir, profileName, 'node_modules', name, 'package.json'))
        if (hit !== null) return { installed: true, version: hit.version, detection: 'profile', packagePath: hit.packagePath }
      }
    }
  } catch {
    // 检测失败(权限/损坏清单等)不能阻塞插件加载,按未安装处理。
  }
  return { ...NOT_INSTALLED }
}

/**
 * 检测 dsh-codex-subscription 是否安装(纯本地)。
 *
 * detectSubscriptionPackage 的薄包装:签名/返回结构/行为保持不变(既有测试依赖)。
 *
 * @param options - 同 detectSubscriptionPackage。
 */
export function detectCodexSubscription(options = {}) {
  return detectSubscriptionPackage(CODEX_SUBSCRIPTION_PACKAGE, options)
}

/** Current host runtime, including disabled parent groups. No credentials or requests. */
export function codexRuntimeEnabled(ctx) {
  try {
    const loader = typeof ctx?.get === 'function' ? ctx.get('loader') : ctx?.loader
    if (typeof loader?.entries === 'function') {
      for (const entry of loader.entries()) {
        if (entry.options?.name !== CODEX_SUBSCRIPTION_PACKAGE && entry.fiber?.runtime?.name !== 'codex-subscription') continue
        if (!entry.disabled && entry.options?.disabled !== true && entry.fiber?.state === 2) return true
      }
      return false
    }
    for (const runtime of ctx?.registry?.values?.() ?? []) {
      if (runtime.name !== 'codex-subscription') continue
      for (const fiber of runtime.fibers ?? []) if (fiber.state === 2 && !fiber.entry?.disabled) return true
    }
  } catch {}
  return false
}

/**
 * 统计账本中「按当前 plan 归属规则属于 codex」的全部历史用量。
 *
 * 只遍历 day.byProviderModel(day.sessions[*].byProviderModel 是同日会话明细,
 * 再遍历会重复计数);桶 key 按第一个 ':' 拆 provider/model。归属判定用
 * planProviderIdOf(与账本记账同源),不受 planBilling.providers.codex='api'
 * 这类分类开关影响——统计的是「哪些调用属于 codex 订阅渠道」。
 *
 * @param ledger - 账本(至少需要 days 与 config.planBilling)。
 * @returns {{ calls: number, cost: number, tokens: number, days: number, providers: string[] }}
 */
export function codexUsageOf(ledger) {
  const usage = { calls: 0, cost: 0, tokens: 0, days: 0, providers: [] }
  const days = ledger?.days
  if (days === null || typeof days !== 'object' || Array.isArray(days)) return usage
  const planBilling = ledger?.config?.planBilling
  const providers = new Set()
  let matchedDays = 0
  for (const day of Object.values(days)) {
    if (day === null || typeof day !== 'object') continue
    const buckets = day.byProviderModel
    if (buckets === null || typeof buckets !== 'object' || Array.isArray(buckets)) continue
    let matched = false
    for (const [key, bucket] of Object.entries(buckets)) {
      if (bucket === null || typeof bucket !== 'object') continue
      const sep = key.indexOf(':')
      const provider = sep >= 0 ? key.slice(0, sep) : key
      const model = sep >= 0 ? key.slice(sep + 1) : key
      if (planProviderIdOf(provider, planBilling, model) !== 'codex') continue
      matched = true
      usage.calls += finiteOr0(bucket.calls)
      usage.cost += finiteOr0(bucket.cost)
      usage.tokens += finiteOr0(bucket.input) + finiteOr0(bucket.output) + finiteOr0(bucket.cacheRead)
        + finiteOr0(bucket.cacheWrite) + finiteOr0(bucket.reasoning)
      providers.add(provider)
    }
    if (matched) matchedDays += 1
  }
  usage.days = matchedDays
  usage.providers = [...providers].sort()
  return usage
}

/** config.planBilling.providers.codex 的归一化分类:auto | plan | api。 */
function planClassOf(ledger) {
  const value = ledger?.config?.planBilling?.providers?.codex
  return value === 'plan' || value === 'api' ? value : 'auto'
}

/**
 * 组装下发给客户端的兼容状态(契约 C)。
 *
 * promptDue 状态机:仅当插件已安装、用户未永久关闭提示、且历史尚未归类时为 true。
 *
 * @param ledger - 账本。
 * @param detection - detectCodexSubscription() 结果(整个插件生命周期复用)。
 */
export function codexCompatStatus(ledger, detection, active = detection?.installed === true) {
  const info = detection !== null && typeof detection === 'object' ? detection : NOT_INSTALLED
  const installed = info.installed === true
  const enabled = installed && active === true
  const historyAppliedAt = positiveOr0(ledger?.config?.codexCompatHistoryAppliedAt)
  const promptDismissed = ledger?.config?.codexCompatPromptDismissed === true
  return {
    installed,
    enabled,
    version: typeof info.version === 'string' ? info.version : '',
    detection: ['package', 'profile', 'none'].includes(info.detection) ? info.detection : 'none',
    planClass: planClassOf(ledger),
    usage: codexUsageOf(ledger),
    historyAppliedAt,
    promptDismissed,
    promptDue: enabled && !promptDismissed && historyAppliedAt === 0,
  }
}

/**
 * 启动时调用:检测到 dsh-codex-subscription 且 codex 未显式配置分类时写入 'plan'
 * (只影响新用量)。**不调用 splitLedgerApiCost**:历史 apiCost 保持原样,等待用户
 * 在一次性提示里确认后由 applyCodexCompatHistory 统一重算。
 *
 * @returns 是否写入了配置。
 */
export function ensureCodexCompatPlan(ledger, detection) {
  if (detection?.installed !== true) return false
  const config = ledger?.config
  if (config === null || typeof config !== 'object') return false
  const billing = config.planBilling
  if (billing === null || typeof billing !== 'object' || Array.isArray(billing)) return false
  const current = billing.providers
  const providers = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : (billing.providers = {})
  // 用户手选过 plan / api:尊重显式配置,不覆盖。
  if (providers.codex === 'plan' || providers.codex === 'api') return false
  providers.codex = 'plan'
  ledger.scheduleWrite?.()
  return true
}

/**
 * 应用历史归类(契约 A):providers.codex='plan' → splitLedgerApiCost 重算历史
 * apiCost → 记录应用时刻 → 补迁移标记 → 落盘。
 *
 * 幂等:已应用且无桶被改时 changed=false,不重复改写时间戳。
 *
 * @returns {{ changed: boolean, usage: object }} usage 为应用前的统计快照。
 */
export function applyCodexCompatHistory(ledger, detection) {
  const usage = codexUsageOf(ledger)
  if (detection?.installed !== true) return { changed: false, usage }
  const config = ledger?.config
  if (config === null || typeof config !== 'object') return { changed: false, usage }
  let changed = false
  const billing = config.planBilling
  if (billing !== null && typeof billing === 'object' && !Array.isArray(billing)) {
    const current = billing.providers
    const providers = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : (billing.providers = {})
    if (providers.codex !== 'plan') { providers.codex = 'plan'; changed = true }
  }
  if (splitLedgerApiCost(ledger) > 0) changed = true
  if (positiveOr0(config.codexCompatHistoryAppliedAt) === 0) {
    config.codexCompatHistoryAppliedAt = Date.now()
    changed = true
  }
  if (!Array.isArray(ledger.migrations)) ledger.migrations = []
  if (!ledger.migrations.includes(CODEX_COMPAT_MIGRATION_ID)) {
    ledger.migrations.push(CODEX_COMPAT_MIGRATION_ID)
    changed = true
  }
  if (changed) ledger.scheduleWrite?.()
  return { changed, usage }
}

/**
 * 永久关闭一次性提示(×/保持现状/ESC 同语义)。
 *
 * @returns 是否发生变更(重复调用返回 false)。
 */
export function dismissCodexCompatPrompt(ledger) {
  const config = ledger?.config
  if (config === null || typeof config !== 'object') return false
  if (config.codexCompatPromptDismissed === true) return false
  config.codexCompatPromptDismissed = true
  ledger.scheduleWrite?.()
  return true
}
