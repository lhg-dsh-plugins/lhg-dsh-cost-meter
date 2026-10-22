# v1.8.30

## 中文

模型匹配下拉新增“自定义价格（此渠道模型）”。按渠道和模型分别保存单价，可选 USD/CNY；常用输入、缓存读取、输出价格直接调整，其他计费项按需展开。复用原价格卡片的倍率输入，支持 `2 × 0.8`、统一与独立倍率，并显示实际单价。切回自动匹配仍保留填写过的价格，历史费用保持原值。

补充 StepFun 全球开放平台 5 个模型的官方美元价格。来源：[StepFun 官方定价](https://platform.stepfun.ai/docs/en/guides/pricing/details)，核实于 2026-10-16。地区报价和其他渠道折扣可按模型自定义。

修复不开费用明细也可能持续读取会话费用的问题。宿主可以在每次渲染时返回内容相同的新投影对象；刷新现在以实际用量、费用、会话身份为条件，避免回读结果引发下一次回读。隐藏页面暂停读取，恢复后刷新。

普通徽章只读账本汇总，不预计算完整历史。明细保留本地快照、悬停和键盘聚焦预加载；启动不再重放近期会话，未打开页面不计算整份明细。首次无缓存的长会话仍需计算，已有缓存先返回结果，后台再更新。

联动卡片稳定挂载后复用原节点，提示弹窗打开后停止等待轮询，刷新动画限制为两次。详见[性能说明](https://github.com/Han-1413141/dsh-cost-meter/blob/master/docs/idle-performance.md)。

感谢 [@KezhiAdore 在 #284](https://github.com/Han-1413141/dsh-cost-meter/issues/284) 提供 macOS 启停对照、CPU/GPU 数据和代码线索。Windows 本地浏览器回归证实并修复了重复请求，原 macOS 设备的 CPU/GPU 百分比仍需该设备复测。

## English

The model mapping dropdown now offers channel-specific custom prices in USD/CNY. It reuses the existing price input and shared/per-rate multiplier controls, keeps original quotes, previews effective rates, retains inactive custom settings, and preserves historical costs.

Five token-priced StepFun models are added from the official global USD pricing page, verified on 2026-10-16.

Session-cost refreshes now depend on billing values rather than projection object identity, preventing an RPC/render loop when the host returns fresh but unchanged objects. Hidden pages defer reads.

Badges only read aggregates. Detailed statistics retain saved snapshots and hover/focus prefetch, while startup and unopened views no longer replay history. Background refresh interest expires after a view is no longer used. Stable integration cards reuse their mounted target, dialog wait timers stop once opened, and refresh animations run twice.

Thanks to @KezhiAdore for issue #284 and the macOS toggle comparison. The repeated-request regression was reproduced and fixed in a controlled Windows browser fixture; its results are not a measurement of the reporter’s Mac CPU/GPU usage.
