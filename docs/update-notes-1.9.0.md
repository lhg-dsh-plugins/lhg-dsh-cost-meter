# v1.9.0

## 中文

本版新增三类外部插件/存储的兼容：Codex 订阅插件、ChatGPT 订阅插件与 better-session 的 SQLite 会话存储；为全部费用界面适配 dsh-pocket 手机端；并按 #274 的社区反馈为 OpenDesign 增加 Control Key 直连的 preflight 回退与窗口/钱包独立降级。账本格式不变；除用户主动确认的「历史 Codex 归类」外，不自动重算历史金额。

### Codex 订阅插件兼容（dsh-codex-subscription）

- 安装 dsh-codex-subscription 后，插件启动时从 Profile 的 `node_modules` 检测它，并自动把该插件产生的 Codex 订阅调用归类为 Plan 订阅额度，不再计入 API 按量花费；新产生的用量在记账时直接按 Plan 处理。
- 升级后首次检测到该插件时，弹出一次「兼容修复」提示：是否把升级前已记录的历史 Codex 类模型计费统一归类为 Plan。选择「统一归类为 Plan」后立即重算本地账本中的历史 Codex 用量（`apiCost` 归零、Plan 等值保留），可重复执行且幂等；选择「保持现状」或关闭提示不会改动历史金额，并永久记住该选择。
- 提示可随时从「设置 → 费用 → Codex」重新操作：设置页新增「Codex 订阅兼容」面板，展示检测到的版本、当前计费方式、历史 Codex 用量（调用数 / 金额 / 天数 / 来源 Provider）与归类状态，并提供「统一归类为 Plan」按钮；未安装该插件时不显示该区块。
- 判定沿用 Plan/API 双轨与 `provider:model` 覆盖机制；用户已显式选择 plan/api 的厂商不会被覆盖。

### ChatGPT 订阅插件兼容（@eddyskywalker/dsh-chatgpt-subscription）

- 检测该插件的 9 条订阅线路并映射到对应 Plan 家族：`codex-chatgpt` → Codex、`kimi-code` → Kimi、`command-code` → CommandCode、`claude-subscription` → Anthropic、`minimax-code` → MiniMax、`glm-coding-plan` → Z.AI、`workbuddy-subscription` → WorkBuddy（新增）、`antigravity` → Antigravity（新增）、`step-code` → StepFun（新增）。
- 启动时对计费分类仍为「自动」的上述厂商自动归为 Plan，不覆盖用户显式选择的 plan/API，使其订阅调用不再计入 API 花费。
- 该插件自身的登录、额度卡片与 Provider 功能不受影响；本插件只读取本地账本记账口径，不发起任何订阅插件的网络请求。

### better-session SQLite 会话存储兼容

- 新增会话存储适配层：自动探测宿主后端（`session-rdb` / `sessionPersistence` / `sessionQuery` 或 `@morlay/better-session`、`@morlay/session-rdb` 安装），当 better-session 接管会话存储、不再产生 JSONL 日志时，历史回填、旧账本导入、按模型历史重定价、小时桶修复、fork 种子清洗，以及逐会话费用、轨迹、调用详情、标题与统计缓存仍可正常工作。
- JSONL 存储路径逐字节保持原有行为；RDB 模式走宿主的会话持久化/查询接口，不直接读 SQLite 文件，也不自动合并旧 JSONL 与 RDB 历史（旧日志可用「导入旧版历史」补录，[说明](better-session.md)）。
- 修正 5 个一次性迁移标记在 RDB 空扫描时被误消费的问题，避免误以为旧会话已处理；首次全量回放增加单会话顺序与事件上限保护。
- 启动日志会打印当前会话存储后端（`session-rdb` / `jsonl` / `unknown`）；会话修复 CLI 检测到 RDB 时明确提示不支持并返回退出码 2，不假装修复成功。

### dsh-pocket 手机端适配

- 主设置面板、侧栏卡片、额度横条、预算框、统计页、显示设置、定价页、OpenRouter 与社区面板、Codex 兼容面板均适配窄屏（≤1023px）与 dsh-pocket 强制移动布局：卡片单列、标签横向滚动、按钮/标签 36px 触控高度、对话框不超过 90vh 并避开安全区、宽表横向滚动。
- 桌面布局不变；新增样式全部包在 `@media (max-width: 1023px)` 或 `body[data-dsh-pocket-layout="mobile"]` 下。

### OpenDesign 额度查询：Control Key preflight 回退与独立降级（#274）

- 按 [@yunjuanhuakai 的实测](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566)：同一把 Control Key 用 Bearer 调用 `/billing/coding-plan-usage` 会 401，但可正常读取 `/billing/preflight`（返回 `codingPlan.windows` 与 `balanceUsd`）。本版在主端点返回 401/403 时保守回退一次 preflight；主端点非 401/403 不触发回退，避免掩盖真实故障。
- 解析器支持解包 preflight 的 `codingPlan` 结构；preflight 的 `balanceUsd` 仅在钱包接口不可读时兜底显示，不覆盖可读钱包。
- 窗口与钱包读取完全独立并行：一方失败只降级该部分（窗口失败 → 仅显示钱包余额并标记 partial；钱包失败 → 保留窗口），只有两者都失败才报错；错误区分鉴权失败、无生效订阅、响应无效与网络失败，不再混同。
- 文档补充端点权限、Control Key 只能用于部分端点、`workspaceId` 必须取 `GET /api/v1/workspaces` 的 `items[].workspaceId`（误用用户 id 会 403 `workspace_billing_scope_forbidden`）以及 401 排查步骤，见 [OpenDesign 计费与排查](opendesign-billing.md)。
- 感谢 [@playgithub](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6215322540) 提出 OpenDesign 支持需求并复现入口问题、[@codeforker654](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870) 复现并提交 401 报告、[@yunjuanhuakai](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566) 发现 `/billing/preflight` 可接受 Control Key 并提供回执样例。

### 升级方式

重跑新版 `install.ps1` 或从插件市场更新（npm 用户执行 `dsh plugin --profile web add dsh-cost-meter@latest`），升级后完全退出并重新打开 DSH。账本格式不变；除主动确认的历史 Codex 归类外不自动重算历史金额。

## English

This release adds compatibility for three external integrations: the Codex subscription plugin, the ChatGPT subscription plugin, and better-session's SQLite session storage. Every cost UI now adapts to dsh-pocket mobile layouts. Following the #274 community feedback, OpenDesign gains a Control-Key-only `/billing/preflight` fallback plus independent window/wallet degradation. The ledger format is unchanged; historical amounts are never recalculated automatically except for the explicitly confirmed "historical Codex reclassification".

### Codex subscription plugin compatibility (dsh-codex-subscription)

- When dsh-codex-subscription is installed, the plugin is detected from the Profile's `node_modules` at startup. Codex subscription calls it makes are classified as Plan subscription quota instead of pay-as-you-go API spend, and new usage is recorded as Plan immediately.
- On the first detection after upgrading, a one-time "Compatibility fix" prompt asks whether to reclassify historical Codex models recorded before the upgrade as Plan. Choosing "Reclassify as Plan" recomputes the local ledger immediately (`apiCost` zeroed, Plan equivalents kept); it is idempotent. Choosing "Keep as is" or closing the prompt leaves historical amounts untouched and remembers the decision permanently.
- The action is always reachable in Settings → Cost → Codex: the new "Codex subscription compatibility" panel shows the detected version, current billing class, historical Codex usage (calls / cost / days / source providers) and the reclassification state, with a "Reclassify as Plan" button. The section is hidden when the plugin is not installed.
- Classification follows the existing Plan/API dual-track and `provider:model` overrides; vendors explicitly set to plan/api are never overwritten.

### ChatGPT subscription plugin compatibility (@eddyskywalker/dsh-chatgpt-subscription)

- Detects the plugin's nine subscription routes and maps them to Plan families: `codex-chatgpt` → Codex, `kimi-code` → Kimi, `command-code` → CommandCode, `claude-subscription` → Anthropic, `minimax-code` → MiniMax, `glm-coding-plan` → Z.AI, `workbuddy-subscription` → WorkBuddy (new), `antigravity` → Antigravity (new), `step-code` → StepFun (new).
- At startup, vendors still set to "auto" are classified as Plan without overriding explicit plan/API choices, so subscription calls no longer count as API spend.
- The plugin's own login, quota cards and providers are untouched; this plugin reads only the local ledger billing class and makes no network requests on behalf of subscription plugins.

### better-session SQLite session storage compatibility

- New session-storage adapter: the host backend is detected automatically (`session-rdb` / `sessionPersistence` / `sessionQuery`, or installed `@morlay/better-session` / `@morlay/session-rdb`). When better-session takes over storage and no JSONL logs are produced, historical backfill, legacy-ledger import, per-model history repricing, hour-bucket repair, fork-seed cleanup, per-session cost, trajectory, call inspection, titles and statistics caches keep working.
- The JSONL path remains byte-for-byte unchanged; RDB mode goes through the host's session persistence/query APIs instead of reading SQLite files directly, and does not merge old JSONL with RDB history automatically (use "Import legacy history" for old logs; see [guide](better-session.md)).
- Five one-time migration markers are no longer consumed by an empty RDB scan (previously they could mark old sessions as processed). The first full replay now runs one session at a time with an event cap.
- Startup logs the current session storage backend (`session-rdb` / `jsonl` / `unknown`); the session repair CLI detects RDB, explains that it is unsupported and exits with code 2 instead of pretending to repair.

### dsh-pocket mobile layout

- The main settings panel, sidebar cards, quota strip, budget box, statistics, display settings, pricing, OpenRouter and community panels, and the Codex compatibility panel now adapt to narrow screens (≤1023px) and dsh-pocket's forced mobile layout: single-column cards, horizontally scrolling tabs, 36px touch targets, dialogs capped at 90vh with safe-area padding, and horizontally scrolling wide tables.
- Desktop layout is unchanged; all new styles live under `@media (max-width: 1023px)` or `body[data-dsh-pocket-layout="mobile"]`.

### OpenDesign quota: Control-Key preflight fallback and independent degradation (#274)

- Based on [the measurements shared by @yunjuanhuakai](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566): the same Control Key returns 401 from `/billing/coding-plan-usage` as a Bearer token, but `/billing/preflight` works and returns `codingPlan.windows` plus `balanceUsd`. This release falls back once to preflight only when the primary endpoint returns 401/403; other failures never trigger the fallback, so real outages are not masked.
- The parser unwraps preflight's `codingPlan` structure; preflight `balanceUsd` is used as a fallback display only when the wallet endpoint is unreadable, never overriding a readable wallet.
- Window and wallet reads are fully independent and parallel: a single failure degrades only that part (window failure → wallet balance only, marked partial; wallet failure → windows kept), and only two failures raise. Errors distinguish authentication failure, no active subscription, invalid responses and network failures.
- Docs now cover endpoint permissions, which endpoints accept a Control Key, why `workspaceId` must come from `items[].workspaceId` of `GET /api/v1/workspaces` (a user id yields 403 `workspace_billing_scope_forbidden`) and a 401 troubleshooting checklist: [OpenDesign billing and troubleshooting](opendesign-billing.md).
- Thanks to [@playgithub](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6215322540) for requesting OpenDesign support and reproducing the entry problem, [@codeforker654](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870) for reproducing and reporting the 401, and [@yunjuanhuakai](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566) for discovering that `/billing/preflight` accepts the Control Key and providing sample responses.

### Upgrade

Re-run the new `install.ps1` or update from the plugin marketplace (`dsh plugin --profile web add dsh-cost-meter@latest` for npm), then fully quit and reopen DSH. The ledger format is unchanged; historical amounts are not recalculated automatically except for the confirmed historical Codex reclassification.
