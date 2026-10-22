# Token Plan 用量统计面板说明 / Token Plan Usage Stats Guide

> 入口 / Where: dsh web → **费用设置(Cost) → 用量(Usage) → Token Plan 用量统计**
> 面板标题:*「Token Plan 用量统计(每 1% 与满窗估算)」/ "Token Plan usage stats (per-1% & full-window estimates)"*

## 中文

### 面板截图

![Token Plan 用量统计(中文)](screenshots/token-plan-stats-zh.png)

### 这是什么

订阅制渠道(OpenCode Go、MiniMax、Codex 手动标记等)的额度不产生真实账单,插件通过**定期刷新厂商额度接口的已用百分比采样**来回答三个问题:

| 列 | 含义 |
|---|---|
| 窗口 | 5 小时(滚动)/ 本周 / 本月;窗口边界按小时粒度对齐,周/月按本地日历 |
| 已用 % | 厂商接口返回的官方读数(**该账号全部用量**,含其它机器/CLI) |
| 本周期实际(本地账本) | 同一窗口内**只在 dsh 里发起的调用**按目录 API 价折算的 token 与等值金额 |
| 每 1% 额度 ≈ | 由采样**首尾差分**推算:每 1% 百分比 ≈ 多少 token / 多少等值金额 |
| 满窗 100% ≈ | 每 1% × 100,即这个窗口吃满时的总量折算 |

### 自定义渠道如何关联套餐

额度查询使用对应厂商的账号凭据；本地用量使用调用记录里的 `provider:model`。能查到额度，不代表自定义渠道已经关联到这家套餐。

在 **设置 → 费用 → 用量 → 按模型统计 → 计费方式** 中，可以为任意已记录的模型选择 **Plan 订阅 · 火山方舟 Coding Plan** 等具体套餐。支持全部已接入的套餐，选择会保存到 `planBilling.modelPlans`，无需改动 DSH 的 Provider ID。千问和 SCNet 的本地 Credits 也使用这份归属。

自动模式保留现有渠道别名，并识别 Provider ID 或 Model ID 中明确的“厂商名 + 套餐特征”：例如 `my-ark-coding-plan`、`MiniMaxTokenPlan`、`火山方舟CodingPlan`。特征包括 `Plan`、`Coding Plan`、`Token Plan`、`Subscription`、`套餐`、`订阅`；同时出现多个厂商时不自动选择。自动计费方式仍跟随该套餐的启用开关或厂商级设置；手动选择具体套餐或 API 优先。只有 `doubao`、`claude` 等共享模型名时，不据此推断订阅。

关联变更后，完整历史日按新归属汇总；近期 48 小时从现有会话日志恢复小时统计。恢复前会核对 Token、调用次数与已记录金额，日志缺失或不完整时保留现有记录。不会重新增加调用次数或费用。升级恢复只执行一次，后续仅在归属变化或导入历史时后台执行。

### 估算方法与精度

- **首尾差分**:把样本切成「连续可信段」做端点差分——中间读数的量化误差两两抵消;差分跨度 ≥5 个百分点时结果可信(方法列无标注),不足时波动较大并标注**「读数精度受限」**。
- **回退(live)**:样本超 7 天或不足两次成功刷新时,退回「本周期实际 ÷ 当前已用%」折算,精度最低。
- **用量曲线**:每日/每周/每月三种聚合,按采样区间累加(Σtokens÷Σpct),随使用时间逐步成形。

### 口径边界(重要)

- 本面板的**「本期实际」与每 1%/满窗估算只统计在 dsh 内发起的调用**——同一 Key 在其它机器/CLI 的消耗不进本地账本;
- 服务端「已用%」是该账号**全部用量**:两者之差即其它渠道消耗,因此本地数字偏低属预期;
- 「金额」是目录价折算的**等值美元**(订阅消耗的是套餐额度,不动真金白银);预算/今日费用等金额展示仍只统计 API 真金白银口径;
- SCNet 为本地 Credits 自估,不参与百分比采样估算。

---

## English

### Screenshot

![Token Plan usage stats (English)](screenshots/token-plan-stats-en.png)

### What it is

For subscription channels (OpenCode Go, MiniMax, manually-flagged Codex, …) nothing is billed per call, so the plugin polls each vendor's quota endpoint and samples the reported used-percentage to answer three questions:

| Column | Meaning |
|---|---|
| Window | 5-hour (rolling) / this week / this month; edges align to whole hours, week/month follow the local calendar |
| Used % | Official reading from the vendor (**entire account**, including other machines/CLIs) |
| This period actual (local ledger) | Tokens and catalog-price equivalent cost of calls made **inside dsh only**, within the same window |
| Per 1% quota ≈ | End-to-end sample delta estimate: how many tokens / how much equivalent cost one percentage point represents |
| Full window (100%) ≈ | Per-1% × 100 — what a fully consumed window adds up to |

### Assigning custom providers to a plan

Quota queries use vendor account credentials; local usage uses the recorded `provider:model` key. A successful quota query does not automatically associate an arbitrary custom provider with that subscription.

Open **Settings → Cost → Usage → Model statistics → Billing class** and choose a specific **Plan subscription · vendor** for any recorded model. All supported plan families are selectable. The assignment is saved in `planBilling.modelPlans`; changing the DSH Provider ID is unnecessary. Local Qwen and SCNet Credits use the same assignment.

Auto mode keeps existing provider aliases and recognizes an explicit vendor name plus a subscription marker in the Provider ID or Model ID, such as `my-ark-coding-plan` or `MiniMaxTokenPlan`. Markers include `Plan`, `Coding Plan`, `Token Plan`, `Subscription`, `套餐` and `订阅`. Ambiguous names containing multiple vendors are not assigned. Auto billing classification follows the plan's enable switch or vendor-level setting; an explicit plan or API choice takes precedence. A shared model name such as `doubao` or `claude` alone does not identify a subscription.

Complete historical days follow the new assignment. Recent hourly usage is recovered from existing session logs for the last 48 hours, after checking tokens, call counts and recorded costs. Missing or incomplete logs leave existing records intact. Recovery does not add calls or costs. Upgrade recovery runs once; subsequent background recovery runs only after attribution changes or a history import.

### Method & precision

- **End-to-end deltas**: samples are cut into continuous trustworthy segments; endpoint deltas cancel intermediate quantization noise. Segments spanning ≥5 percentage points are reliable; shorter ones fluctuate and get a **"low reading precision"** tag.
- **Live fallback**: with samples older than 7 days (or fewer than two successful refreshes), values fall back to "this period actual ÷ current used %".
- **Usage curves**: daily/weekly/monthly aggregation over sample intervals (Σtokens ÷ Σpct); they take shape as usage accumulates.

### Scope boundary (important)

- The **local-ledger column and all estimates cover calls made inside dsh only** — the same key used from other machines/CLIs never enters this ledger;
- Server "used %" covers the **whole account**: the difference between the two is consumption elsewhere, so low local numbers are expected;
- Amounts are catalog-price **equivalents** (subscriptions spend plan quota, not real money); budget/today-cost displays still count real-money API channels only;
- SCNet uses local Credits self-metering and does not participate in percent sampling.

---

相关文档 / See also: [CHANGELOG](../CHANGELOG.md) · [安全审计 v1.6.1](security-audit-v1.6.1.md)
