/**
 * @eddyskywalker/dsh-chatgpt-subscription 兼容(9 条订阅线路归 Plan)。
 *
 * 该插件注册 9 条走「订阅额度」的 LLM provider(codex-chatgpt / claude-subscription /
 * antigravity / kimi-code / minimax-code / command-code / workbuddy-subscription /
 * glm-coding-plan / step-code),用量消耗的是各订阅账户的额度,不应计入 API 真金白银。
 *
 * 本模块负责(均为纯本地逻辑,**绝不发起网络请求**):
 *  1. 泛化检测该插件是否安装(复用 codex-subscription-compat.js 的
 *     detectSubscriptionPackage,支持 scoped 包名的三条路径);
 *  2. 启动时把这些线路 provider 对应的 Plan 提供商 id 归类写为 'plan'
 *     (只影响新用量;历史 apiCost 不在此重算),用户显式选择的 plan/api 不覆盖。
 */

import { detectSubscriptionPackage } from './codex-subscription-compat.js'

/** @eddyskywalker/dsh-chatgpt-subscription 的 npm 包名(检测与前端展示共用)。 */
export const CHATGPT_SUBSCRIPTION_PACKAGE = '@eddyskywalker/dsh-chatgpt-subscription'

/**
 * 9 条订阅线路 provider → dsh-cost-meter 的 Plan 提供商 id。
 *
 * provider 名来自该插件注册的 LLM provider;planId 必须存在于
 * lib/plan-billing.js 的 PLAN_PROVIDER_IDS(否则 store.js 清洗/校验会丢弃配置)。
 */
export const CHATGPT_SUBSCRIPTION_PROVIDER_PLANS = Object.freeze({
  'codex-chatgpt': 'codex',
  'claude-subscription': 'anthropic',
  antigravity: 'antigravity',
  'kimi-code': 'kimi',
  'minimax-code': 'minimax',
  'command-code': 'commandcode',
  'workbuddy-subscription': 'workbuddy',
  'glm-coding-plan': 'zai',
  'step-code': 'stepfun',
})

/**
 * 检测 @eddyskywalker/dsh-chatgpt-subscription 是否安装(纯本地)。
 *
 * detectSubscriptionPackage 的薄包装;options 与 detectCodexSubscription 相同
 * ({ moduleUrl, env, homeDir, profileDir, fs }),便于测试注入假 fs/env。
 *
 * @returns {{ installed: boolean, version: string, detection: 'package'|'profile'|'none', packagePath: string }}
 */
export function detectChatgptSubscription(options = {}) {
  return detectSubscriptionPackage(CHATGPT_SUBSCRIPTION_PACKAGE, options)
}

/**
 * 启动时调用:检测到该插件后,把尚未显式配置的线路 provider 归类写为 'plan'。
 *
 * - 只覆盖 undefined / 'auto'(以及任何非法值);用户显式选择的 'plan'/'api' 不覆盖;
 * - 不调用 splitLedgerApiCost:历史 apiCost 保持原样(仅影响新用量);
 * - 全部写完后只调用一次 ledger.scheduleWrite()。
 *
 * @param ledger - 账本(至少需要 config.planBilling.providers 与 scheduleWrite)。
 * @param detection - detectChatgptSubscription() 结果。
 * @returns {{ changed: boolean, planIds: string[] }} planIds 为本次实际写成 'plan' 的提供商 id。
 */
export function ensureChatgptSubscriptionPlan(ledger, detection) {
  if (detection?.installed !== true) return { changed: false, planIds: [] }
  const config = ledger?.config
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return { changed: false, planIds: [] }
  const billing = config.planBilling
  if (billing === null || typeof billing !== 'object' || Array.isArray(billing)) return { changed: false, planIds: [] }
  const current = billing.providers
  const providers = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : (billing.providers = {})
  const planIds = []
  for (const planId of Object.values(CHATGPT_SUBSCRIPTION_PROVIDER_PLANS)) {
    const value = providers[planId]
    if (value === 'plan' || value === 'api') continue
    providers[planId] = 'plan'
    planIds.push(planId)
  }
  if (planIds.length === 0) return { changed: false, planIds }
  ledger.scheduleWrite?.()
  return { changed: true, planIds }
}
