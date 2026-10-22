# v1.9.6

## 中文

### 官方余额重新开启后立即显示

修复“显示位置设为关闭，退出设置，再进入改回两者都显示后，余额仍不出现”的问题。关闭时写入的状态不再阻挡重新查询，恢复显示会立即取得余额或显示查询错误，无需重启或等待刷新间隔。仅在侧栏、设置页面之间切换位置时继续沿用有效缓存。

### CLIProxyAPI 局域网配置

在“设置 → 费用 → 额度”中，点击 CLIProxyAPI 来源名称展开配置。每个来源现在都提供凭据白名单和“允许非回环 HTTP”开关。

例如 Base URL 为 `http://192.168.1.100:8317` 时，凭据白名单填写 `192.168.1.100:8317`，并勾选“允许非回环 HTTP”，然后保存该来源的 Management Key 并启用。HTTPS 来源只需配置准确的主机与端口白名单；HTTP 会明文传输凭据，开关说明保留此提示。授权分别属于各个来源，添加其他来源不会继承。

感谢 [@snhun](https://github.com/snhun) 在 [#321](https://github.com/Han-1413141/dsh-cost-meter/issues/321) 报告局域网配置缺少入口，并建议为新增来源分别提供配置。

### 输入区额度组件背景

输入框上方的预算、Go、套餐与 Codex 额度组件改用透明背景，与所在页面保持一致；文字、进度条和交互状态继续使用 DSH 主题颜色。

### 本地验证

使用已构建客户端与生产宿主服务，在真实 Chrome 中执行关闭余额、退出设置、重新进入并恢复显示的完整过程；刷新间隔设为 60 分钟，恢复后立即显示余额。CLIProxyAPI 使用本机局域网 HTTP 模拟管理服务，验证配置保存、重新进入、真实 HTTP 查询、两个来源权限独立，以及缺少白名单或 HTTP 授权时在发送凭据前拒绝请求。数据和密钥为测试值，不查询用户账户，不调用模型。

安装更新后，完全退出 DSH（包括托盘）再打开以加载新版插件。以后切换余额显示无需重启。

## English

### Immediate balance display recovery

Re-enabling official balance display now queries immediately instead of reusing a disabled snapshot until its refresh interval expires. Closing and reopening settings no longer requires a DSH restart. Switching between sidebar and settings placements retains valid cached data.

### CLIProxyAPI LAN settings

Each source now exposes its exact credential host allowlist and non-loopback HTTP permission. For `http://192.168.1.100:8317`, enter `192.168.1.100:8317` in that source's allowlist and enable non-loopback HTTP. HTTP sends credentials in plaintext, as indicated by the control. Permissions remain independent between sources. Thanks to [@snhun](https://github.com/snhun) for reporting the missing controls and suggesting per-source settings in [#321](https://github.com/Han-1413141/dsh-cost-meter/issues/321).

### Composer quota backgrounds

Quota chips above the composer use a transparent background to blend into their containing page while retaining theme text, progress bars and interaction states.

### Validation

A real Chrome test connects the built client to the production host service, exercises closing and reopening settings with a 60-minute balance cache, and queries a local LAN HTTP gateway. It verifies persisted source configuration, independent permissions, and rejection before credential transmission when either permission is missing. All account data and credentials are synthetic; no model calls are made.

Fully quit DSH, including its tray process, and reopen after installing this update. Subsequent balance display toggles do not require restarting.
