# v1.9.4

## 中文

本版将本地 `1.9.4-preview.6` 的定价、显示和统计改动，以及已合并的 OpenDesign / Codex 修复一起正式发布。

### 定价列表与模型统计

- **设置 → 费用 → 价格 → 模型定价**改为固定顺序的紧凑列表。输入、缓存读取和输出单价对齐显示，详细编辑按需展开；切换自动匹配、自定义或指定价格表时，模型保留原位置。
- 选择自定义价格后，只滚动一次到编辑区开头并聚焦首个价格字段。自动保存、修改单价或切换币种时不重新滚动、不抢焦点。
- 每个渠道下的模型可以分别选择是否计入**今日费用、月度与累计费用、预算**。取消勾选仅影响对应汇总，保留原始调用、历史金额和价格记录；重新勾选即可恢复。不同汇总选择了不同模型时，金额也会不同。

### 显示设置与峰谷时段

- 预算、今日用量、峰谷时段和模型花费可以独立显示，不再互相依赖。修复只开启峰谷、套餐、自定义余额或网关额度时侧栏未挂载的问题。
- 常用显示开关直接放在显示页。套餐的显示位置和账户选择在同一面板调整，凭据与查询参数仍在额度页，可从显示页直接跳转到对应账户。
- 峰谷时段新增**进度条**样式，显示当前计价时段的时间进度；可选择倒计时、切换时间或同时显示。原细条和分段样式保留，首次介绍可以关闭或选择保留原样。
- 显示预览与真实侧栏共用组件，支持当前缓存或示例数据。预览不启用账户查询、不调用模型、不写入示例账单。

### OpenDesign 与 Codex

- 修复 OpenDesign Control Key 无法保存和旧配置密钥未迁移的问题；正确显示 `VELA_CONTROL_KEY` 等有效凭据来源。
- 额度或钱包一侧失败时，保留可用数据并在设置卡片、侧栏提示和手动刷新结果中显示原因。无生效套餐时仍可显示经过校验的 preflight 余额；工作区或成员身份不一致时不混用数据。
- Codex 额度支持订阅插件的 **5 小时 / 7 天**双窗口，提供自动检测、订阅插件、connect 三种来源选择。切换来源后，旧请求不会覆盖新来源；订阅查询使用宿主 Connection RPC。
- Codex 兼容页签和提示跟随订阅插件的实际启用状态。仅安装但停用、依赖未就绪或已卸载时隐藏；历史归类仍需主动执行。

### 更新与验证

完全退出 DSH（包括托盘）后重新打开，加载新的宿主代码与前端模块。从 npm 更新：

```sh
dsh plugin --profile desktop add dsh-cost-meter@1.9.4
```

桌面端应使用应用自带的 CLI，具体路径见 [Desktop 安装说明](install-troubleshooting.md#desktop-安装与更新)。Web 用户将 profile 改为 `web`。

本版不自动重算历史费用。合并后的完整回归、真实浏览器中的显示设置、定价列表顺序和自定义编辑定位检查通过。OpenDesign 另已通过真实 DSH 本地凭据库验证；认证查询使用模拟响应，没有使用真实 OpenDesign 账户或调用付费模型。

感谢 [@lewispumpkin 在 PR #316](https://github.com/Han-1413141/dsh-cost-meter/pull/316) 贡献 Codex 双窗口与来源选择接入；感谢 [@unifilitence 在 issue #317](https://github.com/Han-1413141/dsh-cost-meter/issues/317) 报告并定位 OpenDesign 凭据保存映射遗漏。

## English

This release ships the pricing, display and statistics changes previewed in `1.9.4-preview.6`, together with the merged OpenDesign and Codex fixes.

### Pricing and per-model statistics

- **Settings → Cost → Prices → Model pricing** uses one compact list with a stable model order and aligned input, cache-read and output rates. Editors expand on demand; changing a price source keeps the model in place.
- Selecting a custom price scrolls once to the editor and focuses its first field. Autosave, price edits and currency changes preserve scroll position and focus.
- Each channel/model can independently participate in **today's costs, monthly/all-time totals and budgets**. Exclusions affect only the selected summary; original calls, historical amounts and prices remain. Re-enable a model to restore its contribution. Summaries with different model selections can show different amounts.

### Display and peak/off-peak hours

- Budget, today's usage, peak/off-peak hours and model costs can appear independently. Fixed the sidebar failing to mount when only peak hours, plan quotas, a custom balance or gateway quota is enabled.
- Common switches are available directly in Display. Plan placement and account selection share one inspector, with a link to that account's credentials and query settings in Quotas.
- A new **progress** style shows elapsed time in the current pricing period, with countdown, switch time or both. Existing thin and segmented styles remain available. The one-time introduction can be dismissed without changing the style.
- Display previews share the real sidebar components and can use cached or sample data. Sample previews do not start account queries, call models or write example bills.

### OpenDesign and Codex

- Fixed saving the OpenDesign Control Key and migrating legacy keys. Credential indicators now recognize valid aliases such as `VELA_CONTROL_KEY`.
- Partial quota/wallet failures preserve usable data and display the reason. A validated preflight balance remains available without an active subscription; mismatched workspace/member identities are rejected.
- Codex quota supports the subscription plugin's **5-hour and 7-day** windows and selectable auto/subscription/connect sources. Late requests cannot overwrite a newly selected source. Subscription queries use the host Connection RPC.
- Codex compatibility controls follow the subscription plugin's active runtime status. Inactive, unavailable or removed peers no longer leave a visible compatibility tab. Historical reclassification remains an explicit action.

### Updating and validation

Fully quit DSH, including its tray process, and reopen it after updating. Use the application's own CLI for the Desktop profile; see [Desktop installation](install-troubleshooting.md#desktop-安装与更新). This release does not automatically reprice historical calls.

The integrated regression suite and real-browser display/pricing checks passed. OpenDesign credentials were also tested with the real DSH local credential provider; authenticated HTTP responses were simulated, without a live OpenDesign account or paid model call.

Thanks to [@lewispumpkin for PR #316](https://github.com/Han-1413141/dsh-cost-meter/pull/316), which contributed Codex quota windows and source selection, and [@unifilitence for issue #317](https://github.com/Han-1413141/dsh-cost-meter/issues/317), which reported and located the missing OpenDesign credential mapping.
