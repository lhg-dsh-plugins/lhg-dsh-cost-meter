# Ledger lock recovery / 账本锁恢复

## English

Issue [#237](https://github.com/Han-1413141/dsh-cost-meter/issues/237) reports a startup failure with **Ledger is busy; preserving pending changes for retry**. The sidebar balance and quota widgets disappear because the cost-meter loader entry did not activate. An old lock can name a PID that now belongs to a different process; checking only whether that PID exists cannot identify the original owner.

### Update and recover

1. Update `dsh-cost-meter` in the affected Profile. Web users can run `dsh plugin --profile web add dsh-cost-meter`. Desktop users must use the application's own CLI and the `desktop` Profile; see the [Desktop guide](install-troubleshooting.md#desktop-安装与更新).
2. Restart that DSH host. For Desktop, fully exit the application including its tray process, then reopen it. The upgraded plugin recovers a proven stale lock before loading its ledger.
3. Confirm that the host logs contain `[dsh-cost-meter] 已加载` and that the Cost page and sidebar widgets return. Existing ledger amounts and history remain intact; this recovery does not reprice usage.

A previously failed loader entry is not necessarily retried when an unrelated configuration file changes. Restarting the affected host applies the installed fix; adding a dummy `balance.refreshMinutes` override is unnecessary. This plugin does not change DSH's loader/HMR retry policy.

### What changes

- Owner filenames retain their original `PID-UUID` format. The owner file now records process identity: Linux uses the boot ID, PID namespace and process start ticks; Windows uses the native process creation time.
- A lock is recovered when its process has exited, or when a comparable native identity confirms PID reuse. Linux locks with identity records from another host or PID namespace are not treated as local owners.
- Earlier versions wrote empty owner files. These are recovered only when the file predates the identified process's start, with a two-second margin for timestamp precision. The current process also has an uptime-based fallback. A lock is not expired just because it is old.
- Unknown ownership, inaccessible process information and incomplete owner writes remain locked. A genuine competing writer retains its lock. Only the identified owner file and empty lock directory are removed; the ledger is preserved.

If a genuine writer still holds the lock, let its operation finish and restart the failed host entry. For persistent failures, attach the plugin and DSH versions, other installed plugins, the sanitized startup error, and lock directory filenames/timestamps. Do not include the ledger contents or credentials. Do not delete `ledger.json` to restore the widgets.

Implementation references: [Linux process start ticks](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html), [Windows process StartTime](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.starttime).

## 简体中文

Issue [#237](https://github.com/Han-1413141/dsh-cost-meter/issues/237) 报告启动时出现 **Ledger is busy; preserving pending changes for retry**。费用插件未成功挂载，侧栏余额和额度卡片随之消失。旧锁中的 PID 可能已经被系统分配给另一个进程，仅检查 PID 是否存在不能确认原锁持有者。

### 升级与恢复

1. 更新受影响 Profile 中的 `dsh-cost-meter`。Web 用户可执行 `dsh plugin --profile web add dsh-cost-meter`。桌面端使用应用自带 CLI 和 `desktop` Profile，见 [Desktop 安装说明](install-troubleshooting.md#desktop-安装与更新)。
2. 重启该 DSH 宿主。桌面端完全退出应用（包括托盘）后重新打开。新版插件会在读取账本前回收已确认失效的锁。
3. 确认日志出现 `[dsh-cost-meter] 已加载`，费用页和侧栏卡片恢复。已有金额和历史记录保留，此过程不重新定价。

已经失败的加载器条目不一定会因无关配置文件变化而重试。重启受影响宿主即可加载已安装修复，无需添加临时 `balance.refreshMinutes` 配置。本插件不修改 DSH 加载器的热重载重试策略。

### 修复规则

- 锁文件名继续使用原有 `PID-UUID` 格式，文件内容增加进程身份。Linux 保存系统启动 ID、PID 命名空间和进程启动计数；Windows 保存操作系统提供的进程创建时间。
- 进程已经退出，或原生启动身份能确认 PID 被复用时，回收旧锁。对于有身份记录的 Linux 锁，不会把其他主机或 PID 命名空间中的持有者误当成本机进程。
- 兼容旧版空锁文件。只有文件早于对应进程启动时间，并留出两秒精度余量时，才认定失效；当前进程还可用运行时长推算启动时间。锁的存放时间长短不是独立回收依据。
- 身份不明、进程信息不可读取或文件未写完整时，保留锁。真实并发写入者继续持锁。恢复只删除已确认的锁持有者文件和空锁目录，保留账本。

如果是真实写入进程占锁，等待其操作结束后重启加载失败的宿主。持续失败时，请附插件和 DSH 版本、其他已安装插件、脱敏启动错误，以及锁目录中文件的名称和时间。不要附账本内容或凭据，也不要通过删除 `ledger.json` 恢复卡片。
