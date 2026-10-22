# BUGFIX — 启动无条件重拉 OpenRouter 价目表：持久化上次成功时刻 + 1 小时启动冷却（上游 issue #384）

## Bug

对应上游 issue [#384](https://github.com/Han-1413141/dsh-cost-meter/issues/384)（open）：插件每次启动都在启动回填链末端无条件整份拉取 `https://openrouter.ai/api/v1/models`（实测 787,515 B），且成功后不持久化「上次成功时间」，跨重启没有任何跳过依据。报告者遭遇 launchd 重启循环时，13.7 小时约 4,300 次启动被放大成 3.14 GiB 流量（占当天 95%）；常态下每次宿主重启也白白多付约 787 KB。

## 证据链

1. issue #384 的流量实测（4,280 次拉取 ≈ runs=4311）与代码定位（`lib/index.js` 启动 3 秒回填链末端 `await refreshOpenRouter()` 只判 `active`；`refreshOpenRouter` 的小时级 `setInterval` 之外无任何节流；`lib/openrouter-pricing.js` 的 `refresh()` 成功后只写价格与 `openrouterPriceHashes`、随后 `scheduleWrite()` 落盘，但不记成功时刻）。
2. 最小复现（两个控制器在同一账本上先后充当两次「进程启动」，fetch 计数）：修复前输出 `after restart #1: fetches=1, openrouterPricesFetchedAt=(unset)`、`after restart #2 (seconds later): fetches=2`，脚本 exit 1 —— 间隔数秒的两次启动各拉一份完整目录。
3. 基线对照：修复前全量 `node test/verify.mjs` exit 0（全绿）——该缺陷是行为/流量缺陷，无既有失败测试覆盖，故以可复现 issue + 复现脚本立案。

## 根因

启动刷新路径（`refreshOpenRouter` → `createOpenRouterPriceRefresh().refresh()`）只有「插件是否仍激活」一个门，没有任何跨进程的节流状态：价格与指纹都落了盘，唯独「上次成功拉取时刻」从未记录，重启后的新进程无从判断本地快照是否足够新。

## 改动

按 issue 建议 1（最小且与现有小时级定时器同频）实现：

- `lib/openrouter-pricing.js`：新增导出常量 `OPENROUTER_STARTUP_COOLDOWN_MS = 3600_000`；`refresh()` 成功后写 `ledger.openrouterPricesFetchedAt = now()`（`now` 可注入、默认 `Date.now`，随既有 `scheduleWrite()` 一并落盘，失败路径不写）；控制器新增 `refreshOnStartup()`：以控制器创建时（即进程启动载入账本时）快照中的上次成功时刻为判定基准，不足 1 小时直接返回 `{ count: 0, skipped: true }` 不发请求；本进程内的手动/定时刷新只更新落盘值供下一次启动，不追溯改变本次启动决策。
- `lib/store.js`：`Ledger` 新增字段 `openrouterPricesFetchedAt`（构造时清洗为正有限数、否则 0；`Ledger.open()` 从账本文件载入；`snapshot()` 仅在 >0 时落盘、与 `usageCursors` 同口径，不改变未拉取过账本的文件形状；`readDiskSnapshot()`/`adoptSnapshot()` 往返保留）。该字段与 `openrouterPriceHashes` 一样仅为内部记账，不下发客户端。
- `lib/ledger-persistence.js`：`mergeLedger` 三方合并时该时刻取三方最新者（任一进程刚刷新过，其他进程的启动冷却同步生效），>0 才写入合并产物。
- `lib/index.js`：`refreshOpenRouter(startup)` 仅启动回填链传 `true` 并改走 `refreshOnStartup()`；小时级定时器与手动同步（RPC `fetchPrices`）保持无条件刷新，行为不变。
- `test/openrouter-pricing.mjs`：新增 #384 回归用例（注入时钟）：首次启动拉取并记录时间戳；+59 分钟「重启」跳过且发请求数为 0；冷却内手动 `refresh()` 仍拉取；+2 小时后「重启」恢复拉取；时间戳经 `snapshot()` 往返不丢失。

## 复验结果

- 复现脚本修复后 exit 0：第二次启动 `result={"count":0,"skipped":true}`、总 fetch 数仍为 1，`snapshot().openrouterPricesFetchedAt > 0`。
- `node test/openrouter-pricing.mjs` 单跑通过（含上述新用例与既有生命周期断言——既有断言「启动刷新必达目录」在新语义下依然成立：该场景启动快照无新鲜时间戳）。
- 全量 `node test/verify.mjs`：修复前 exit 0，修复后 exit 0（303 条 `[ok]`），无回归。既有基线失败：无。

## 边界

- 只给「启动」一条路径加冷却；手动同步与小时级定时刷新语义不变，价格最旧不超过约 1 小时 + 一次定时周期，与修复前稳态一致。
- 拉取失败不写时间戳：失败后下次启动仍会重试（与原有「失败保留本地价格」策略一致），不会出现「失败一次、冷却一小时」。
- 未采用 issue 建议 2（ETag/`If-None-Match` 条件请求，OpenRouter/CDN 是否回 304 未确认）与建议 3（启动间隔退避）：只做建议 1 的最小实现，重启风暴下的启动流量已有界（每小时至多一份目录）。
- 本版仅递增补丁号（1.9.26 → 1.9.27）；按 fork 集成口径，版本号只改 `package.json`，上游 README/CHANGELOG/install.ps1 中的版本字样保持原文不作同步。
