# v1.8.33

## 中文

修复 [#292](https://github.com/Han-1413141/dsh-cost-meter/issues/292)：V4 Pro 错误套用 Flash 单价，导致费用低估。恢复 Pro 的独立人民币和美元峰谷价格，旧版本中可识别的错误内置模板会更新，手动单价、倍率与其他厂商价格保留。

官方价格同步直接采用页面解析结果，内置调价规则不再覆盖官方报价；同时更新旧 Flash 名称。中英文官方文档使用带尾斜线的价格页地址，避免英文地址返回 API 入门页面。

新增单模型历史重算。在“费用 → 价格 → 同步与规则 → 历史费用”搜索并选择渠道＋模型，确认后只修改该模型的历史费用。保留原调用汇率与其他模型的金额，日志覆盖不完整的记录不改。重算前自动备份，重算记录标明范围；重启后的明细继续沿用各模型自己的价格版本。

感谢 [ztszzz733](https://github.com/ztszzz733) 提供问题定位和官方价目对照。[设置与历史修正方法](model-history-repricing.md#中文)。升级后完全重启 DSH。

## English

Fixes V4 Pro being charged at Flash rates in the built-in catalog. Pro now retains its separate official CNY/USD peak and off-peak prices. Recognizable incorrect defaults are upgraded while preserving manual rates, multipliers and third-party catalogs. Official synchronization respects parsed prices and updates legacy Flash names.

Adds channel/model-specific historical recalculation under Pricing → Sync & rules. Only the selected model changes, with original exchange rates retained. Other model amounts and incomplete records remain unchanged. Backups, scoped before/after records and restart-safe price revisions are retained.

Thanks to [ztszzz733](https://github.com/ztszzz733) for [#292, diagnosis and price comparisons](https://github.com/Han-1413141/dsh-cost-meter/issues/292). See [usage details](model-history-repricing.md#english). Fully restart DSH after upgrading.
