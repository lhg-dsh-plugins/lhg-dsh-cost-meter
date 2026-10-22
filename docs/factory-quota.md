# Factory（Droid）订阅额度

在「设置 → 费用 → 额度」启用 **Factory (Droid)**。展开卡片后可设置额度类型、组织 ID、显示位置和刷新间隔。

- **Standard**：默认显示 5 小时、每周、每月三个已用百分比及重置时间。
- **Droid Core**：显示独立 Core 额度，同样包含三个窗口。
- **Standard + Core**：分别显示两套额度。输入框上方横条分为两个标签，各含三个窗口；点击任一标签刷新该账号额度。

## 凭据与组织

点击卡片中的「编辑凭据」，填写有权读取该账号额度的 Factory Bearer 凭据，保存到 DSH 凭据库的 `FACTORY_API_KEY`。也可由 DSH 进程读取同名环境变量。无须另加自定义 ref；凭据库命名与 `dsh-factory-provider` 的默认 `keyEnv` 一致。

`dsh-factory-provider` 自己账号库中选中的 key 不会自动复制到 DSH 凭据库。使用其账号时，需在本卡片存入对应凭据；组织 ID 可从该账号信息填写，未填写时不发送组织请求头。凭据失效或无权读取额度时显示认证提示，推理凭据是否可查额度由 Factory 接口决定。

凭据只写入 DSH 凭据库，既不回显也不保存到费用账本。关闭来源或将显示位置改为「关闭」即停止查询；组织、额度类型或凭据变化会清空旧缓存并取消旧请求。

## 查询与显示

只读 `GET https://api.factory.ai/api/billing/limits`，使用 `Authorization: Bearer …`、`x-client-version: 0.231.0`、`x-factory-client: cli` 和可选 `x-factory-org-id`。固定官方域名，拒绝重定向；15 秒单次请求超时，沿用网络重试和有界 JSON 读取。自动查询按卡片设置的 1–1440 分钟间隔缓存，默认 15 分钟；手动刷新立即查询。

`usedPercent` 已是 0–100 百分比，不乘以 100。优先使用 `windowEnd`，缺少有效绝对时间时使用 `secondsRemaining`；无重置字段时仍显示用量。缺失／无效窗口省略，不补造 0%；选择 Standard 时不偷偷回退到 Core。

账户百分比与 DSH 的调用记录分别统计。Factory 的 `factory-a`、`factory-g`、`factory-o` 归为同一套餐提供商；启用后可按既有 Plan／API 设置分类。由于本地记录无法逐次归属到 Standard／Core 池及其滚动周期，Factory 不生成每 1%／满窗 Token 与费用估算。

来源：[Factory 个人计划](https://docs.factory.ai/pricing/individuals)、[核验的提供商查询源码](https://github.com/Dalizi2026/dsh-factory-provider/blob/801c3a2be1927e804ad9e0e493c52e9aa13421df/lib/quota.js)。回归使用响应夹具与模拟网络，验证 DSH 服务、双端 codec、缓存、取消、落盘与真实 Chromium 界面；未使用真实付费账号验证。

## English

Enable **Factory (Droid)** under Settings → Cost → Quotas. Choose Standard (default), Droid Core, or both. Each pool has independent 5-hour, weekly and monthly windows. The sidebar shows all selected windows; the composer quota strip uses separate Standard/Core chips with three windows each. Either chip refreshes the Factory source.

Save a Factory Bearer credential with access to billing limits through the card's credential editor. It uses DSH's `FACTORY_API_KEY` credential ref or the same host environment variable. Keys selected in the provider plugin's private account store are not copied automatically. An optional organization ID scopes the request. Credentials are never echoed or stored in the ledger.

The adapter sends only a fixed read-only GET to the official billing-limits endpoint, rejects redirects, bounds response size and request time, and reuses the configured refresh cache. Disabling the source stops queries; credential, organization or pool changes cancel old work. Percentages are already on a 0–100 scale; reset time prefers `windowEnd`, then `secondsRemaining`. Missing windows remain absent. Account quota data does not become recorded DSH usage or a per-1% cost estimate without pool attribution. Tests use synthetic account data and network mocks plus real Chromium; no live paid account was queried.
