# v1.9.22

## 中文

- **修复 WorkBuddy 国际版计费分类。** `workbuddy-ai` 现在沿用 WorkBuddy 套餐设置。启用 WorkBuddy 积分查询或显式选择 Plan 后，国际版调用的等值金额不再计入 API 支出，侧栏、每日统计和会话明细使用一致的分类。
- **自动修正历史 API 金额。** 升级后的启动阶段执行一次修正，覆盖每日、单会话和模型明细。原金额、各币种记录、历史价格、Token 与调用数保持不变；已有 provider/model 明细的账本无需会话日志也能修正。
- **显式渠道配置可正常生效。** 自定义渠道可按原始 provider 名指定 plan/api，不再因缺少内置套餐别名而被忽略。模型级覆盖仍优先，手动指定 API 的调用继续计入 API 支出，DeepSeek 官方搜索和抓取请求费也继续归 API。
- **减少费用明细首次打开的等待。** 优先计算并显示包含子代理的完整金额和调用数，再加载步骤图表；收起的逐次调用列表在展开时渲染。

更新后完全退出并重启 DSH。历史修正按现有分类设置执行，无需逐个模型重新配置。Plan 等值金额仍可显示，它用于比较模型用量，不代表 WorkBuddy 实际扣除的积分，免费模型也可以有非零等值金额。

感谢 [@pcs801](https://github.com/pcs801) 在 [issue #364](https://github.com/Han-1413141/dsh-cost-meter/issues/364) 提供复现数据、原因定位和修复建议。代码见 [PR #366](https://github.com/Han-1413141/dsh-cost-meter/pull/366)。

## English

- **Fix WorkBuddy international billing classification.** `workbuddy-ai` now follows the WorkBuddy Plan settings. When WorkBuddy credits querying is enabled or its classification is explicitly Plan, international calls no longer count toward API spend. Sidebar, daily and session statistics use the same classification.
- **Correct historical API totals automatically.** A one-time startup correction updates daily, session and model attribution while preserving recorded amounts in each currency, prices, tokens and call counts. Existing provider/model ledger details are sufficient even when session logs are unavailable.
- **Honor explicit provider classifications.** Custom routes can use their exact request provider name to select plan/api without a built-in Plan alias. Model overrides still take priority. Explicit API choices and official DeepSeek search/fetch request fees remain API charges.
- **Reduce the wait when opening session costs.** Calculate and display complete totals, including subagents, before loading step charts. Render the individual-call list when expanded.

Fully quit and restart DSH after updating. The historical correction follows existing classification settings; individual model overrides are not required. Plan equivalents compare model usage rather than credits actually charged by WorkBuddy, so a free model can still have a nonzero equivalent amount.

Thanks to [@pcs801](https://github.com/pcs801) for the reproduction data, root-cause analysis and proposed fixes in [issue #364](https://github.com/Han-1413141/dsh-cost-meter/issues/364). Implemented in [PR #366](https://github.com/Han-1413141/dsh-cost-meter/pull/366).
