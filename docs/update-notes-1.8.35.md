# v1.8.35

## 中文

本版另新增 [DeepSeek Search／Fetch API 次数费](web-request-fees.md#中文)：成功且有结果的请求 ¥0.005／次，保留调用时汇率；本地 HTTP 抓取不增加次数费。模型 Token 费率保持不变，内置搜索免费期不猜测结束日期。


完成 DSH 0.2.1-alpha.5 兼容验证。现有 v1.8.34 的日常计费与界面可直接使用；本版补充兼容性声明和预发布 peer 范围，日常计费、价格和历史金额保持不变。

修复旧会话离线修复命令对新宿主的适配：新宿主不再公开存储类，改用官方插件在空临时目录中加载，只取得其独占锁接口。初始化不扫描、不迁移用户日志，继续保留写入前原样备份、锁冲突拒绝写入和旧宿主支持。

自动回归更新到 alpha.5，覆盖真实安装与 Web 启动、合成计费、RPC 热加载与卸载、原生搜索、上下文校准及发布版 dsh-context 联动。凭据测试分别验证新旧宿主优先级。

[完整验证范围与影响](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.8.35/docs/dsh-alpha5-compatibility.md#中文)。升级后完全退出并重新打开 DSH。

## English

Verifies DSH 0.2.1-alpha.5 compatibility. Daily billing and UI already work in v1.8.34; this release updates compatibility metadata and prerelease peer ranges without changing billing, pricing or historical amounts.

Adapts the offline repair CLI to the new persistence plugin entry. The official backend is mounted in an empty temporary root only to obtain its exclusive lease, keeping user-log scanning and migration out of initialization. Existing backups, active-owner refusal and older-host support remain intact.

Automation covers real installation/startup, synthetic billing, hot RPC loading, native search and published context UI integration. See [verification scope](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.8.35/docs/dsh-alpha5-compatibility.md#english). Fully restart DSH after upgrading.
