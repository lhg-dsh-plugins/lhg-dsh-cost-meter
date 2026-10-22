# v1.9.10

## 中文

### 费用明细首次打开提速

同一次费用计算中，重复使用模型价格匹配和 Plan/API 分类结果；每次调用只解析一次汇率。缓存只在本次计算内存在，遇到不同的历史价格表、覆盖配置或匹配方式会重新查价，不跨请求复用旧金额。

使用真实费用按钮、按需加载的统计客户端和真实后端计算，在 Windows 本机顺序对比修改前后：

| 条件／结果 | 修改前 | 修改后 |
| --- | --- | --- |
| 调用记录 | 4,800 次，主会话与两层嵌套子代理 | 相同 |
| 缓存与预加载 | 冷缓存，无悬停预加载 | 相同 |
| 浏览器 CPU | 4 倍限速 | 相同 |
| 弹窗打开 | 67 ms | 66 ms |
| 实际费用、调用数、Token 与缓存命中率显示 | 4,533 ms | 835 ms |
| 费用合计 | $2.79144 | $2.79144 |

1 秒检查同时覆盖弹窗和真实数字，不以加载动画代替完成。该场景已加入浏览器 CI；这是上述数据规模和本机环境的测量结果。更大记录量、较慢磁盘或远程宿主的完成时间仍取决于实际环境。

### 午夜黑皮肤的两处控件

感谢 [@transmerger](https://github.com/transmerger) 在 [#258 的最新反馈](https://github.com/Han-1413141/dsh-cost-meter/issues/258#issuecomment-6259570677) 提供“今日”按钮和显示设置下拉菜单截图。

- 模型花费的选中按钮使用主题正文色和淡色背景，未悬停时也能辨认，不再让文字与蓝色选中背景接近。
- 费用插件的原生下拉选项明确使用不透明主题背景和主题文字，允许原生菜单适应系统深浅色；解除浅色宿主对深色皮肤下拉菜单的配色限制。
- 浏览器回归加载 [Dream Skin 午夜黑的固定版本颜色定义](https://github.com/RevolutionLA/dsh-dream-skin/blob/3829506d17901609f8e558587f40a37d90d4219a/lib/client.js)，覆盖浅色宿主与深色系统组合、全部组件选项、实际侧栏按钮和其他插件控件隔离；原有浅色、深色、窄屏与交互检查继续保留。

### Windows 账本锁启动优化与版本兼容

感谢 [@Oct1AtJoe](https://github.com/Oct1AtJoe) 在 [PR #327](https://github.com/Han-1413141/dsh-cost-meter/pull/327) 定位同步 PowerShell 启动造成的阻塞，并提供原始优化实现。

- 无锁竞争时，Windows 直接使用 Node 启动时固定的毫秒时间写入锁身份，不启动 PowerShell。仅在确实需要判断旧版原生锁或其他进程身份时查询原生启动时间，并缓存查询结果。
- 修正第一处兼容问题：毫秒锁身份使用 v2 元数据，与旧版 ticks 身份区分。旧版遇到仍活跃的新版持有者时继续等待，不会误删锁后同时写账本。
- 修正第二处兼容问题：比较前将 Windows ticks 换算成毫秒，能够识别 PID 已被其他进程复用的旧锁，不再因为单位不同一律拒绝回收。仅当旧启动时间明确早于当前进程且超过两秒误差范围时回收；原生 ticks 之间仍精确比较。
- 未知版本、损坏或未写完的身份、无法读取原生身份等情况，不会仅因锁文件较旧而删除活动锁。保留空文件旧锁、死亡进程和 Linux 原生身份的既有处理。
- 此次仅调整锁元数据，账本数据格式和历史金额不变，不触发费用重算。

验证覆盖冻结的 v1.9.9 锁读写器与当前实现、真实 Windows 新旧持有进程和竞争进程、仍活跃但文件时间较旧的锁、文件时间较新的 PID 复用旧锁、当前 PID 的原生身份、死亡进程回收，以及启动零 PowerShell 调用和查询失败。

启动时间依据：[Node.js `performance.timeOrigin`](https://nodejs.org/api/perf_hooks.html#performancetimeorigin)。

更新后完全退出 DSH（包括托盘）再打开。

## English

Conversation details now reuse model-price resolution and Plan/API classification within one calculation, and resolve FX once per call. Historical catalog and override identities remain separate; no old amounts are reused across requests.

In a Windows cold-click browser comparison with 4,800 calls, two nested subagent levels, no hover warming and 4× browser CPU throttling, real totals painted in **835 ms**, down from **4,533 ms**. The dialog opened in 66 ms. Both runs retained all 4,800 calls and the same $2.79144 total. CI checks the one-second budget for both the dialog and real metrics; larger data sets and remote or slower hosts remain environment-dependent.

Midnight skin fixes make the selected Today model-cost button readable without hover and give native display-setting options opaque theme colors, without changing unrelated plugin controls. Thanks to [@transmerger](https://github.com/transmerger) for the [latest #258 screenshots](https://github.com/Han-1413141/dsh-cost-meter/issues/258#issuecomment-6259570677).

Thanks to [@Oct1AtJoe](https://github.com/Oct1AtJoe) for identifying blocking PowerShell startup and contributing the original optimization in [PR #327](https://github.com/Han-1413141/dsh-cost-meter/pull/327).

- Uncontended Windows ledger writes use Node's fixed startup origin without launching PowerShell. Native identities are queried lazily for older native locks or other processes and cached.
- Millisecond identities use v2 lock metadata. Older readers preserve live new locks instead of confusing milliseconds with native ticks and allowing concurrent writers.
- Native ticks are normalized before comparison with milliseconds, allowing recovery after PID reuse. Estimated times must be more than two seconds earlier than the current birth; native-to-native comparisons retain exact precision.
- Unknown or incomplete identities and failed OS queries preserve live locks. Existing empty-file, dead-process and Linux handling remain supported.
- Ledger data formats and historical amounts stay unchanged; no repricing is triggered.

Regression coverage includes frozen v1.9.9 readers/writers, actual Windows old/new process exclusion, live locks with old file times, reused PIDs with recent file times, native self identities, dead holders, failed probes and zero PowerShell calls on normal owner creation.

Fully quit DSH, including its tray process, and reopen after updating.
