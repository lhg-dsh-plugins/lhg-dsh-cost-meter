# Token Rhythm 余额

## 中文

在 **费用 → 额度 → 添加 Token Rhythm 余额** 中展开卡片，保存网站登录 Cookie，再启用卡片。余额可显示在侧栏、设置页或两处，默认每 15 分钟刷新，也可以手动刷新。

获取 Cookie：

1. 在浏览器登录 [Token Rhythm 账户页](https://tokenrhythm.studio/account)。
2. 打开开发者工具，在“应用 / 存储 → Cookie”中找到 `tr_session`，复制它的值；也可以在“网络”中查看账户请求，复制请求头中的 `Cookie`。
3. 填入插件的 **Token Rhythm Cookie** 输入框并保存。支持裸 `tr_session` 值、`tr_session=值` 或完整 Cookie 请求头；查询时只发送 `tr_session`。

Cookie 保存在 DSH 凭据库，不写入费用配置或账本，也不会回显。已有环境变量 `TOKENRHYTHM_COOKIE` 时可直接使用。出现登录失效提示后，重新登录官网并替换 Cookie。此处使用网站登录凭据，不使用模型 API Key。

显示值与当前官网账户页一致：读取 `GET https://tokenrhythm.studio/api/wallet/summary` 的 `availableBalanceCny`，按人民币显示。冻结金额、累计获赠和历史消费不计入可用余额；接口缺少有效金额时显示错误，真正的零余额正常显示。接口没有预算上限，因此不据此生成使用百分比。

沿用现有余额缓存、并行请求合并和取消机制。反复打开设置不会重查未过期的余额；改换或清除凭据后，旧结果立即失效。该功能仅查询余额，不发起模型调用。

### 来源与验证

- [ykoneee 的 issue #290](https://github.com/Han-1413141/dsh-cost-meter/issues/290) 提出余额显示需求，并提供参考插件。
- [162568316/dsh-tokenrhythm-bill](https://github.com/162568316/dsh-tokenrhythm-bill/tree/d6ee046d083571810fa8fc12030f67b4132841ec) 提供 `tr_session` 认证方式及字段参考；本插件使用现有余额适配器框架独立实现。
- 2026-10-16 核对官网账户页前端版本 `037ffef75d824b1638e65b609018b5054e368f71`，确认账户页已使用 `/wallet/summary` 的 `availableBalanceCny`，因此不再沿用参考插件的旧 `/usage-summary` 查询。
- 官方端点无凭据请求返回 HTTP 401；金额、鉴权、取消、缓存、凭据与设置交互使用模拟响应验证，未查询真实账户。

## English

Open **Cost → Quotas → Add Token Rhythm balance**, expand the card, save your website session cookie and enable the card. Choose the sidebar, settings or both. The default refresh interval is 15 minutes; manual refresh is available.

Sign in at the [official account page](https://tokenrhythm.studio/account). In browser DevTools, copy `tr_session` from Application / Storage → Cookies, or copy the account request's Cookie header from Network. Paste the raw session value, `tr_session=value`, or the full Cookie header into **Token Rhythm Cookie**. Only `tr_session` is sent upstream.

Credentials use the DSH credential store and are never returned to the UI or written to the ledger/configuration. `TOKENRHYTHM_COOKIE` is also supported as an environment fallback. Replace an expired cookie after signing in again. A model API key cannot replace the website session cookie.

The integration reads `availableBalanceCny` from `GET https://tokenrhythm.studio/api/wallet/summary`, matching the current account page's available CNY balance. Frozen funds, lifetime gifts and historical spend are separate. Missing amounts produce an error; valid zero balances remain zero. No usage percentage is invented without a budget limit.

Existing balance caching, request sharing and cancellation are reused. Reopening settings reuses a fresh result. Changing or clearing the credential invalidates the old result. No model calls are made.

Thanks to [ykoneee](https://github.com/ykoneee) for [the request and reference](https://github.com/Han-1413141/dsh-cost-meter/issues/290), and [162568316](https://github.com/162568316/dsh-tokenrhythm-bill/tree/d6ee046d083571810fa8fc12030f67b4132841ec) for the authentication/field reference. The current endpoint and available-balance field were checked against the official frontend on 2026-10-16. Automated checks use synthetic responses; no authenticated live account was tested.
