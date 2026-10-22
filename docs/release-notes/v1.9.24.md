# v1.9.24

## 中文

- **支持 dsh-connect-workbuddy 积分。** 在“费用 → 额度”启用 WorkBuddy 后，可以读取 `dsh-connect-workbuddy` 国内版、国际版当前已选账号的剩余积分与最近到期时间。继续兼容原 `dsh-workbuddy-connect`，已有用户无需改配置。
- **兼容不同登录状态。** 原连接插件没有可用积分时，继续尝试新插件。新插件国内版未登录或已关闭时，查询国际版；显示单个已选账号的积分，不累加账号池。零积分正常显示，登录拒绝、账号选择失效和查询失败显示对应提示。
- **国际渠道计入套餐。** `workbuddy-global` 与 `workbuddy-ai` 都沿用 WorkBuddy 的 Plan/API 设置。升级启动时修正历史 API 分类，保留原金额、各币种记录、历史价格、Token 与调用数，模型级覆盖仍优先。

凭据解密与登录续期由连接插件处理。费用插件只读取当前 DSH 的本地状态接口，不复制令牌，也不调用模型探测、签到、账号刷新或账号导出接口。更新后完全退出并重启 DSH，再刷新 WorkBuddy 积分。

接口参考：[dingminhua/dsh-connect-workbuddy 4.13.1](https://github.com/dingminhua/dsh-connect-workbuddy/tree/2c1626b8dc46e16561924b76ac6cd86b4272e45d)，以已发布版本的实际 usage 路由验证国内、国际、零积分、到期时间和失败响应；验证使用合成账号与积分，不连接真实账号。

## English

- **Read credits from dsh-connect-workbuddy.** Enable WorkBuddy under Cost → Quota to read the selected CN/global account's remaining credits and nearest expiry. Existing dsh-workbuddy-connect support and configuration remain available.
- **Handle account states.** If the original connector has no usable credits, try the new connector. Fall back to its global region when CN is signed out or disabled. Display one selected account rather than summing its pool; preserve zero balances and report credential, selection and billing failures.
- **Recognize its international Plan route.** Both workbuddy-global and workbuddy-ai follow WorkBuddy Plan/API settings. Correct historical API attribution at startup while preserving recorded amounts, currencies, prices, tokens and calls. Model overrides retain priority.

The connector handles credential decryption and renewal. The cost plugin reads local DSH status routes without copying tokens or invoking model probes, check-ins, account refresh or export. Fully quit and restart DSH after updating, then refresh WorkBuddy credits.

Protocol reference: [dingminhua/dsh-connect-workbuddy 4.13.1](https://github.com/dingminhua/dsh-connect-workbuddy/tree/2c1626b8dc46e16561924b76ac6cd86b4272e45d). Verification executes the published usage route with synthetic accounts and credits, covering CN/global, zero, expiry and failures; no real account is contacted.
