# v1.9.3

## 中文

- 修复 Codex 兼容提示关闭失败。×、Esc 和“保持现状”立即关闭弹窗，即使归类请求尚未返回或保存接口报错；关闭后不反复弹出，历史归类仍可在设置页手动执行。
- 修复热更新后 Codex 历史归类接口返回 HTTP 404。宿主保留旧接口清单时，只补注册缺失的兼容接口；卸载时撤销补注册，保留宿主原有注册。
- 修复 Codex 标签页空白，恢复版本、计费方式、历史用量和归类入口；加载失败可以重试，归类失败会显示错误。
- 概览卡片移除多余底部留白，保存状态靠右；计费统计先显示标题和数据，兼容说明及 dsh-context 设置合并为默认折叠的一行。

历史归类读取本地账本，不依赖 Codex API Key。安装本版不会自动重算历史费用。更新后完全退出并重新打开 DSH，以加载完整的宿主与前端代码。

## English

- The Codex compatibility prompt closes immediately with ×, Esc, or Keep status quo, including while a request is pending or fails. Dismissal is retained locally; historical reclassification remains available in settings.
- Fixed HTTP 404 after hot updates when the host retains an older RPC manifest. Only missing compatibility endpoints are registered, with cleanup tied to the plugin lifetime.
- Fixed the blank Codex tab, restored usage and reclassification controls, and added visible action errors and load retry.
- Removed excess spacing from overview cards and placed optional compatibility controls in a collapsed row below the statistics heading.

Historical reclassification uses the local ledger and does not require a Codex API key. Updating does not automatically recalculate historical costs. Fully quit and reopen DSH after updating.
