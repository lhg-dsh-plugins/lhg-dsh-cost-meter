# v1.9.9

## 中文

### OpenCode Go 凭据读取与 401 提示

感谢 [@weimingyu9312](https://github.com/weimingyu9312) 在 [#325](https://github.com/Han-1413141/dsh-cost-meter/issues/325) 报告 Tauri 桌面环境刷新 Go 额度返回 401。

- 单独保存 Key：在 **设置 → 费用 → 额度 → OpenCode Go** 展开配置，编辑凭据并保存，再点击刷新。复制了 `Bearer Key` 时只保留一层 Bearer 认证头；整段请求头、内部空白等无效输入会在本地提示修正。
- 自动读取：继续按照专用引用、官方 Go 模型路由引用、兼容环境变量、OpenCode 登录态、遗留配置的顺序读取。新增识别 `OPENCODE_AUTH_CONTENT` 和 `XDG_DATA_HOME/opencode/auth.json`，当前有效登录数据优先于旧文件；显式数据目录的登录文件缺失或损坏时不再回退旧目录，退出登录后也不再复活旧文件中的 Key。
- 401 明确提示当前 Key 未通过认证，不再认定没有订阅。只有 403 且官方响应类型为 `EntitlementError` 时，才提示该 Key 所属工作区没有 Go 权限；其他访问拒绝单独显示。
- 认证失败按照刷新间隔缓存，避免重复请求。手动刷新、保存或清除专用凭据可立即重试；不会在认证失败后偷偷换成另一个账号的 Key。
- 费用插件保存和清除只操作自己的 `OPENCODE_GO_API_KEY`，不修改模型路由共用凭据。请求固定发送到官方额度 GET 接口，不发模型请求；空窗口不会被当作 0% 用量。

另外在与报告一致的 DSH `0.2.0-rc.2` 内核中，使用真实 Cordis Loader、凭据库和 Typert RPC 验证保存、清除、刷新、401 后恢复及环境／目录自动读取，全部通过；该集成测试已加入 CI 的 `0.2.0-rc.2` 与 `0.2.1-rc.2` 两个宿主。

本地测试覆盖单独保存和自动读取两种流程，以及轮换、清除、环境登录态覆盖、数据目录、401/403、缓存、恢复与脱敏。测试使用隔离凭据和官方响应结构，不代表已经取得报告者在其 Tauri 环境的复测结果；原 issue 保留等待该环境确认。

依据：[OpenCode 登录态读取源码](https://github.com/anomalyco/opencode/blob/fc7e4cf93e660ad5ddabb0c48ecc99e934ebfe95/packages/opencode/src/auth/index.ts)、[数据目录源码](https://github.com/anomalyco/opencode/blob/fc7e4cf93e660ad5ddabb0c48ecc99e934ebfe95/packages/core/src/global.ts)、[官方 Go 文档](https://opencode.ai/docs/go/)。

更新后完全退出 DSH（包括托盘）再打开。

## English

Thanks to [@weimingyu9312](https://github.com/weimingyu9312) for reporting an HTTP 401 when refreshing Go quotas in a Tauri desktop environment in [#325](https://github.com/Han-1413141/dsh-cost-meter/issues/325).

- Both dedicated keys and automatic discovery are covered. A pasted Bearer prefix no longer creates a duplicate authorization prefix; invalid full headers are rejected locally.
- Automatic discovery now reads `OPENCODE_AUTH_CONTENT` and `XDG_DATA_HOME/opencode/auth.json`. Current sign-in data takes precedence over older files, including an empty login set after logout. An explicit data directory never falls back to an older directory when its login file is missing or corrupt. Existing dedicated-key and official model-route priority is preserved.
- HTTP 401 is reported as failed authentication, not a missing subscription. Only an explicit 403 `EntitlementError` is classified as missing Go workspace entitlement; other access-control failures have a separate message.
- Authentication failures respect the refresh interval. Manual refresh and saving or clearing a dedicated credential can retry immediately. A failed credential does not silently switch the query to another account.
- Shared model credentials remain unchanged. Queries use the fixed official GET endpoint, make no inference calls and do not turn missing usage windows into zero usage.

An actual DSH 0.2.0-rc.2 kernel also passes the real Cordis loader, local credential store and Typert RPC save/clear/refresh, 401 recovery and env/XDG discovery checks. CI runs the integration test on both 0.2.0-rc.2 and 0.2.1-rc.2.

Local service tests cover both credential flows, rotation, clearing, auth overrides, paths, 401/403 classification, caching, recovery and redaction with isolated credentials. The reporter's Tauri environment has not yet been retested, so the original issue remains open for confirmation.

Fully quit DSH, including its tray process, and reopen after updating.
