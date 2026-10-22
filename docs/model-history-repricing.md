# 按模型重算历史费用

## 中文

在 **费用 → 价格 → 同步与规则 → 历史费用** 中设置“重算范围”。选择框支持搜索历史渠道或模型名。

1. 先在“模型定价”或“参考价格表”保存正确的单价和倍率。
2. 回到“同步与规则”，选择具体的 **渠道＋模型**，例如 `deepseek-official:deepseek-v4-pro`。
3. 点击“重算此模型的历史费用”，核对确认框中的范围，再点击“确认重算”。

只更新选中渠道模型在保留历史中的费用；同名模型的其他渠道、同一渠道的其他模型和 Token 数不变。单模型重算使用当前单价与倍率，保留每次调用原有的汇率、调用时间对应的峰谷和上下文档位。只扫描涉及该模型的会话，沿用现有日志完整性检查：日志缺失、Token 或调用数对不上的会话日期记录不改。

重算前会在账本旁保存 `ledger.json.before-reprice-时间戳.json`。原金额、价格版本与重算记录继续保留；记录中显示具体渠道模型及该范围的重算前后金额。重启后，统计与明细按对应模型的重算版本读取，其他模型沿用原版本。

“全部模型”保留原有全量重算功能。修改重算范围本身不保存价格配置，也不会启动重算。升级修正内置价目不会自动重算已有费用。

### #292 的修复

v1.8.33 删除了错误的“V4 Pro 自 9 月 14 日按 Flash 价计费”规则。当前 [DeepSeek 官方中文价目页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)中，每百万 Token 的 Pro 谷价为缓存命中 ¥0.15、未命中 ¥4.5、输出 ¥13.5，峰价分别为 ¥0.30、¥9、¥27；Flash 谷价仍为 ¥0.02、¥1、¥4，峰价为两倍。

更新后会修正可识别的旧内置错误模板，保留手动单价、倍率、其他厂商价格、原历史金额与汇率。官方同步按页面实际价格更新，并同时更新 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 旧名称。需要修正旧账时，按上方步骤选择实际使用的渠道＋Pro 模型，不要删除账本的迁移标记。

感谢 [ztszzz733](https://github.com/ztszzz733) 在 [#292](https://github.com/Han-1413141/dsh-cost-meter/issues/292) 提供问题定位、官方价格对照及用量比较；单模型重算由本项目维护者提出。

## English

Open **Cost → Pricing → Sync & rules → Historical pricing**. Save the correct rates and multipliers first, then search for and select one **channel/model** under “Recalculation scope”. Click “Recalculate this model” and confirm the displayed scope.

Only that channel/model's retained historical costs change. Other channels using the same model, other models, and Token counts remain unchanged. Model-specific recalculation uses current rates and multipliers while retaining each call's original exchange rates and time/context tiers. Only relevant sessions are scanned. Incomplete or mismatching logs remain unchanged.

A full ledger backup is created before recalculation. Original amounts and price versions are retained. History records show the chosen scope and its before/after amounts; replay after restart keeps each model's own revision. “All models” retains the existing full recalculation action. Selecting a scope alone has no side effects.

v1.8.33 also fixes [#292](https://github.com/Han-1413141/dsh-cost-meter/issues/292): V4 Pro keeps its separate official price, and legacy Flash names are updated during official synchronization. Recognizable incorrect built-in templates are corrected for future calls without automatically rewriting historical amounts. Thanks to [ztszzz733](https://github.com/ztszzz733) for the report, diagnosis and official-price comparison.
