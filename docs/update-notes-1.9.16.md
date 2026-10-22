# v1.9.16

## 中文

### 按所选版本统计 DeepSeek 搜索

插件读取“插件 → 内置插件设置 → 网页搜索”对应的 `web.searchProvider` 与 `web.fetchProvider`。新版开关开启时为 `deepseek-search-api`／`deepseek-fetch-api`；关闭时为 `deepseek-official` 的 Messages 搜索和本地 HTTP 抓取。每次调用开始时保存选择，并依据实际请求接口确认版本。修改开关只影响后续调用。

根据 [DeepSeek 官方指南](https://api-docs.deepseek.com/zh-cn/guides/search/)（2026-10-19 核对），新版独立 Search／Fetch API 均为每 1,000 次成功请求 ¥5，仅 HTTP 200 且有搜索结果／正文时计费，结果条数不乘价。失败、空结果和超时不收费。

旧版 Messages 搜索保留真实模型 Token 费用。可确认的服务端成功搜索调用另列请求项目：北京时间 2026 年 11 月 1 日 00:00 前请求费为 0，此后每次 ¥0.005；未确认成功的调用不估补次数费。模型 Token 和搜索请求分别统计，不重复计入 Token。本地 HTTP 抓取保持无官方 API 次数费。统计详情标明旧版 Messages／新版 Search API／新版 Fetch API。

历史记录保留调用时的版本、请求单价和汇率，不因切换搜索设置改价。生产记录不保存搜索词、URL、正文或凭据。适配依据见 [DSH 官方设置控制器](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-settings-web-search/src/client/web-search-card-controller.ts)。

### 今日同时显示费用和 Token

在“费用 → 显示”选中“今日用量”，分别开启费用与 Token 用量，支持仅一项或同时显示。两项右对齐并列，窄侧栏自动换行；预览中两个子项各有虚线，点击可定位相应开关。

### 直接拖动侧栏组件

在显示设置预览或主界面侧栏，将组件左侧手柄拖到目标卡片上方或下方即可调整顺序；手柄聚焦后也可使用上下方向键。不同套餐和网关卡片可分别排序，Go 与预算分开显示。顺序自动保存，隐藏再显示、切换布局和重启后保留。保存失败时主侧栏保留原顺序并显示提示。

验证覆盖官方新版提供方固定源码、实际 DSH 服务注册与本地 HTTP 传输，旧版 Messages 真实用量、搜索开关快照、11 月 1 日时间边界、重启与历史回放，以及浏览器中的双项布局、子项虚线、两处拖放和失败处理。所有接口验证使用合成数据及本机服务器。

### 合并卡片、免费模型与提醒修复

在“费用 → 显示 → 侧栏布局”选择“合并卡片”，可以将今日 Token 放在标签旁、费用放在右侧，下方显示余额与一行峰谷信息、细进度条。原有简洁、标准和紧凑布局保留；隐藏组件、拖动排序和单项显示继续生效。首次更新提供一次介绍，关闭或选用后会保存记录。

检测到当前宿主启用了 `dsh-our-free-model` 后，“价格 → 按模型设置”提供“从此插件调用的所有模型按免费计算”开关，默认保持原计价。开启后，只对 `our-free-model` 和 `our-free-model-region` 两个实际渠道后续调用使用零单价，包括该插件的账号渠道；Token 照常记录，其他提供方与保存过的历史价格不变。关闭可恢复普通匹配与自定义计价。

Codex 的侧栏和输入区显示开关可以同时开启必要的额度查询，查询总开关也可直接修改；保存和重载保持一致。订阅插件已启用但查询关闭时，侧栏提供启用入口。设置页 Codex 与其他页签使用一致的内边距、高度和中线。

Go 的悬浮详情列出 5 小时、周、月三个窗口的用量和重置时间；未知额度显示“—”，0% 保留为真实数值。峰价提醒继续使用浏览器顶层，增加页面级后备挂载和低高度窗口滚动，确保“知道了”按钮可操作。

`billion-context` 提醒点击“知道了”后，将对应状态与版本的确认记录保存到账本。新增“不再弹出此提醒”，也可在“费用 → 显示 → 兼容提醒”关闭或恢复弹窗。关闭不影响兼容检测和页面中的状态说明；记录保留最近 32 个不同提醒。保存失败会显示错误并允许重试。

千问 CLI 普通查询保留 15 秒超时，订阅兜底查询单独使用 60 秒；仍支持调用方显式指定超时。新提示说明 CLI 的订阅查询可能超过 30 秒，并给出终端检查命令。感谢 @forkhala 在 [#349](https://github.com/Han-1413141/dsh-cost-meter/issues/349)、[#350](https://github.com/Han-1413141/dsh-cost-meter/issues/350) 提供计时、重启与账本对照复现，感谢 @orshih6 在 [PR #351](https://github.com/Han-1413141/dsh-cost-meter/pull/351) 提供千问分命令超时实现和测试。

更新后完全退出 DSH（包括托盘）再打开。

## English

### Distinguish legacy and new DeepSeek search

The plugin reads DSH’s `web.searchProvider` and `web.fetchProvider`, snapshots the selection at call start, and confirms the version from the actual endpoint. Legacy Messages search retains its real model-token charges. New standalone Search/Fetch calls cost CNY 5 per 1,000 successful requests: HTTP 200 with nonempty results or page content. Result count does not multiply the fee.

Observed successful server-side searches are free of request fees until November 1, 2026 at 00:00 Beijing time, then cost CNY 0.005 per request. Missing or failed calls do not receive invented fees. Local HTTP fetching has no official API request charge. Historical versions, rates and exchange rates remain attached to the original calls. See the [official rules](https://api-docs.deepseek.com/guides/search/).

### Today: cost, tokens or both

Select Today’s usage under Cost → Display and use its separate cost and token switches. Both values align to the right and wrap in narrow sidebars. Each preview sub-item has its own outline and focuses the matching control.

### Drag sidebar components

Drag the left handle in Display’s preview or the main sidebar, or focus a handle and use arrow keys. Each plan and gateway card can move independently; Go and Budget use separate cards. Order saves automatically and survives layout changes, hiding and restart. A failed save retains the main sidebar’s previous order.

### Combined sidebar, free-model billing and persistent reminders

Choose Combined card under Cost → Display → Sidebar layout. Today’s tokens and cost share a row, followed by balance and a thin pricing-period progress bar. Existing layouts, visibility controls and drag ordering remain available; the introductory dialog is shown once.

When the active host enables `dsh-our-free-model`, Pricing’s per-model settings offer an optional zero-price mode for future calls through `our-free-model` and `our-free-model-region`, including account channels. Tokens remain recorded. Other providers and stored historical prices keep their billing rules.

Codex visibility can enable quota queries, and its explicit query switch persists correctly. Disabled queries have a sidebar entry when the subscription plugin is active. Tabs share the same alignment and padding. Go tooltips show 5-hour, weekly and monthly usage and reset times. Peak reminders use the browser top layer, a body-level fallback and viewport-limited scrolling.

Billion-context acknowledgements now persist in the ledger, with a Do not show this reminder again action and a Display preference. Detection and status remain available when popups are muted. Qianwen keeps a 15-second summary timeout and uses 60 seconds for subscription fallback; errors identify slow CLI responses. Credits: @forkhala for [#349](https://github.com/Han-1413141/dsh-cost-meter/issues/349) and [#350](https://github.com/Han-1413141/dsh-cost-meter/issues/350), and @orshih6 for the timeout implementation and tests in [#351](https://github.com/Han-1413141/dsh-cost-meter/pull/351).

Validation uses pinned official provider sources, real DSH services and local synthetic HTTP responses, plus browser drag, layout, persistence and failure checks. Fully exit DSH, including its tray process, and reopen after updating.
