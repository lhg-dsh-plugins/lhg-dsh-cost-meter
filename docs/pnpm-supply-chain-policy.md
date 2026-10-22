# pnpm 供应链策略与插件安装/卸载失败

本文说明 DSH 0.2.1-rc.x 宿主内置 pnpm 的「最低发布年龄」（`minimumReleaseAge`）策略，以及它导致的本插件安装/卸载失败如何识别、绕行和上报。插件本身的计价、账本与 RPC 逻辑不受影响。

## 适用范围

- 宿主：DeepSeek Harness **0.2.1-rc.1 / 0.2.1-rc.2**（Desktop 与 npm CLI 均使用自带的 pnpm **11.28.5**）。
- 相关设置：pnpm 11 默认启用内置的 **24 小时** `minimumReleaseAge`；发布不足 24 小时的包进入解析图时会产生「解析策略违规」（resolution-policy violation）。
- 插件侧：`dsh-cost-meter` 的依赖已精确锁定或交给宿主提供；本文描述的问题与插件代码无关，任何刚发布的包（包括刚发布的插件版本或宿主自身的 `0.2.1-rc.x` 包）都可能触发。

## 常见报错

| 日志关键字 | 出现阶段 | 含义 |
| --- | --- | --- |
| `✓ Lockfile passes supply-chain policies (verified 28m ago)` | pnpm 启动 | lockfile 校验命中了缓存结论；**不是**成功安装的保证，解析阶段仍可能产生新违规。 |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | 安装 / 卸载的 lockfile 校验 | lockfile 中某个条目发布不足 24 小时，被策略拒绝；错误里会给出包名和发布时间。 |
| `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED` | 卸载（`pnpm remove`）的依赖解析 | pnpm 解析出违规项，但宿主没有接上处理回调，抛出内部错误。DSH 插件页通常显示为「卸载失败」，并附带 `Progress: resolved 1, reused 0, ...`。这是**宿主内置 pnpm 的缺陷**，插件无法修补。 |
| `[timed out]`（dsh-plugin-hub 安装器） | 安装器等待阶段 | 与 #250 同族的市场安装器超时；pnpm 已输出 `Done`，需要结合 `pnpm.log` 判断失败点，见下文。 |

插件页只显示 pnpm 输出的前几行；完整原因在 Profile 的 `.plugin-manager/logs/operation-*/pnpm.log`。

## 推荐处理顺序

### 1. 等待 24 小时后再试（最省事）

刚发布的插件版本或宿主包超过 24 小时后即成为「成熟版本」，安装、升级、卸载都会恢复正常。升级到新版本后如果卸载失败，可先保留插件（不影响使用），24 小时后再重试卸载。

### 2. 在 Profile 的 `pnpm-workspace.yaml` 中精确排除该版本

宿主在安装时也会自动写入 `minimumReleaseAgeExclude`（日志里可见 `Added N entries to minimumReleaseAgeExclude`）。你可以手动补一条**精确到版本**的排除项，再重试安装/卸载：

- Windows：`%USERPROFILE%\.dsh\profiles\<profile>\pnpm-workspace.yaml`
- macOS / Linux：`~/.dsh/profiles/<profile>/pnpm-workspace.yaml`

```yaml
minimumReleaseAgeExclude:
  # 保留宿主已经写入的其他条目
  - dsh-cost-meter@1.9.0
```

只影响列出的 `名称@版本`；不要删除文件里已有的其他排除项。修改后完全退出并重新打开 DSH，再在插件页重试。

### 3. 用 CLI 把 pnpm 策略参数传给这一次操作

`dsh plugin` 会把剩余参数原样转交 pnpm，因此可以只对本次操作跳过年龄门禁（确认包来源可信时使用）：

```powershell
# 卸载
dsh plugin --profile desktop remove dsh-cost-meter --config.minimum-release-age=0

# 安装 / 升级
dsh plugin --profile desktop add dsh-cost-meter@1.9.0 --config.minimum-release-age=0
```

如果是 lockfile 校验阶段失败（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`），也可以加 `--trust-lockfile` 跳过校验并重试。以上两个参数已在本机 pnpm 11.28.5 的临时 Profile 上实测可用。

### 4. 读取日志并确认失败点

1. 打开插件页/终端给出的 `.plugin-manager/logs/operation-*/pnpm.log`；Web 与 Desktop 分别对应 `$DSH_HOME/profiles/web/` 与 `$DSH_HOME/profiles/desktop/`。
2. 找到第一条 `ERR_PNPM_*`、`npm error` 或 Git 错误，保留前后几行，以及 DSH、Node、pnpm 版本。
3. 分享前删除 Cookie、Authorization、API Key、令牌和带凭据的 URL；不要贴 `.credentials.yaml`。

### 不要做的事

- 不要删除 Profile 目录或账本；失败操作不会损坏账本数据。
- 不要反复重装同一版本：每次重装都会再次解析同一批包，告警不会消失。
- 不要把问题归因于插件计价逻辑：本文错误全部来自宿主 pnpm 的安装/解析阶段，插件尚未加载。

## 上游状态

- DSH 0.2.1-rc.x 自带 pnpm 11.28.5；`pnpm remove` 在产生解析策略违规时未接回调属于宿主内置 pnpm 的行为。
- DSH 上游仓库当前限制外部 PR 创建，插件维护者无法直接补丁；插件侧能做的是提供本文档绕行方案并在发布说明中提示。
- 如果 DSH 后续版本升级内置 pnpm 或修复该回调，安装/卸载失败会自行消失；届时本文档保留作为历史排查参考。

## 相关 issue

- [#250](https://github.com/Han-1413141/dsh-cost-meter/issues/250)：dsh-plugin-hub 安装器 `[timed out]` 与同类 supply-chain 日志。
- 新版本 DSH 卸载失败截图：属于本文 `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED` 场景。

## English

This page explains the pnpm `minimumReleaseAge` (supply-chain) policy shipped inside DSH 0.2.1-rc.x and how it affects installing, upgrading and uninstalling this plugin. Billing, ledger and RPC logic are unaffected.

- **Scope** — DSH 0.2.1-rc.1 / 0.2.1-rc.2 bundle pnpm **11.28.5**, which enables a built-in **24-hour** `minimumReleaseAge`. Packages published less than 24 hours ago can produce a resolution-policy violation.
- **Symptoms** — the plugin page reports uninstall/install failure with lines such as `✓ Lockfile passes supply-chain policies (verified 28m ago)`, then `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` (lockfile verification) or `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED` (dependency resolution during `pnpm remove`). The unhandled-callback case is a defect of the host's bundled pnpm; the plugin cannot patch it.
- **Workarounds** — (1) wait until the package/version is 24 hours old, then retry; (2) add an exact `minimumReleaseAgeExclude` entry (`- dsh-cost-meter@1.9.0`) to the profile's `pnpm-workspace.yaml` (`%USERPROFILE%\.dsh\profiles\<profile>\pnpm-workspace.yaml` on Windows, `~/.dsh/profiles/<profile>/pnpm-workspace.yaml` elsewhere), keep existing entries, restart DSH and retry; (3) forward pnpm flags for one operation via the CLI, for example `dsh plugin --profile desktop remove dsh-cost-meter --config.minimum-release-age=0` (or `--trust-lockfile` when only lockfile verification fails). Both flags were verified against pnpm 11.28.5 in a temporary profile.
- **Diagnostics** — read the first `ERR_PNPM_*` line in `<profile>/.plugin-manager/logs/operation-*/pnpm.log`; remove credentials before sharing. Do not delete the profile or the ledger.
- **Upstream** — DSH's repository restricts external pull requests, so this cannot be patched from the plugin side; the workarounds above are the supported mitigation until a DSH release updates the bundled pnpm. See also issue [#250](https://github.com/Han-1413141/dsh-cost-meter/issues/250).
