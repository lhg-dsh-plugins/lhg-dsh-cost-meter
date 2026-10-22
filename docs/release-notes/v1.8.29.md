# v1.8.29

## 中文

显示设置改为真实组件的可交互预览。左侧点击组件，右侧选择样式并调整具体选项；隐藏项目淡化。示例数据可开关，完整展示预算、余额、套餐与模型效果。预览不扫描会话页面，不发账户请求，使用局部监听并在关闭时释放。

保存等待从 600ms 缩短到 120ms，连续修改串行提交，关闭设置会提交待保存内容。移除货币符号输入，保留已有自定义值。每日汇率后台更新，历史金额不随当前汇率变化，详见[汇率说明](exchange-rates.md)。

感谢 [@lxz946786639 的 #282](https://github.com/Han-1413141/dsh-cost-meter/issues/282)：针对未知模型匹配渠道价格时的下拉选择器补齐大目录筛选体验，保留当前选择。1.8.27 已有搜索入口，本版限制渲染数量并完善回归覆盖。

感谢 [@nico-zhuang 的 #279](https://github.com/Han-1413141/dsh-cost-meter/issues/279)：生成和摘要期间不再执行联动上下文测量与历史扫描。原始断流未稳定复现，不能断言宿主或供应商错误已修复；[排查说明](context-stream-diagnostics.md)列出脱敏信息和进一步定位方式。

更新后完全重启 DSH。保留用户配置与账本，示例不会写入历史。

## English

Display settings reuse the real sidebar and quota/model cards, with contextual controls, actual style thumbnails, optional local sample data and bounded observers. Samples never start account requests or modify the ledger.

Autosave uses a 120ms debounce and serialized writes, flushes pending edits on close, and no longer waits for remote quota reads. Existing custom currency symbols remain preserved. Daily background reference rates apply to new calls while historical converted amounts remain frozen; legacy records without recoverable quotes retain their pre-upgrade display baseline.

Thanks to @lxz946786639 for the channel-price dropdown filtering proposal in #282, and @nico-zhuang for the compaction/disconnection investigation in #279. Context measurement/history replay is deferred during generation and compaction. The original upstream disconnection has not been reproduced; this release removes the identified plugin workload risk and documents redacted diagnostics.

Fully restart DSH after updating.
