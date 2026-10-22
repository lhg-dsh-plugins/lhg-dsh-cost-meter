# v1.8.27 — Billing update / 计费更新说明（2026-10-15）

## English

Version **1.8.27** includes the following billing updates.

- **Historical prices:** requests use saved price versions selected by their start time. Later edits to rates, price mappings or pricing currency affect subsequent requests. Conversation details, turns and cost charts follow the same versions. Versions not captured before this feature was enabled cannot be reconstructed.
- **Explicit recalculation:** Settings → Cost → Prices → Historical pricing offers **Recalculate history at current prices**. A warning and confirmation precede any change. Fully replayable session/day records can be recalculated; incomplete records keep their amounts. Every run retains before/after amounts, original price versions and a complete ledger backup. The settings show previous runs.
- **Model search:** price-mapping selectors support provider/model keywords, multiple search words and clearing the filter while preserving the selected model.
- **Conversation display:** a pending ledger read or missing record no longer makes the fee line disappear. Narrow composer statistics retain the session amount. Inherited fork history is excluded from duplicate turn charges.
- **billion-context:** a paired compatibility build for `0.1.181+` records internal compression, retries and additional requests across four API protocols. Main/subagent totals, conversation/turn/step details and statistics share those calls and durable deduplication receipts. Matching interfaces are accepted automatically without a version allowlist. Versions 0.1.180 and earlier prompt an upgrade; interface changes show a notice with community-group and issue links. Missing usage, partial responses and missing prices remain explicit.
- **OpenDesign:** 35 provider-scoped model prices include published cache and long-context rates. Workspace quota and wallet queries require the exact workspace ID and a Control Key, not an inference key. Subscription usage defaults to Plan-equivalent cost; wallet-funded usage can be classified as API. Authenticated queries have synthetic coverage; no live account was used.
- **Catalog and plans:** 19 other provider/model price entries were added or updated, cache-write price editing is available, and explicit plan assignment includes Codex/ChatGPT, Volcano Agent Plan, Tencent Coding/Token Plan and Baidu Qianfan Coding Plan.

Validation passed: the full Linux regression (including multi-process ledger locks), Windows Chrome UI checks and Windows regression excluding the known ledger-lock baseline timeout. The Windows timeout was also reproduced on the base code. Verification used local fixtures and made no paid model requests.

See [billing statistics and historical pricing](billing-statistics.md), [billion-context setup](billion-context-billing.md) and [OpenDesign setup](opendesign-billing.md).

## 中文

**1.8.27** 包含以下计费更新。

### 历史费用不再跟着改价变化

请求按发起时间选择已保存的价格版本。修改模型单价、价格映射或价格币种，只影响后续请求；已有价格版本的会话明细、单轮费用和费用图表继续使用原价格。多个调用共用价格版本，避免为每次调用重复保存整张价表。

启用这一功能前没有保存的价格版本无法还原。API／Plan 分类仍由现有计费设置决定，价格版本不代替厂商账单。

### 历史重算由用户主动选择

在 **设置 → 费用 → 价格 → 历史费用**中，新增 **按当前价格重算历史**：

- 先显示影响说明，确认后才执行；取消不会改变费用。
- 只处理日志完整、用量与账本一致的会话日期记录，缺失记录保留原金额。
- 每次保存重算前后的金额、原价格版本，并在账本旁保留完整备份。
- 设置页可以查看重算记录和原金额；再次重算继续追加记录。

### 模型价格选择支持搜索

模型价格映射下拉框可以按模型名、提供商和多个关键词筛选。清空搜索可恢复完整列表，筛选不会改变已选模型。

### 修复会话费用显示与继承历史计费

异步读取账本、缺少当前会话记录或统计栏拥挤时，费用区域保留金额或明确状态。分叉会话的继承轮次不重复收费，单轮与整段会话采用一致的历史边界。

### 接入 billion-context 内部调用

配套的 **billion-context 0.1.181 及更新版本**计费兼容包记录内部压缩、重试和追加请求，支持 OpenAI Chat Completions、Responses、Anthropic Messages、Google GenerateContent 的 JSON 与流式用量。

主会话、子代理、日周统计及单轮／步骤明细共用逐次记录。调用序号随账本保存，防止重启和重复读取后再次计费；已经采集的代理用量替换对应 DSH 用量。旧版代理或写入失败时保留普通记账，未知费用、缺失价格和部分回执明确标出。

接入不再锁定 0.1.197。生成器按实际接口检查，后续版本接口一致时自动生成对应兼容包。检测到 0.1.180 及更早版本时提示升级到 0.1.181 或更新版本；接口变化或兼容桥未连接时显示相应弹窗，提供本项目的交流群与 issue 入口，关闭后同一问题不重复弹出。已用 0.1.181、0.1.185、0.1.190、0.1.196、0.1.197 的实际发布包验证。

兼容包与费用插件配套使用，升级原插件后需要生成并安装对应兼容包。代理与宿主需要共享本地计费文件；启用前缺失的内部记录无法补齐。详见[接入说明](billion-context-billing.md)。

### 新增 OpenDesign 计费与查询

加入 **35 个 OpenDesign 模型**的独立渠道价格，包含已公开的缓存读写和长上下文档位；支持刷新公开价表，保留自定义价格和取消挂载。

在 **设置 → 费用 → 额度 → OpenDesign**中配置工作区 ID 和 **Control Key**，即可使用工作区额度与钱包查询入口。推理 API Key 与控制端查询凭据不同，不能混用；各额度窗口独立显示，不与钱包余额相加。

默认记录套餐调用的 **Plan 等值费用**；钱包付款可显式设为 **API**。标准用量回执不包含逐次扣款来源，因此不会按公开价格猜算实际付款。认证查询已用模拟数据覆盖，尚未使用真实账户验证。需求来源为 @playgithub 的 [#274](https://github.com/Han-1413141/dsh-cost-meter/issues/274)，详见[配置说明](opendesign-billing.md)。

### 其他价格与套餐更新

- 新增或修正另外 **19 条渠道模型价格**，补齐缓存读取、缓存写入及长上下文档位，并保持直连厂商和网关渠道分离。
- 价格编辑支持缓存写入单价，显式零价保留。
- 套餐归属增加 Codex／ChatGPT、火山 Agent Plan、腾讯 Coding Plan、腾讯 Token Plan 和百度千帆 Coding Plan；支持手动选择及明确套餐名称识别。

已通过 Linux 完整回归（含多进程账本锁）、Windows Chrome 界面检查，以及排除既有账本锁超时用例后的 Windows 回归。该 Windows 超时已在原始代码复现。验证使用本地模拟数据，没有调用付费模型。
