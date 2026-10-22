# v1.9.23

## 中文

- **团队费用显示在主代理窗口。** 启用智能体团队后，主代理的会话费用和明细自动包含团队成员及其子代理的费用、Token 与调用数，仍可查看每个代理的记录。各代理继续分别入账，汇总不会重复增加每日费用，普通分叉会话不计入团队。
- **价格列表移除已删除的渠道和模型。** 当前价格配置按 DSH 的供应商、模型目录显示，已删除的项目不再留在待定价列表。历史费用、保存的价格和统计设置保留；恢复渠道后，可继续使用已有设置。目录查询失败时不会把现有模型全部隐藏。
- **上下文洞察联动跟随显示币种。** 切换 USD、CNY 或 EUR 后，联动标题和金额即时更新。当前上下文的非缓存参考价使用当前显示汇率换算，实际账单沿用既有记录；参考价说明继续显示。

更新后完全退出并重启 DSH。团队汇总自动生效；普通子代理的汇总仍可通过现有设置控制。

感谢 [@Theicecold](https://github.com/Theicecold) 在 [issue #367](https://github.com/Han-1413141/dsh-cost-meter/issues/367) 提供币种不一致的问题报告和统一显示建议。

## English

- **Show team costs in the lead's window.** Session costs and details automatically include team members and their subagents, with per-agent records available. Agents retain separate ledger entries, so daily spending is not counted twice. Ordinary conversation forks stay separate.
- **Remove deleted routes and models from the pricing list.** Filter active pricing configuration against DSH's provider/model directory while retaining historical costs, saved prices and statistics preferences. Restored routes can reuse their settings. Unavailable directory metadata does not hide all existing models.
- **Follow display currency in the dsh-context integration.** Switching USD, CNY or EUR updates both labels and amounts immediately. The uncached current-context reference uses the current display exchange rate; recorded actual bills retain their existing amounts. Keep the reference-price explanation visible.

Fully quit and restart DSH after updating. Team aggregation is automatic; the existing option still controls ordinary subagent aggregation.

Thanks to [@Theicecold](https://github.com/Theicecold) for reporting the currency inconsistency and suggesting consistent display in [issue #367](https://github.com/Han-1413141/dsh-cost-meter/issues/367).
