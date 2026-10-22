# v1.8.36

## 中文

本版修复两个账本相关问题，并跟进 DSH 0.2.1-rc.2 兼容与宿主 pnpm 供应链策略排障。账本格式、价格规则和界面契约不变，不自动重算历史金额。

### 旧会话费用显示 ¥0（#300）

从 1.8.26 等旧版本升级后，升级前产生的会话费用显示 ¥0 而 Token 正常。根因是加载时为旧账本回填的冻结汇率金额（`costCny` / `apiCostCny` / `costEur` / `apiCostEur`）只在内存中，首次三方合并时被磁盘副本覆盖；之后的每次落盘都会重新抹掉，重算数据也无法自愈。

本版修正合并逻辑：基线按磁盘实际字段对齐，加载时回填的冻结金额作为本地值保留并随首次落盘持久化，跨进程合并与重复落盘既不会丢失也不会重复；客户端在冻结金额缺失或为 0 而 USD 金额非 0 时回退到 USD 原值 × 当前汇率（含含 Plan 总额、会话徽章与分渠道明细）。USD 账本数据、历史金额与计价规则不变。

### 赠送余额部分减少误报对账偏差（#302）

赠送余额（带有效期）部分到期/回收时，总额减量全部落在赠送桶、充值桶不变，本地官方渠道费用远低于该减量；旧逻辑只处理赠送余额「归零」，因此会把整块失效金额当成消费偏差上报。

本版在「减量可由赠送桶下降解释、充值桶无实质减少、本地费用最多解释减量 1/4」且原本会触发 drift 时，重置对账基准并给出一次性「更可能是赠送余额到期/回收」说明，不再按消费偏差告警。本地费用能解释减量 1/4 以上、或充值桶自身减少时，仍按真实 drift 提示；#89 的赠送余额归零静默重置行为保留。

### DSH 兼容与安装排障

- 最低支持 DSH 0.2.0，适配目标为 npm `next` 的 **0.2.1-rc.2**（真实 rc.2 宿主记录见[宿主兼容验证](host-compatibility.md)）。
- 新增 [pnpm 供应链策略说明](pnpm-supply-chain-policy.md)：DSH 0.2.1-rc.x 宿主内置 pnpm 11.28.5 默认启用 24 小时 `minimumReleaseAge`，刚发布的插件版本或宿主包可能让安装/卸载失败（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` / `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED`）。给出等待 24 小时、Profile 精确排除、CLI 透传 `--config.minimum-release-age=0` 等绕行方案，并说明卸载解析未接策略回调属宿主内置 pnpm 行为，插件无法修补。
- 感谢 [@ZIye1208](https://github.com/ZIye1208) 对 #300 的复现与根因定位、[@uahoi](https://github.com/uahoi) 对 #302 的报告、复现与根因分析；感谢 [@UNscientific-9](https://github.com/UNscientific-9) 的 DSH 兼容性 PR 跟进。

升级方式：重跑新版 `install.ps1` 或从插件市场更新，升级后完全退出并重新打开 DSH。

## English

This release fixes two ledger issues and follows up DSH 0.2.1-rc.2 compatibility plus pnpm supply-chain troubleshooting. The ledger format, pricing rules and UI contract are unchanged; historical amounts are not recalculated automatically.

### Old sessions showing ¥0 (#300)

After upgrading from older releases, pre-upgrade sessions displayed ¥0 while token counts were correct: the frozen FX amounts backfilled in memory at load time (`costCny` / `apiCostCny` / `costEur` / `apiCostEur`) were dropped by the first three-way merge that adopted the on-disk copy, and every later flush re-broke them. The merge baseline now aligns with the fields actually on disk, the backfill is persisted on the first flush, and concurrent merges and repeated writes neither drop nor double-count it. The client falls back to the USD amount × current FX rate when the frozen fields are missing or zero with a nonzero USD amount. USD ledger data, historical amounts and pricing rules are unchanged.

### False balance-drift warning on partial granted-balance decrease (#302)

When a granted balance partially expires or is reclaimed, the decrease lands entirely in the granted bucket while the top-up balance stays unchanged and local official-channel spend is far below the decrease. The old logic only reset on full zeroing, so the expired amount was reported as consumption drift. The reconciliation now resets the baseline with a one-time "more likely granted balance expiry/reclaim" notice when the decrease is explained by the granted bucket, the top-up bucket did not materially decrease, and local spend explains at most a quarter of it. Genuine drift (local spend explains more, or the top-up bucket decreased) is still reported, and the #89 zeroing behavior is preserved.

### DSH compatibility and installation troubleshooting

- Minimum host is DSH 0.2.0; the adaptation target is npm `next` **0.2.1-rc.2** (see the [host compatibility record](host-compatibility.md)).
- Adds a [pnpm supply-chain policy note](pnpm-supply-chain-policy.md): DSH 0.2.1-rc.x bundles pnpm 11.28.5 with a built-in 24-hour `minimumReleaseAge`, so a just-published plugin version or host package can make install/uninstall fail (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` / `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED`). It documents waiting 24 hours, exact profile exclusions, and forwarding `--config.minimum-release-age=0`, and explains that the unhandled-callback path belongs to the host's bundled pnpm and cannot be patched by the plugin.
- Thanks to [@ZIye1208](https://github.com/ZIye1208) for reproducing and localizing #300, to [@uahoi](https://github.com/uahoi) for reporting, reproducing and analyzing #302, and to [@UNscientific-9](https://github.com/UNscientific-9) for the DSH compatibility follow-up.

Re-run the new `install.ps1` or update from the plugin market, then fully quit and reopen DSH.
