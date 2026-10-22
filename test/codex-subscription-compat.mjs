/**
 * dsh-codex-subscription 兼容(契约 A/C/D/F)测试。
 *
 * 全部纯本地:检测只读临时目录构造的 package.json,不发起任何网络请求,
 * 也不依赖本机真实 profile;账本用 plain object 直接构造,避免真实定时器。
 * 宿主 RPC 集成用 fake ctx + 临时 DSH_HOME(参照 plan-provider-matching.mjs)。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Ledger, applyConfigPatch, sanitizeConfig, splitLedgerApiCost } from '../lib/store.js'
import { planProviderIdOf } from '../lib/plan-billing.js'
import {
  CODEX_SUBSCRIPTION_PACKAGE,
  applyCodexCompatHistory,
  codexCompatStatus,
  codexRuntimeEnabled,
  codexUsageOf,
  detectCodexSubscription,
  dismissCodexCompatPrompt,
  ensureCodexCompatPlan,
} from '../lib/codex-subscription-compat.js'
import { apply } from '../lib/index.js'

const root = mkdtempSync(join(tmpdir(), 'cm-codex-compat-'))
const NOT_INSTALLED = { installed: false, version: '', detection: 'none', packagePath: '' }
const MIGRATION_ID = 'codex-subscription-plan-v1'

/** 在 <nodeModulesDir>/<pkg>/package.json 写一份订阅插件清单,返回清单绝对路径。 */
function writeSubscriptionPackage(nodeModulesDir, version) {
  const dir = join(nodeModulesDir, CODEX_SUBSCRIPTION_PACKAGE)
  mkdirSync(dir, { recursive: true })
  const manifest = join(dir, 'package.json')
  writeFileSync(manifest, JSON.stringify({ name: CODEX_SUBSCRIPTION_PACKAGE, version }))
  return manifest
}

/** 注入用的「已安装」检测结果。 */
function installedDetection(version = '1.2.3') {
  return {
    installed: true,
    version,
    detection: 'package',
    packagePath: join(root, 'injected', 'node_modules', CODEX_SUBSCRIPTION_PACKAGE, 'package.json'),
  }
}

/** 纯函数直接操作的假账本:只含兼容模块会改动的字段 + 落盘计数。 */
function fakeLedger(configPatch = {}, days = {}) {
  return {
    config: sanitizeConfig(configPatch),
    days,
    migrations: [],
    writes: 0,
    scheduleWrite() { this.writes += 1 },
  }
}

try {
  // ---------- 0. 导出契约 ----------
  assert.equal(CODEX_SUBSCRIPTION_PACKAGE, 'dsh-codex-subscription', '包名常量')
  for (const name of ['detectCodexSubscription', 'codexUsageOf', 'codexCompatStatus', 'ensureCodexCompatPlan',
    'applyCodexCompatHistory', 'dismissCodexCompatPrompt']) {
    assert.equal(typeof { detectCodexSubscription, codexUsageOf, codexCompatStatus, ensureCodexCompatPlan, applyCodexCompatHistory, dismissCodexCompatPrompt }[name], 'function', name + ' 导出')
  }

  // ---------- 1. detection:三条路径 + 异常降级(全部临时目录/注入) ----------
  const emptyHome = join(root, 'empty-home')
  mkdirSync(emptyHome, { recursive: true })

  // 1a. 与本包同级的 node_modules(<root>/node_modules/dsh-cost-meter/lib/...) → package
  const siblingModule = join(root, 'node_modules', 'dsh-cost-meter', 'lib', 'codex-subscription-compat.js')
  const siblingManifest = writeSubscriptionPackage(join(root, 'node_modules'), '1.2.3')
  const packageDetection = { installed: true, version: '1.2.3', detection: 'package', packagePath: siblingManifest }
  assert.deepEqual(
    detectCodexSubscription({ moduleUrl: pathToFileURL(siblingModule).href, env: {}, homeDir: emptyHome }),
    packageDetection,
    '同级 node_modules 检测为 package',
  )

  // 1b. 同级 node_modules 优先于 profile 目录
  const priorityProfile = join(root, 'profile-priority')
  writeSubscriptionPackage(join(priorityProfile, 'node_modules'), '9.9.9')
  assert.deepEqual(
    detectCodexSubscription({ moduleUrl: pathToFileURL(siblingModule).href, env: { DSH_PROFILE_DIR: priorityProfile }, homeDir: emptyHome }),
    packageDetection,
    '同级 node_modules 优先于 profile',
  )

  // 1c. DSH_PROFILE_DIR / options.profileDir → profile
  const repoLikeModule = join(root, 'plain-app', 'dsh-cost-meter', 'lib', 'codex-subscription-compat.js')
  const repoLikeUrl = pathToFileURL(repoLikeModule).href
  const profileDir = join(root, 'profile-scope')
  const profileManifest = writeSubscriptionPackage(join(profileDir, 'node_modules'), '2.0.0')
  const profileDetection = { installed: true, version: '2.0.0', detection: 'profile', packagePath: profileManifest }
  assert.deepEqual(
    detectCodexSubscription({ moduleUrl: repoLikeUrl, env: { DSH_PROFILE_DIR: profileDir }, homeDir: emptyHome }),
    profileDetection,
    'DSH_PROFILE_DIR 检测为 profile',
  )
  assert.deepEqual(
    detectCodexSubscription({ moduleUrl: repoLikeUrl, env: {}, profileDir, homeDir: emptyHome }),
    profileDetection,
    'options.profileDir 注入可替代环境变量',
  )

  // 1d. $DSH_HOME/profiles/* 扫描(排序取首个命中) → profile
  const profilesHome = join(root, 'home-profiles')
  const alphaManifest = writeSubscriptionPackage(join(profilesHome, 'profiles', 'alpha', 'node_modules'), '3.0.0')
  writeSubscriptionPackage(join(profilesHome, 'profiles', 'beta', 'node_modules'), '4.0.0')
  const alphaDetection = { installed: true, version: '3.0.0', detection: 'profile', packagePath: alphaManifest }
  assert.deepEqual(
    detectCodexSubscription({ moduleUrl: repoLikeUrl, env: {}, homeDir: profilesHome }),
    alphaDetection,
    'homeDir/profiles/* 按排序取首个命中',
  )
  assert.deepEqual(
    detectCodexSubscription({ moduleUrl: repoLikeUrl, env: { DSH_HOME: profilesHome } }),
    alphaDetection,
    '未显式注入 homeDir 时回落到 env.DSH_HOME',
  )

  // 1e. 都没有 → none(默认 moduleUrl 即本仓库,父目录不是 node_modules)
  assert.deepEqual(
    detectCodexSubscription({ moduleUrl: repoLikeUrl, env: {}, homeDir: emptyHome }),
    NOT_INSTALLED,
    '无安装时为 none',
  )
  assert.deepEqual(
    detectCodexSubscription({ env: {}, homeDir: emptyHome }),
    NOT_INSTALLED,
    '真实 moduleUrl(本仓库)同为未安装',
  )

  // 1f. 只在 profile package.json 里声明依赖,不算安装
  const declaringHome = join(root, 'home-declaring')
  mkdirSync(join(declaringHome, 'profiles', 'p'), { recursive: true })
  writeFileSync(join(declaringHome, 'profiles', 'p', 'package.json'),
    JSON.stringify({ name: 'profile', dependencies: { [CODEX_SUBSCRIPTION_PACKAGE]: '*' } }))
  assert.deepEqual(
    detectCodexSubscription({ moduleUrl: repoLikeUrl, env: {}, homeDir: declaringHome }),
    NOT_INSTALLED,
    '仅 dependencies 声明不视为安装',
  )

  // 1g. 清单损坏 / fs 抛异常:静默降级为未安装,不抛错
  const corruptProfile = join(root, 'profile-corrupt')
  mkdirSync(join(corruptProfile, 'node_modules', CODEX_SUBSCRIPTION_PACKAGE), { recursive: true })
  writeFileSync(join(corruptProfile, 'node_modules', CODEX_SUBSCRIPTION_PACKAGE, 'package.json'), '{ not valid json')
  assert.deepEqual(
    detectCodexSubscription({ moduleUrl: repoLikeUrl, env: {}, profileDir: corruptProfile, homeDir: emptyHome }),
    NOT_INSTALLED,
    '损坏清单按未安装处理',
  )
  const throwingFs = { existsSync: () => { throw new Error('denied') }, readFileSync: () => { throw new Error('denied') }, readdirSync: () => { throw new Error('denied') } }
  assert.deepEqual(
    detectCodexSubscription({ moduleUrl: pathToFileURL(siblingModule).href, env: {}, homeDir: emptyHome, fs: throwingFs }),
    NOT_INSTALLED,
    'fs 异常不得抛出',
  )

  // ---------- 2. codexUsageOf:只统计 byProviderModel、按 provider 归属判定 ----------
  const baseConfig = sanitizeConfig({})
  assert.equal(baseConfig.planBilling.providers.codex, 'auto', '默认 codex 分类为 auto')
  assert.equal(planProviderIdOf('openai-codex', baseConfig.planBilling, 'gpt-6.1-sol'), 'codex', 'openai-codex 别名归属 codex')
  assert.equal(planProviderIdOf('go', baseConfig.planBilling, 'gpt-5.6-luna'), 'go')
  assert.equal(planProviderIdOf('anthropic', baseConfig.planBilling, 'claude'), 'anthropic')

  const usageLedger = {
    config: { planBilling: baseConfig.planBilling },
    days: {
      '2026-10-01': {
        date: '2026-10-01',
        byProviderModel: {
          'openai-codex:gpt-6.1-sol': { calls: 3, cost: 0.75, input: 1000, output: 200, cacheRead: 50, cacheWrite: 10, reasoning: 30 },
          'go:gpt-5.6-luna': { calls: 2, cost: 5, input: 9999 },
          'anthropic:claude': { calls: 1, cost: 1, input: 500 },
        },
        // 会话明细是同日同调用,再遍历会重复计数。
        sessions: [{ byProviderModel: { 'openai-codex:gpt-6.1-sol': { calls: 99, cost: 99, input: 999999 } } }],
      },
      '2026-10-02': {
        date: '2026-10-02',
        byProviderModel: { 'codex:gpt-6.1-sol': { calls: 1, cost: 0.25, input: 100 } },
      },
      '2026-10-03': {
        date: '2026-10-03',
        byProviderModel: { 'anthropic:claude': { calls: 5, cost: 5, input: 5 } },
      },
    },
  }
  const expectedUsage = { calls: 4, cost: 1, tokens: 1390, days: 2, providers: ['codex', 'openai-codex'] }
  assert.deepEqual(codexUsageOf(usageLedger), expectedUsage, '只统计 codex 桶,不重复计会话明细')

  const apiClassConfig = sanitizeConfig({ planBilling: { providers: { codex: 'api' } } })
  assert.deepEqual(
    codexUsageOf({ ...usageLedger, config: { planBilling: apiClassConfig.planBilling } }),
    expectedUsage,
    '统计按 provider 归属(codex 订阅渠道),不受 providers.codex=api 分类开关影响',
  )

  const emptyUsage = { calls: 0, cost: 0, tokens: 0, days: 0, providers: [] }
  assert.deepEqual(codexUsageOf({ days: {}, config: { planBilling: baseConfig.planBilling } }), emptyUsage, '空账本全零')
  assert.deepEqual(codexUsageOf({ config: { planBilling: baseConfig.planBilling } }), emptyUsage, '无 days 全零')
  assert.deepEqual(codexUsageOf({
    config: { planBilling: baseConfig.planBilling },
    days: { '2026-10-04': { date: '2026-10-04', byProviderModel: { 'anthropic:claude': { calls: 1, cost: 1 } }, sessions: [] } },
  }), emptyUsage, '非 codex 桶不计入')

  // ---------- 3. ensureCodexCompatPlan:auto→plan、不重算历史、尊重显式分类 ----------
  const splitSensitiveDay = () => ({
    date: '2026-10-01', cost: 2, apiCost: 2,
    byProviderModel: { 'go:gpt-5.6-luna': { calls: 1, cost: 2, apiCost: 2 } },
    sessions: [],
  })
  // goQuota 启用 → go 归属 plan;若误调 splitLedgerApiCost,go 桶 apiCost 会被归零。
  const ensureAuto = fakeLedger({ goQuota: { enabled: true } }, { '2026-10-01': splitSensitiveDay() })
  assert.equal(ensureAuto.config.planBilling.providers.codex, 'auto')
  assert.equal(ensureCodexCompatPlan(ensureAuto, installedDetection()), true, 'auto → plan 返回 changed')
  assert.equal(ensureAuto.config.planBilling.providers.codex, 'plan')
  assert.equal(ensureAuto.writes, 1, '写入后触发 scheduleWrite')
  assert.equal(ensureAuto.days['2026-10-01'].byProviderModel['go:gpt-5.6-luna'].apiCost, 2, '不得调用 splitLedgerApiCost 重算历史 apiCost')
  assert.equal(ensureAuto.days['2026-10-01'].apiCost, 2)

  const ensureExplicitPlan = fakeLedger({ planBilling: { providers: { codex: 'plan' } } })
  assert.equal(ensureCodexCompatPlan(ensureExplicitPlan, installedDetection()), false, '已是 plan 不重复写')
  assert.equal(ensureExplicitPlan.writes, 0)

  const ensureExplicitApi = fakeLedger({ planBilling: { providers: { codex: 'api' } } })
  assert.equal(ensureCodexCompatPlan(ensureExplicitApi, installedDetection()), false, '显式 api 不覆盖')
  assert.equal(ensureExplicitApi.config.planBilling.providers.codex, 'api')
  assert.equal(ensureExplicitApi.writes, 0)

  const ensureNotInstalled = fakeLedger({}, {})
  const ensureNotInstalledBefore = structuredClone(ensureNotInstalled.config)
  assert.equal(ensureCodexCompatPlan(ensureNotInstalled, NOT_INSTALLED), false, '未安装不动 config')
  assert.deepEqual(ensureNotInstalled.config, ensureNotInstalledBefore)
  assert.equal(ensureNotInstalled.writes, 0)
  assert.equal(ensureCodexCompatPlan(ensureNotInstalled, null), false, 'detection 为 null 同样不改动')

  // ---------- 4. applyCodexCompatHistory:apiCost 归零、容器一致、幂等 ----------
  const codexBucket = () => ({ calls: 2, cost: 1, input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, apiCost: 1, costCny: 7.2, apiCostCny: 7.2 })
  const deepseekBucket = () => ({ calls: 1, cost: 2, input: 500, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, apiCost: 2, costCny: 14.4, apiCostCny: 14.4 })
  const makeApplyLedger = () => ({
    config: sanitizeConfig({}),
    days: {
      '2026-10-10': {
        date: '2026-10-10', input: 1500, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        calls: 3, cost: 3, apiCost: 0, costCny: 21.6, apiCostCny: 21.6,
        byProviderModel: { 'openai-codex:gpt-6.1-sol': codexBucket(), 'deepseek:deepseek-chat': deepseekBucket() },
        sessions: [{
          sessionId: 's1', calls: 3, input: 1500, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0,
          cost: 3, apiCost: 0, costCny: 21.6, apiCostCny: 21.6,
          byProviderModel: { 'openai-codex:gpt-6.1-sol': codexBucket(), 'deepseek:deepseek-chat': deepseekBucket() },
        }],
      },
      '2026-10-11': {
        date: '2026-10-11', input: 100, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        calls: 1, cost: 1, apiCost: 1,
        byProviderModel: { 'codex:gpt-6.1-sol': { calls: 1, cost: 1, input: 100, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, apiCost: 1 } },
        sessions: [],
      },
    },
    migrations: [],
    writes: 0,
    scheduleWrite() { this.writes += 1 },
  })
  const applied = makeApplyLedger()
  const usageBeforeApply = codexUsageOf(applied)
  assert.deepEqual(usageBeforeApply, { calls: 3, cost: 2, tokens: 1200, days: 2, providers: ['codex', 'openai-codex'] }, '应用前用量快照')
  const result = applyCodexCompatHistory(applied, installedDetection())
  const dayOne = applied.days['2026-10-10']
  const dayTwo = applied.days['2026-10-11']
  const session = dayOne.sessions[0]
  assert.equal(result.changed, true)
  assert.deepEqual(result.usage, usageBeforeApply, '返回应用前统计快照')
  assert.equal(applied.config.planBilling.providers.codex, 'plan', '历史归类把 codex 写为 plan')
  assert.equal(dayOne.byProviderModel['openai-codex:gpt-6.1-sol'].apiCost, 0, 'codex 桶 apiCost 归零')
  assert.equal(dayOne.byProviderModel['openai-codex:gpt-6.1-sol'].apiCostCny, 0, 'codex 桶 CNY apiCost 归零')
  assert.equal(dayTwo.byProviderModel['codex:gpt-6.1-sol'].apiCost, 0, 'codex: 桶名同样归零')
  assert.equal(dayOne.byProviderModel['deepseek:deepseek-chat'].apiCost, 2, '非 codex 桶 apiCost 不变')
  assert.equal(dayOne.byProviderModel['deepseek:deepseek-chat'].apiCostCny, 14.4, '非 codex 桶 CNY apiCost 不变')
  assert.equal(dayOne.apiCost, 2, 'day 容器 API 金额与 split 口径一致')
  assert.equal(session.apiCost, 2, 'session 容器 API 金额与 split 口径一致')
  assert.equal(session.byProviderModel['openai-codex:gpt-6.1-sol'].apiCost, 0, 'session codex 桶归零')
  assert.equal(dayOne.apiCostCny, 14.4, 'day 容器 CNY API 金额')
  assert.equal(session.apiCostCny, 14.4, 'session 容器 CNY API 金额')
  assert.equal(dayTwo.apiCost, 0, '全 codex 的 day apiCost 归零')
  assert.ok(applied.config.codexCompatHistoryAppliedAt > 0, 'historyAppliedAt > 0')
  assert.ok(applied.migrations.includes(MIGRATION_ID), '补历史归类迁移标记')
  assert.equal(applied.writes, 1, '应用后落盘一次')

  const appliedAt = applied.config.codexCompatHistoryAppliedAt
  const second = applyCodexCompatHistory(applied, installedDetection())
  assert.equal(second.changed, false, '重复应用幂等')
  assert.deepEqual(second.usage, usageBeforeApply, '重复应用返回同一用量快照')
  assert.equal(applied.config.codexCompatHistoryAppliedAt, appliedAt, '幂等不重写时间戳')
  assert.equal(applied.migrations.filter(id => id === MIGRATION_ID).length, 1, '迁移标记不重复')
  assert.equal(applied.writes, 1, '幂等不重复落盘')
  assert.equal(splitLedgerApiCost(applied), 0, '应用后 split 已无改动')

  const neverInstalled = makeApplyLedger()
  const notInstalledResult = applyCodexCompatHistory(neverInstalled, NOT_INSTALLED)
  assert.equal(notInstalledResult.changed, false, '未安装不应用历史归类')
  assert.deepEqual(notInstalledResult.usage, usageBeforeApply, '未安装仍返回用量快照')
  assert.equal(neverInstalled.config.planBilling.providers.codex, 'auto')
  assert.equal(neverInstalled.config.codexCompatHistoryAppliedAt, 0, '未安装 historyAppliedAt 保持默认 0')
  assert.equal(neverInstalled.migrations.length, 0)
  assert.equal(neverInstalled.writes, 0)
  assert.equal(neverInstalled.days['2026-10-10'].apiCost, 0, '未安装不重算容器 apiCost')

  // ---------- 5. codexCompatStatus:promptDue 状态机 ----------
  const installed = installedDetection()
  const statusDefault = codexCompatStatus(fakeLedger(), installed)
  assert.deepEqual(statusDefault, {
    installed: true,
    enabled: true,
    version: '1.2.3',
    detection: 'package',
    planClass: 'auto',
    usage: { calls: 0, cost: 0, tokens: 0, days: 0, providers: [] },
    historyAppliedAt: 0,
    promptDismissed: false,
    promptDue: true,
  }, '已安装 + 未关闭 + 未应用 → 提示待确认')
  assert.equal(codexCompatStatus(fakeLedger({ codexCompatPromptDismissed: true }), installed).promptDue, false, '已关闭不再提示')
  assert.equal(codexCompatStatus(fakeLedger({ codexCompatHistoryAppliedAt: 1700000000000 }), installed).promptDue, false, '已应用不再提示')
  const dismissedAndApplied = codexCompatStatus(fakeLedger({ codexCompatPromptDismissed: true, codexCompatHistoryAppliedAt: 1700000000000 }), installed)
  assert.equal(dismissedAndApplied.promptDue, false)
  assert.equal(dismissedAndApplied.promptDismissed, true)
  assert.equal(dismissedAndApplied.historyAppliedAt, 1700000000000)
  const statusNotInstalled = codexCompatStatus(fakeLedger(), NOT_INSTALLED)
  assert.equal(statusNotInstalled.installed, false)
  assert.equal(statusNotInstalled.version, '')
  assert.equal(statusNotInstalled.detection, 'none')
  assert.equal(statusNotInstalled.promptDue, false, '未安装不提示')
  const statusNullDetection = codexCompatStatus(fakeLedger(), null)
  assert.equal(statusNullDetection.installed, false)
  assert.equal(statusNullDetection.promptDue, false)
  const planClassOf = providers => codexCompatStatus({ config: { planBilling: { providers } }, days: {} }, installed).planClass
  assert.equal(planClassOf({ codex: 'plan' }), 'plan')
  assert.equal(planClassOf({ codex: 'api' }), 'api')
  assert.equal(planClassOf({}), 'auto')
  assert.equal(planClassOf({ codex: 'weird' }), 'auto', '非法分类归一化为 auto')
  assert.deepEqual(codexCompatStatus({ config: { planBilling: baseConfig.planBilling }, days: usageLedger.days }, installed).usage, expectedUsage, 'status.usage 与 codexUsageOf 同源')

  // ---------- 6. 持久化新键:sanitizeConfig 收敛 + applyConfigPatch 校验 ----------
  const configDefaults = sanitizeConfig({})
  assert.equal(configDefaults.codexCompatPromptDismissed, false, 'codexCompatPromptDismissed 缺省 false')
  assert.equal(configDefaults.codexCompatHistoryAppliedAt, 0, 'codexCompatHistoryAppliedAt 缺省 0')
  assert.equal(sanitizeConfig({ codexCompatPromptDismissed: 'yes' }).codexCompatPromptDismissed, false, '非 true 一律 false')
  assert.equal(sanitizeConfig({ codexCompatPromptDismissed: 1 }).codexCompatPromptDismissed, false, '非布尔 true 一律 false')
  assert.equal(sanitizeConfig({ codexCompatPromptDismissed: true }).codexCompatPromptDismissed, true)
  assert.equal(sanitizeConfig({ codexCompatHistoryAppliedAt: -5 }).codexCompatHistoryAppliedAt, 0, '负数归零')
  assert.equal(sanitizeConfig({ codexCompatHistoryAppliedAt: '42' }).codexCompatHistoryAppliedAt, 0, '字符串归零')
  assert.equal(sanitizeConfig({ codexCompatHistoryAppliedAt: Number.NaN }).codexCompatHistoryAppliedAt, 0, 'NaN 归零')
  assert.equal(sanitizeConfig({ codexCompatHistoryAppliedAt: 1700000000000 }).codexCompatHistoryAppliedAt, 1700000000000, '正数保留')

  const configCurrent = sanitizeConfig({})
  const invalidBoolean = applyConfigPatch(configCurrent, { codexCompatPromptDismissed: 'true' })
  assert.ok(invalidBoolean.errors.length > 0, 'codexCompatPromptDismissed 非布尔报错')
  assert.ok(invalidBoolean.errors.some(message => String(message).includes('codexCompatPromptDismissed')))
  assert.equal(invalidBoolean.config.codexCompatPromptDismissed, false, '校验失败不改配置')
  const invalidNegative = applyConfigPatch(configCurrent, { codexCompatHistoryAppliedAt: -1 })
  assert.ok(invalidNegative.errors.length > 0, '负数 historyAppliedAt 报错')
  const invalidString = applyConfigPatch(configCurrent, { codexCompatHistoryAppliedAt: '1700000000000' })
  assert.ok(invalidString.errors.length > 0, '字符串 historyAppliedAt 报错')
  const validPatch = applyConfigPatch(configCurrent, { codexCompatPromptDismissed: true, codexCompatHistoryAppliedAt: 1700000000000 })
  assert.deepEqual(validPatch.errors, [], '合法值通过校验')
  assert.equal(validPatch.config.codexCompatPromptDismissed, true)
  assert.equal(validPatch.config.codexCompatHistoryAppliedAt, 1700000000000)

  // ---------- 6b. 订阅插件 provider 映射(W1 冻结契约;task-6 已实现,默认硬断言) ----------
  // @eddyskywalker/dsh-chatgpt-subscription 会注册 9 个 provider id,后续任务要做费用归属。
  // 已确认映射:codex-chatgpt/kimi-code/command-code/claude-subscription/minimax-code/glm-coding-plan
  // 归入既有家族;workbuddy-subscription→新家族 'workbuddy'、antigravity→新家族 'antigravity'、
  // step-code→新家族 'stepfun'(对齐 pricing 的 stepfun 命名,不用 'step')。
  // 默认按硬断言执行;排查时设 DSH_W1_STRICT=0 可降级为仅打印差异。
  const w1Expected = {
    'codex-chatgpt': 'codex',
    'kimi-code': 'kimi',
    'command-code': 'commandcode',
    'workbuddy-subscription': 'workbuddy',
    'claude-subscription': 'anthropic',
    'minimax-code': 'minimax',
    'antigravity': 'antigravity',
    'glm-coding-plan': 'zai',
    'step-code': 'stepfun',
  }
  const w1Models = {
    'codex-chatgpt': 'gpt-6.1-sol',
    'kimi-code': 'kimi-k2',
    'command-code': 'command-code',
    'workbuddy-subscription': 'workbuddy',
    'claude-subscription': 'claude-sonnet-4-5',
    'minimax-code': 'minimax-m2',
    'antigravity': 'gemini-3-pro',
    'glm-coding-plan': 'glm-4.6',
    'step-code': 'step-3',
  }
  const w1Actual = Object.entries(w1Expected).map(([providerId, expected]) => ({
    providerId,
    model: w1Models[providerId],
    expected,
    actual: planProviderIdOf(providerId, baseConfig.planBilling, w1Models[providerId]),
  }))
  if (process.env.DSH_W1_STRICT === '0') {
    const pending = w1Actual.filter(item => item.actual !== item.expected)
    if (pending.length > 0) {
      console.log('[w1] 订阅插件 provider 映射差异: ' + pending
        .map(item => `${item.providerId}: ${item.actual} -> ${item.expected}`).join('; '))
    }
  } else {
    for (const item of w1Actual) assert.equal(item.actual, item.expected, 'W1 ' + item.providerId + ' 映射')
  }

  // ---------- 7. 宿主 RPC 集成:fake ctx + 临时 DSH_HOME ----------
  const previousHome = process.env.DSH_HOME
  const previousProfileDir = process.env.DSH_PROFILE_DIR
  const bootService = (home, disposers) => {
    process.env.DSH_HOME = home
    let service
    apply({
      on: () => () => {},
      inject() {},
      get: name => name === 'settings' ? { get: () => ({}) } : name === 'loader' ? { entries: () => [{ options: { name: CODEX_SUBSCRIPTION_PACKAGE }, disabled: false, fiber: { state: 2 } }] } : undefined,
      effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
      provide: (name, value) => { if (name === 'costMeter') service = value },
      logger: console,
    })
    assert.ok(service, 'fake ctx 应注册 costMeter service')
    return service
  }
  const disposeAll = async disposers => { for (const dispose of disposers.reverse()) await dispose() }
  try {
    delete process.env.DSH_PROFILE_DIR

    // 7a. 已安装(通过 $DSH_HOME/profiles/* 检测):state 下发 codexCompat,应用历史后不再提示。
    const installedHome = join(root, 'service-installed')
    writeSubscriptionPackage(join(installedHome, 'profiles', 'default', 'node_modules'), '0.9.9')
    const storage = join(installedHome, 'storages', 'cost-meter')
    mkdirSync(storage, { recursive: true })
    const seed = new Ledger(sanitizeConfig({}), {
      '2026-10-01': {
        date: '2026-10-01', input: 100, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        calls: 1, cost: 1, apiCost: 1,
        byProviderModel: { 'openai-codex:gpt-6.1-sol': { calls: 1, cost: 1, input: 100, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, apiCost: 1 } },
        sessions: [],
      },
    }, join(storage, 'ledger.json'))
    seed.scheduleWrite()
    seed.close()
    const installedDisposers = []
    const service = bootService(installedHome, installedDisposers)
    try {
      const state = await service.getState()
      assert.ok(state.codexCompat, '已安装时 state.codexCompat 存在')
      assert.equal(state.codexCompat.installed, true)
      assert.equal(state.codexCompat.version, '0.9.9')
      assert.equal(state.codexCompat.detection, 'profile')
      assert.equal(state.codexCompat.planClass, 'plan', '启动时把 codex 新用量归 Plan')
      assert.equal(state.codexCompat.promptDue, true, '首次提示待确认')
      assert.equal(state.codexCompat.historyAppliedAt, 0)
      assert.equal(state.codexCompat.usage.calls, 1)
      assert.equal(state.codexCompat.usage.cost, 1)
      assert.equal(state.config.planBilling.providers.codex, 'plan')
      const appliedState = await service.applyCodexCompatHistory()
      assert.equal(appliedState.codexCompat.promptDue, false, '应用后 promptDue=false')
      assert.ok(appliedState.codexCompat.historyAppliedAt > 0, '应用后 historyAppliedAt>0')
      assert.equal(appliedState.codexCompat.planClass, 'plan')
      assert.ok(appliedState.config.codexCompatHistoryAppliedAt > 0)
      const dismissedState = await service.dismissCodexCompat()
      assert.equal(dismissedState.config.codexCompatPromptDismissed, true)
      assert.equal(dismissedState.codexCompat.promptDismissed, true)
      assert.equal(dismissedState.codexCompat.promptDue, false)
    } finally {
      await disposeAll(installedDisposers)
    }
    const stored = JSON.parse(readFileSync(join(storage, 'ledger.json'), 'utf8'))
    assert.ok(stored.config.codexCompatHistoryAppliedAt > 0, '历史归类时刻已落盘')
    assert.equal(stored.config.codexCompatPromptDismissed, true, '关闭提示已落盘')
    assert.equal(stored.days['2026-10-01'].byProviderModel['openai-codex:gpt-6.1-sol'].apiCost, 0, '持久化后 codex 桶 apiCost 归零')
    assert.equal(stored.days['2026-10-01'].apiCost, 0)
    assert.ok(Array.isArray(stored.migrations) && stored.migrations.includes(MIGRATION_ID), '迁移标记随账本落盘')

    // 7b. 未安装:检测结果对象仍非 null,state.codexCompat 存在但 installed=false / promptDue=false。
    const bareHome = join(root, 'service-bare')
    mkdirSync(join(bareHome, 'storages', 'cost-meter'), { recursive: true })
    const bareDisposers = []
    const bareService = bootService(bareHome, bareDisposers)
    try {
      const state = await bareService.getState()
      assert.ok(state.codexCompat, '未安装时仍下发 codexCompat(检测对象非 null)')
      assert.equal(state.codexCompat.installed, false)
      assert.equal(state.codexCompat.detection, 'none')
      assert.equal(state.codexCompat.promptDue, false, '未安装不提示')
      assert.equal(state.codexCompat.planClass, 'auto', '未安装不改写 codex 分类')
      assert.equal(state.config.planBilling.providers.codex, 'auto')
    } finally {
      await disposeAll(bareDisposers)
    }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousProfileDir === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previousProfileDir
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] dsh-codex-subscription 兼容:检测三态、历史用量统计、启动归类、历史 apiCost 重算与幂等、提示状态机、配置收敛、宿主 RPC 集成')
