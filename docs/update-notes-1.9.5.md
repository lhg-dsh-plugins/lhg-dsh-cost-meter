# v1.9.5

## 中文

### Codex 额度恢复显示

开启“显示 Codex 额度”和“在侧栏显示 Codex 额度”后，查询失败或暂未登录不会再让卡片消失。卡片显示登录与重试提示，点击可立即重新查询。启用期间自动恢复检查，成功数据缓存五分钟，失败一分钟后重试；关闭后停止检查。

额度改用简洁文字卡，例如“周额度 · 剩余 83% · 10/25 08:10 重置”。按接口实际返回的窗口显示，Pro 等只返回周额度的账户不会增加 5h；只有存在 5h 时才增加对应行。预览跟随已取得的窗口，没有账号数据时默认只预览周额度。统一使用剩余比例，重置时间按本机时区显示；会话额度条也明确标注“剩余”，多窗口时标明 5h／周。

在“设置 → 费用 → 显示 → 输入区”选择“Codex 额度”，可以单独关闭“在输入区显示 Codex 额度”，保留侧栏卡片。侧栏和输入区的开关相互独立，两个位置都隐藏时停止额度查询。

“使用示例数据”的百分比仅用于预览。真实额度仍需要启用并登录对应 Codex 插件。修复当前数据预览使用旧快照的问题，预览本身不触发账户查询。

### 三个兼容插件的 GitHub 监控

每日北京时间 08:23 检查 billion-context、dsh-codex-subscription、dsh-codex-connect 的 npm latest。对比导出入口、DSH 兼容范围、宿主依赖和接入函数的语法指纹，billion-context 同时运行现有原版源码契约检查。

新版本、接口变化或检查失败时，GitHub 机器人创建或更新对应插件的跟踪 issue；相同结果不重复通知。不执行上游发布包，不自动升级或自动接受新基线。静态检查与真实账号完整运行是不同的验证范围。[监控说明](plugin-compatibility-watch.md)

更新后完全退出 DSH（包括托盘）再重新打开。

## English

### Codex quota recovery

Enabled sidebar cards stay visible when quota reads fail or the account is signed out. The card explains how to recover and supports an immediate click-to-retry. Enabled views check once per minute, cache successful reads for five minutes, and retry failures after one minute. Disabling the view cleans up its checks.

Compact text rows show the window, explicit remaining percentage and reset date/time in the device timezone, with a separate 5h row when available. The conversation strip also labels percentages as remaining.

Display settings now include Codex in the composer component menu, with separate sidebar and composer switches. Hiding one keeps the other; hiding both stops quota reads.

Example percentages remain preview-only. Real quota requires an enabled, signed-in Codex plugin. Current-data previews now read the current cache without querying the account.

### Upstream compatibility monitoring

A daily GitHub workflow checks npm latest for billion-context, dsh-codex-subscription and dsh-codex-connect. It compares package exports, DSH compatibility, host dependencies and relevant function fingerprints; billion-context also runs the existing source contract checks. New releases, changed interfaces and failed checks create or update one bot issue per plugin. Unchanged observations stay quiet. Upstream code is never executed or automatically accepted as a new baseline.

Fully quit DSH, including its tray process, and reopen it after updating.
