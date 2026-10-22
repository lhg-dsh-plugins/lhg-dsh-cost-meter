# v1.8.28 — Original billion-context support / 原版 billion-context 自动接入

## English

- Connects directly to original billion-context **0.1.181+**, without a companion package or changes to its installed files. Later versions with compatible request interfaces are accepted automatically.
- Versions **0.1.180 and earlier** prompt for an update. Changed required interfaces produce a feedback notice linking to the existing community group and GitHub issues; repeated notices for the same version and reason can be dismissed.
- Installs metering before loading the cost UI and price catalogs, covering parallel plugin startup. Preserves metering when the cost plugin reloads while its already-connected local proxy stays running.
- Confirms completed upstream usage at the response boundary, without waiting for billion-context's later conversation-save work. Pending upstream calls still need to finish before the receipt is complete.
- Retries transient Windows file-sharing errors when saving completion receipts, preserving already-collected usage without charging it twice.
- Retains compression, retries, subagent attribution, deduplication and historical pricing from 1.8.27. OpenDesign support is already available in 1.8.27; [issue #274](https://github.com/Han-1413141/dsh-cost-meter/issues/274), reported by **@playgithub**, is closed.

**After updating, fully restart DSH and its local billion-context proxy.** No new installation step is needed when a compatible original billion-context version is updated. [Setup and coverage](billion-context-billing.md#english).

## 中文

- 直接接入 **0.1.181 及更新版本的原版 billion-context**，无需配套兼容包，不修改原版插件文件。后续版本保持相关请求接口时自动兼容。
- **0.1.180 及更早版本**提示升级。必需接口变化时弹窗，提供项目已有的交流群和 GitHub issue 入口；同一版本、同一原因的提醒关闭后不重复出现。
- 在加载费用界面和价格目录前安装计费接入，支持两个插件同时启动。费用插件重载时，已接入且仍在运行的本地代理继续计费。
- 响应完成后确认已经落盘的用量，不再等待 billion-context 后续保存会话。尚未结束的上游调用仍需完成后才能确认完整回执。
- 修复 Windows 进程读取回执期间短暂拒绝替换文件的问题，重试保存完成状态，保留已采集用量并防止重复计费。
- 保留 1.8.27 的压缩、重试、子代理归属、去重和历史价格功能。OpenDesign 已在 1.8.27 发布，**@playgithub** 提出的 [#274](https://github.com/Han-1413141/dsh-cost-meter/issues/274) 已关闭。

**更新后完全重启 DSH 及其本地 billion-context 代理。**以后升级接口兼容的原版 billion-context，无需额外安装。详见[接入范围和使用方法](billion-context-billing.md#中文)。
