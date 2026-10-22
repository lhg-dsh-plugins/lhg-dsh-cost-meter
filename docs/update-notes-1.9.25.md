# v1.9.25

## 中文

### WorkBuddy 多账号积分统计

在 **设置 → 费用 → 额度 → WorkBuddy 积分** 中展开卡片，选择“当前账号（各区域）”“全部账号”或“勾选账号”。国内与国际账号分别列出，显示余额，以及今日、近 7 天和启用以来观测到的积分减少。

- 对接 `dsh-connect-workbuddy` 的独立 `account-credits` 接口，不再依赖复杂的 usage 页面完整返回。宿主内的读取直连当前 DSH 回环端口，避免全局网络代理影响本地查询。
- 保留 `dsh-workbuddy-connect` 和旧版单账号接口；一个接口失败会继续尝试其他可用接口。旧接口没有多账号数据时明确提示，不把单账号余额冒充全部账号余额。
- 第一次成功读取建立统计起点。充值、赠送导致的余额增加不计入减少；积分到期、两次读取之间的充值和消耗会影响结果。**观测减少不是官方逐笔扣费账单，积分不折算为人民币。**
- 查询失败显示未知，部分区域失败时不显示完整总额。每个账号分别保存统计，不因切换筛选而清空；本地只保存账号标识、余额和每日变化，不保存账号名称或登录凭据。
- 多账号接口只返回积分余额，没有积分包到期时间，因此多账号卡片不显示到期日期；旧单账号接口有到期信息时仍显示。
- 卡片同时显示全部 WorkBuddy 调用的今日、累计 API 等值费用。DSH 调用记录没有账号标识，因此这项不随账号筛选，也不把等值金额当作实际现金支出。

核对了 `dsh-connect-workbuddy@4.14.1` 实际发布包的只读接口，测试使用合成账号；没有读取、解密或导出真实登录凭据，也没有发起模型探测、签到或账号切换。

### 设置保存与引导弹窗

- 修复旧配置缺少新增字段导致整份设置无法保存的问题。补齐缺失设置，同时保留显式非法值校验、已有价格和历史金额。
- 前端遇到升级后仍在运行的旧宿主时，不再凭空添加 `sidebarOrder`、`sidebarSummaryPromptSeen` 后提交给旧接口；合并卡片和其他显示设置可独立保存。更新后仍建议完全退出并重启 DSH，让前后端都加载同一版本。
- 峰谷进度和合并侧栏引导挂到页面顶层，保留非模态行为。解决被侧栏层级限制、被会话区遮住而无法点击的问题；宿主页面继续可操作。
- 套餐设置按需加载，主界面代码减少约 7 KB，为新增界面留出空间。
- 本轮费用、费用分项和逐次调用金额遵循“小数位数”设置，不再强制显示至少 8 位；单价保留核算精度，修改显示精度不会重算账本。

微小金额仍保留必要精度，避免把搜索等实际费用显示成零。

感谢：[@picklerick422](https://github.com/picklerick422) 在 [#371](https://github.com/Han-1413141/dsh-cost-meter/issues/371) 提供弹窗层级定位与 Portal 建议；[@hua0424](https://github.com/hua0424) 在 [#372](https://github.com/Han-1413141/dsh-cost-meter/issues/372) 报告升级后的未知配置项和显示开关问题；[@paperclip476-sys](https://github.com/paperclip476-sys) 在 [#373](https://github.com/Han-1413141/dsh-cost-meter/issues/373) 提供旧配置的最小复现和默认值补齐建议。

感谢 [@mzjqwq](https://github.com/mzjqwq) 在 [#374](https://github.com/Han-1413141/dsh-cost-meter/issues/374) 报告会话金额不遵循小数位数设置的问题。

## English

### WorkBuddy account statistics

Expand **Settings → Cost → Quota → WorkBuddy** and choose current accounts per region, all accounts, or individual accounts. The card shows balances and observed credit decreases today, over the last seven days, and since recording began.

The integration reads dsh-connect-workbuddy's dedicated account-credits routes through the running DSH loopback port, independently of the host's global fetch proxy. Original dsh-workbuddy-connect and legacy single-account routes remain supported. Missing account data stays unknown; partial regions never appear as a complete total.

Recording starts with the first successful observation. Grants are not counted as decreases, but credit expiry and activity between observations affect the result. **These observations are not official transaction charges and are not converted to currency.** Per-account history survives selection changes and stores no names or credentials. The card also shows API-equivalent values for all WorkBuddy calls; those values cannot be filtered by account because DSH call records do not identify the account used.

The multi-account endpoint provides balances without package expiry dates. Expiry remains available only when supplied by a legacy single-account endpoint.

The published dsh-connect-workbuddy 4.14.1 routes were exercised with synthetic accounts. No real credentials, model probes, check-ins or account switching were used.

### Settings and notices

Fill missing settings before validating legacy configurations, without accepting explicit invalid values or repopulating historical prices. Avoid sending unsupported sidebar keys to older running hosts. Mount both update notices directly under the document body so the sidebar stacking context cannot trap them behind the composer, while keeping the host interactive. Load subscription settings on demand to reduce the main client bundle.

Fully exit and restart DSH after updating so both client and host load the same version. Reporter credits and original reports are linked above.

Turn totals, cost breakdowns and individual call amounts now follow the decimal-place setting instead of forcing at least eight places. Unit prices retain calculation precision; changing display precision does not recalculate the ledger.

Tiny charges retain extra precision so small search costs do not appear as zero.
