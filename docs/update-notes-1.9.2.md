# v1.9.2

## 中文

本版包含 [PR #314](https://github.com/Han-1413141/dsh-cost-meter/pull/314) 的全部修复。v1.9.1 未单独发布到 npm，其记账、落盘合并、统计缓存和设置比较优化也一并发布。账本格式与历史金额口径不变，升级无需手动迁移。

- **OpenDesign**：直接并行查询接受 Control Key 的 `/billing/preflight` 与独立钱包接口，正常查询从 3 次 GET 减为 2 次，保留身份、大整数和单侧失败处理。仅在 DSH 中使用模型 API 计费，不需要安装 OpenDesign 应用；远端额度查询需要工作区 ID 和 Control Key。[配置说明](opendesign-billing.md)
- **自定义余额**：以 `/` 开头的相对路径跟随 DSH 实际监听端口，端口改变后缓存失效。局域网 HTTP 需显式打开 `allowInsecureHttp` 并填写准确的主机与端口白名单；凭据仍通过凭据库引用。[配置说明](custom-balance-sources.md)
- **WorkBuddy2API**：新增积分预设，读取管理接口的活跃账号池积分 `summary.available_remaining`。使用管理端 `X-Admin-Token`，不是模型 API Key；按实际服务端口填写地址。
- **皮肤透明度**：页面与弹窗保留皮肤 RGB 颜色并去除背景 alpha；统计内容使用弹窗表面色，解决深色壁纸遮罩与浅色弹窗混用时的黑底黑字。11 类区域、3 种主题、4 档透明度共 132 个浏览器场景全部通过。
- **性能**：缓存自动语言模式的宿主语言探测结果，随设置和语言事件失效；没有事件的旧宿主最多每秒检查一次。5 轮各 2,000 次费用读取的隔离基准中，中位耗时从 1,719.58 ms 降至 40.19 ms，降低 97.7%；此数值不代表整个 DSH 的 CPU 降幅。新增功能后，主客户端仍从 261,676 字节降至 260,671 字节。[原始数据与复现方法](performance-2026-10-18.md)

本版代码已通过完整本地回归、Windows / Linux 安装、宿主兼容、浏览器交互及 CodeQL 检查。OpenDesign 与 WorkBuddy2API 的认证路径使用模拟响应验证，未查询真实用户账号。

### 升级

在 DSH 对应的 CLI 中执行：

```powershell
dsh plugin --profile desktop add dsh-cost-meter@1.9.2
```

随后完全重启 DSH。Web 用户把 `desktop` 换成 `web`；Desktop 用户按[桌面版安装说明](install-troubleshooting.md#desktop-安装与更新)使用应用自带的 CLI。

### 贡献

- @playgithub 提出 [#274](https://github.com/Han-1413141/dsh-cost-meter/issues/274) 接入需求、设置交互反馈及仅使用 DSH API 的配置问题。
- @codeforker654 提供 [Control Key 401 复现](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870)；@yunjuanhuakai 提供 [preflight 端点定位、响应结构与验证](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566)。
- @unifilitence 提供 [#313](https://github.com/Han-1413141/dsh-cost-meter/issues/313) 独立复现、端点建议与钱包契约。
- @XHPAN 提供 [#312](https://github.com/Han-1413141/dsh-cost-meter/issues/312) CPU profile 归因和缓存失效建议。
- @Jav1es 提供 [#311](https://github.com/Han-1413141/dsh-cost-meter/issues/311) 随机端口复现与相对路径建议。
- @snhun 提出 [#309](https://github.com/Han-1413141/dsh-cost-meter/issues/309) 局域网 HTTP 和 [#310](https://github.com/Han-1413141/dsh-cost-meter/issues/310) WorkBuddy2API 接入需求。

## English

This release includes all fixes from [PR #314](https://github.com/Han-1413141/dsh-cost-meter/pull/314), plus the accounting, ledger merge, statistics cache and settings comparison improvements recorded under v1.9.1, which was not published separately to npm. Ledger format and historical amounts remain unchanged.

- OpenDesign directly queries the Control Key-compatible preflight endpoint and the independent wallet endpoint, reducing a normal query from three GET requests to two. DSH-only model usage accounting does not require installing the OpenDesign application.
- Host-relative custom-balance URLs follow the actual DSH listening port and invalidate cached results when it changes. LAN HTTP requires an explicit opt-in and an exact host/port allowlist.
- A WorkBuddy2API preset reads active account-pool credits through its admin endpoint with an `X-Admin-Token`, separate from model API keys and monetary costs.
- Pages and dialogs retain skin RGB colours with opaque backgrounds. Statistics content uses the popup surface colour to keep text readable when wallpaper and popup colours differ. All 132 browser opacity scenarios pass.
- Automatic-language fallback results are cached with event invalidation and a one-second fallback interval. In five isolated rounds of 2,000 cost reads, median time fell from 1,719.58 ms to 40.19 ms (97.7%). This is not a claim about total DSH CPU usage. The main client is 260,671 bytes, down from 261,676 bytes despite the added features. [Method and raw data](performance-2026-10-18.md)

Full local regression, Windows/Linux installation, host compatibility, browser interaction and CodeQL checks passed for the implementation. Authenticated OpenDesign and WorkBuddy2API paths were tested with synthetic responses rather than live user accounts. Contributor roles and original reports are linked above.

Upgrade using `dsh plugin --profile desktop add dsh-cost-meter@1.9.2`, then fully restart DSH. Use `web` for a web profile and the bundled CLI for Desktop installations.
