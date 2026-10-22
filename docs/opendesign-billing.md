# OpenDesign billing and quota / 计费与额度

## English

This release addresses [#274](https://github.com/Han-1413141/dsh-cost-meter/issues/274), requested by @playgithub. It adds an OpenDesign price channel and read-only workspace quota queries; it is included in version 1.8.27. It does not install OpenDesign, create an account or change a model route.

The quota query uses the Bearer-only preflight endpoint discovered by @yunjuanhuakai in the [#274 follow-up comments](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566): the plugin directly reads `billing/preflight` with a Control Key. @unifilitence confirmed this behavior and the independent wallet contract in [#313](https://github.com/Han-1413141/dsh-cost-meter/issues/313). @codeforker654's [401 report](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870) documents the original authentication failure.

### Conversation costs

- The offline catalog contains 35 token-priced models checked on **2026-10-15**, from the [official public API](https://amr-api.open-design.ai/api/v1/public/model-prices). Prices are **USD per 1M tokens**, with cache read/write rates and long-context tiers where provided. The long tier applies to the entire request only above its input threshold, including cached input.
- Provider IDs `opendesign`, `open-design`, `open-design-api` and `amr-link.open-design.ai`, including DSH's `llm-` prefix, use this separate catalog. A custom price under the original alias takes priority. Other provider IDs can use the existing explicit price mapping and plan-assignment controls.
- OpenDesign prices never serve as fallback prices for another provider. Unknown OpenDesign models stay unpriced; the plugin does not borrow a direct-vendor price.
- **Settings → Cost → Prices → Sync official prices** also refreshes the public OpenDesign catalog. A used/enabled OpenDesign channel refreshes at startup and hourly. No key or model request is needed. User-edited prices and removed models stay intact. Saved price versions preserve existing details when rates change; recalculation is explicit and retains the original amounts. A historical price version that was never captured cannot be reconstructed.

OpenDesign uses shared subscription allowances and can fall back to its wallet; see its [model-credit rules](https://open-design.ai/model-credits/). Calls default to **Plan-equivalent cost**, which is not a subscription payment or a cash bill. Set wallet-funded calls to **API** in the billing-classification controls, or assign individual models explicitly. DSH's standard usage response does not identify each request's funding source, account-specific discount, image charge or automatic top-up. Those amounts are not invented from the list price or balance movement.

### Quota queries

**DSH-only use:** you do not need to install the OpenDesign app to use its model API in DSH or track conversation costs. Remote quota reads additionally need the workspace ID and Control Key from your OpenDesign Cloud account. An inference API key cannot supply these credentials. If you only have an inference key, leave this quota card disabled; price matching and conversation costs continue to work.

1. Open **Settings → Cost → Quotas**, find **OpenDesign**, and expand its settings.
2. Enter the exact **workspace ID** from your OpenDesign Cloud workspace.
3. Configure a **Control Key** in the credential editor, or supply `OPENDESIGN_CONTROL_KEY` / `VELA_CONTROL_KEY` to the DSH host. An inference key from the Cloud API Keys page is a different credential and cannot be used for this query. The existing OpenDesign/Vela login keeps control credentials in its own profile; the plugin does not read or rewrite that profile automatically.
4. Enable the card and refresh. Select its location to also show it in the sidebar or quota strip.

The credential editor saves to `OPENDESIGN_CONTROL_KEY` in the DSH credential store. Both it and the `VELA_CONTROL_KEY` alias are reflected in the configured/source indicator. Clearing the editor removes the primary stored key; an alias or host environment value can remain active. Legacy OpenDesign config keys also use the existing startup migration. This repairs the missing editor mapping reported and located by @unifilitence in [#317](https://github.com/Han-1413141/dsh-cost-meter/issues/317).

The host issues only these authenticated GET requests to the fixed official HTTPS origin:

```text
https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/billing/preflight            # direct Bearer-only window query
https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/wallet/balance               # wallet, read independently
```

#### Endpoint permissions and 401 troubleshooting

- `/billing/preflight` and `/wallet/balance` run in parallel with `Authorization: Bearer ...` and `x-vela-workspace-id`. The plugin no longer queries the browser-session-only `coding-plan-usage` route. Preflight nests the quota windows under `codingPlan`; both layers' workspace and member identities are validated before unwrapping.
- The wallet endpoint remains an independent query with its `billingScopeVersion: 2` contract. A valid wallet response is authoritative. When it cannot be read, a validated preflight result may display its `balanceUsd` as a fallback, including when no subscription is active. Failure on one side preserves the other; no missing value becomes a fabricated zero. The failing side and reason appear in the settings card, sidebar/strip tooltip and manual-refresh result. A fallback balance is labelled as coming from `billing/preflight`.
- The workspace ID is `items[].workspaceId` from `GET https://amr-api.open-design.ai/api/v1/workspaces`, not `profiles.prod.user.id` from `~/.amr/config.json`.
- For a 401/403, check that the Control Key is current, belongs to the selected workspace and can read that workspace. An inference key or a user ID in the workspace field will not work. If the account rejects preflight too, use the OpenDesign Cloud console to check quota; a readable wallet is still shown separately.

Quota and wallet responses must match the requested workspace. The wallet must identify its member; if the quota response provides a member identity, both must match. A preflight response that omits the redundant outer `workspaceId` is accepted only after the requested workspace has scoped the request; a body naming a different workspace is rejected. Credentials are never forwarded through a redirect and no cookie is attached. They use the existing DSH credential store and are excluded from the ledger and client snapshot.

Each returned allowance window has its own used percentage and reset time. The API's `durationSeconds` identifies the window: `18000` (5 hours) maps to `fiveHour`, and `604800` (7 days) maps to `weekly`, regardless of response order or time remaining until reset. Simultaneous windows are not added together or called unlimited. Wallet credit remains a separate USD-equivalent value, including a real zero. Quota and wallet are fetched independently, so a failure on one side keeps the other side visible; an `eligible: false` / empty-window answer is reported as **no active subscription** instead of a credential failure. Invalid, unauthorized or missing responses never fabricate a zero allowance; when both sides fail, the card shows an error/unavailable state. The workspace setting is kept across restarts and invalidates the previous query when changed.

### Evidence and limits

The public catalog was fetched without authentication; all 35 prices still matched the bundled catalog on 2026-10-18. The credential RPC is covered through save, read, clear, migration, aliases, workspace/key changes during an in-flight read, both wire codecs and ledger redaction. With host dependencies available, the same test also exercises the real DSH local credential provider in an isolated profile. Authenticated HTTP responses remain synthetic, including large credit counts, zero balances, mismatched identities, independent failures, no-subscription fallback balances, and price-refresh persistence. **No live account query or paid model request was made.**

Endpoint provenance: the official Cloud bundles `cloud-root-B21Emo2w.js` and `pricing-refund-policy-BDFJHl33.js` served on 2026-10-15; the [workspace-wallet contract](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/packages/contracts/src/api/collab.ts) and [Vela billing adapter](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/apps/daemon/src/integrations/vela-billing.ts) at the inspected commit. The exact `billing/preflight` shape (`codingPlan`-nested windows, `workspaceMemberId`, `balanceUsd`) comes from @yunjuanhuakai's [#274 comment](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566); the 401 reproduction and attached report come from @codeforker654's [comment](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870). The [official guide](https://open-design.ai/zh/model-credits/) explicitly lists DSH as a supported API client; the issue has a usable integration request. Its short promotional wording alone does not establish advertising or spam.

## 中文

本版本实现了 @playgithub 在 [#274](https://github.com/Han-1413141/dsh-cost-meter/issues/274) 提出的接入需求，随 1.8.27 发布。同时采用 #274 后续评论中 @yunjuanhuakai 发现的纯 Bearer preflight 端点（[评论](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566)），并以 @codeforker654 的 [401 复现报告](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870) 为验证案例。@unifilitence 在 [#313](https://github.com/Han-1413141/dsh-cost-meter/issues/313) 补充了独立钱包契约与本地验证。不会安装 OpenDesign、注册账户或改变模型路由。

### 会话计费

- 从[官方公开价表](https://amr-api.open-design.ai/api/v1/public/model-prices)加入 **35 个模型**，核对日期为 **2026-10-15**。单位为 **美元／百万 Token**，包含已公布的缓存读取、缓存写入和长上下文价格。超过输入阈值后，整次请求使用长档，输入阈值包含缓存输入。
- `opendesign`、`open-design`、`open-design-api`、`amr-link.open-design.ai` 及其 `llm-` 前缀使用独立目录；原渠道中手工配置的价格优先。其他自定义名称可通过既有价格映射和套餐归属入口关联。
- 未收录的 OpenDesign 模型标为未定价，不借用直连厂商价格；其他渠道也不会使用 OpenDesign 价作为兜底。
- **设置 → 费用 → 价格 → 同步官方价格**会同步公开目录。已使用或开启 OpenDesign 时，启动和每小时也会刷新；不需要密钥，不调用模型。自定义价格、取消挂载和已保存价格版本的历史明细保留。历史重算需要主动确认并保留原金额；未保存过的历史价格版本无法还原。

OpenDesign 的 API 与客户端共用套餐，套餐用尽后可以继续扣钱包，详见[官方额度规则](https://open-design.ai/zh/model-credits/)。因此默认计入 **Plan 等值费用**，不把额度当成现金支出。钱包付款可在计费分类中设为 **API**，也可逐模型配置。DSH 的标准用量回执没有逐次扣款来源、账户折扣、图片费用或自动充值金额，这些金额不会通过公开单价或余额变化猜算。

### 额度查询

**只使用 DSH 的情况：**在 DSH 调用 OpenDesign 模型 API、统计会话费用，都不需要安装 OpenDesign 应用。远端额度查询另外需要 OpenDesign Cloud 账户的工作区 ID 和 Control Key，推理 API Key 不能代替。如果只有推理密钥，可以关闭额度卡片，价格匹配和会话计费照常工作。

1. 在 **设置 → 费用 → 额度**找到并展开 **OpenDesign**。
2. 填入 OpenDesign Cloud 中对应的**工作区 ID**。
3. 在凭据编辑器中配置 **Control Key**，或向 DSH 宿主提供 `OPENDESIGN_CONTROL_KEY` / `VELA_CONTROL_KEY`。Cloud API Keys 页生成的推理密钥与查询凭据不同，不能混用。已有 OpenDesign／Vela 登录将控制端凭据保存在其自身配置中，本插件不会自动读取或修改那个配置。
4. 开启并刷新，可选择在侧栏或额度横条显示。

凭据编辑器会把密钥保存到 DSH 凭据库的 `OPENDESIGN_CONTROL_KEY`。该名称与 `VELA_CONTROL_KEY` 别名都会反映到“已配置／来源”状态。清除只移除编辑器保存的首选密钥；别名或宿主环境变量仍可能生效。旧配置中的 OpenDesign 密钥也会参与既有的启动迁移。这修复了 @unifilitence 在 [#317](https://github.com/Han-1413141/dsh-cost-meter/issues/317) 报告并定位的凭据映射遗漏。

查询只访问以下固定官方 HTTPS GET 端点，并在凭据／工作区校验之后才发起：

```text
https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/billing/preflight            # 直接使用纯 Bearer 查询窗口
https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/wallet/balance               # 钱包端点，独立读取
```

#### 端点权限与 401 排查

- `/billing/preflight` 和 `/wallet/balance` 使用 `Authorization: Bearer ...` 与 `x-vela-workspace-id` 并行读取，不再请求需要浏览器会话的 `coding-plan-usage`。preflight 把窗口放在 `codingPlan` 内；解析前会核对内外两层工作区和成员身份。
- 钱包保留独立查询，按 `billingScopeVersion: 2` 契约校验。成功读取的钱包金额优先；钱包不可读时，经校验的 preflight 响应可提供 `balanceUsd` 作为余额，包括没有生效套餐的情况。一侧失败保留另一侧，缺失数据不会变成零。设置卡片、侧栏／横条提示和手动刷新结果都会显示失败的一侧与原因；备用余额会注明来自 `billing/preflight`。
- 工作区 ID 来自 `GET https://amr-api.open-design.ai/api/v1/workspaces` 的 `items[].workspaceId`，不能填 `~/.amr/config.json` 中的 `profiles.prod.user.id`。
- 遇到 401／403，检查 Control Key 是否有效、是否属于所填工作区、是否有读取权限。推理 API Key 不能代替 Control Key，用户 ID 不能代替工作区 ID。如果该账户连 preflight 也拒绝，可在 OpenDesign Cloud 控制台查看额度；可读的钱包仍单独显示。

查询只访问上文列出的固定官方 HTTPS GET 端点；核对工作区，钱包必须提供成员身份，额度响应提供成员身份时再核对二者一致。preflight 响应省略外层冗余 `workspaceId` 时，在已由请求范围校验工作区的前提下仍接受；若响应指向不同工作区则拒绝。凭据由 DSH 凭据库管理，不回显、不写入账本，不跟随重定向，也不附带浏览器 Cookie。

所有实际返回的窗口分别显示已用百分比和重置时间，不相加、不标成无限。钱包作为独立的美元等值额度显示，真实零余额保留。额度与钱包独立查询：一侧失败时另一侧仍照常显示；`eligible: false`／空窗口回执会明确报告为**无生效订阅**，不再与凭据失效混为一谈。认证失败、缺失回执或身份不匹配不显示虚构的零额度，两侧都失败时才显示错误／不可用状态。工作区配置跨重启保留，改变后清理原查询缓存。

2026-10-18 直接读取官方公开价表，35 个模型的价格与内置目录一致。凭据 RPC 验证覆盖保存、读取、清除、迁移、别名、查询期间切换工作区／密钥、双端 codec 和账本脱敏；具备宿主依赖时，同一测试还会在隔离配置中使用真实 DSH 本地凭据库。认证 HTTP 响应使用模拟数据，覆盖大整数、零余额、串工作区／成员、单侧失败、无订阅时保留备用余额、价格持久化等情况。**没有真实 OpenDesign 账户查询，没有调用付费模型。**

本次还核对了官方 [preflight 类型契约](https://github.com/nexu-io/open-design/blob/78d5637cb49da07e81314d1544b5fc6d37c95084/packages/contracts/src/api/collab.ts)与 [Vela 解析器](https://github.com/nexu-io/open-design/blob/78d5637cb49da07e81314d1544b5fc6d37c95084/apps/daemon/src/integrations/vela-billing.ts)，检查工作区、成员、窗口和钱包字段。

端点来源：官方 Cloud bundle `cloud-root-B21Emo2w.js` 与 `pricing-refund-policy-BDFJHl33.js`（2026-10-15 读取）；[工作区钱包契约](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/packages/contracts/src/api/collab.ts)与 [Vela 计费适配器](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/apps/daemon/src/integrations/vela-billing.ts)（上述 commit）。`billing/preflight` 的准确回执形状（`codingPlan` 内嵌窗口、`workspaceMemberId`、`balanceUsd`）来自 @yunjuanhuakai 的 [#274 评论](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566)；401 复现与附件来自 @codeforker654 的 [评论](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870)。官方明确支持 DSH，说明这条 issue 有可执行的接入需求；仅凭“便宜、可能流行”的一句话，不能认定为广告。

### 1.9.20 窗口对应修正

按用户报告及明确要求，对调 OpenDesign 的 5 小时和周额度结果。使用量百分比与重置时间始终取自同一条回执，设置、侧栏和额度横条共用映射；不改动其他平台。回归使用两项不同额度的模拟响应，覆盖正反回执顺序、凭据查询和单侧降级；本次未进行真实 OpenDesign 账号查询。
