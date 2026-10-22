# v1.8.34

## 中文

修复 [#293](https://github.com/Han-1413141/dsh-cost-meter/issues/293) 的上下文总量差异。代理压缩后，费用联动优先采用宿主按提供商用量校准的上下文总量，与 dsh-context 标题及输入区占用环一致，不再用较大的本地文本估算覆盖它。长上下文价格档位使用同一总量。

分类 Token 和参考费用按组成比例估算，页面标明它们不是压缩后各段的实测用量。当前上下文费用表示全部按非缓存输入发送一次的参考金额，不包含缓存折扣与输出费用，也不是本会话累计费用。实际调用账单和历史金额保持原值。

仅上下文占用变化时也会刷新联动；不可见区域继续暂停查询，生成和摘要期间继续暂缓测量。感谢 [1349422030](https://github.com/1349422030) 提供截图、环境与 billion-context 版本信息。

升级后完全退出并重新打开 DSH。[上下文费用说明](context-costs-design.md)。

## English

Fixes the context-total discrepancy reported in [#293](https://github.com/Han-1413141/dsh-cost-meter/issues/293). Costs now follow the host's provider-anchored context pressure, matching the dsh-context headline and composer ring after proxy compression. Local text estimates no longer override a smaller calibrated total, including for long-context pricing thresholds.

Component tokens and costs remain proportional estimates, explicitly labeled as such. The input estimate covers one uncached send, excluding cache discounts and output charges; it is not the cumulative session bill. Recorded calls and historical amounts stay unchanged. Pressure-only changes refresh the view while hidden-view and generation deferral policies remain in place.

Thanks to [1349422030](https://github.com/1349422030) for the screenshots, environment details and billion-context version. Fully restart DSH after updating.
