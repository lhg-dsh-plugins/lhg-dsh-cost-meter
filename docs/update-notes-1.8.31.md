# v1.8.31

## 中文

接入 [Oct1AtJoe 的 PR #288](https://github.com/Han-1413141/dsh-cost-meter/pull/288)，Antigravity 额度改为优先查询生产端点，daily 和 sandbox 作为备用。另修复备用端点成功后仍解析第一个空响应的问题；生产端点不可用时可以继续显示备用额度，Gemini 筛选规则保留。验证使用模拟网关响应，未查询真实账号。

接入 [UNscientific-9 的 PR #287](https://github.com/Han-1413141/dsh-cost-meter/pull/287)，把价格模型搜索与选择合并为单框。修复已有选择时搜索后回车仍保留旧值，以及末尾已选项未滚入视野的问题；候选列表定位完成后再滚动，搜索词改变时保持高亮项可见。

价格表改用统一的 SVG 展开箭头，随展开状态旋转。OpenRouter 面板重开时立即恢复上次价格、搜索、排序和页码，一分钟内直接复用；过期后保留旧表并后台刷新，失败不清空，关闭重开也不会重复发起进行中的请求。

概览卡片按可见数量等宽排列：今日、本月、累计三张同排；隐藏今日费用后两张平分宽度。窄窗口统一纵向排列，避免“2＋1”留白。

价格设置分为“模型定价”“参考价格表”“同步与规则”。默认打开模型定价，按渠道和模型显示卡片，可搜索已使用的模型，并选择自动匹配、价格表、自定义价格或本地零费用。

模型默认显示单价摘要，点击“设置价格”再展开。自动匹配、价格表、自定义、本地改为四种明确的选择，只显示对应的控件；展开或搜索价格表时不会提交配置，选定条目后才切换。

参考价格表改为厂商分组列表，支持模型搜索和厂商筛选；点开一行才挂载编辑器，输入、缓存读写和输出的顺序统一，窄窗口显示字段标签。

自定义价格以完整宽度显示，输入、缓存读取、输出单价并列，币种单独标明。沿用原有统一与独立倍率操作，下方分项显示乘倍率后的实际单价；更多计费项按需展开。长模型名自动换行，深浅色沿用 DSH 主题，窄窗口自动调整列数。

首屏只渲染 24 个模型，搜索覆盖完整列表，可继续展开其余模型。价格表按厂商展开，同步和历史重算仅在打开相应分区后加载。搜索和切换分区不写入配置。

价格设置的调整沿用既有单价、倍率、计费与历史费用规则。

## English

Antigravity quota lookup now prioritizes the production endpoint, retaining daily and sandbox fallbacks, from Oct1AtJoe’s PR #288. Successful fallback responses are parsed from their actual slot rather than the failed primary slot. Gemini-only filtering remains intact. Tests use synthetic gateway responses without live account requests.

Pricing settings now have three sections: Model pricing, Price tables, and Sync & rules. The default model view uses channel/model cards with a local filter and a clear price-source selector.

Models start with rate summaries and expand on request. Automatic, table, custom and local pricing are explicit source buttons with contextual controls. Preparing a table selection does not save until a specific entry is chosen. Reference tables use searchable, provider-filtered lists with one editor open at a time and consistent field order. Custom-price fields use the full card width. Currency, input, cache and output rates are clearly separated; shared/per-rate multipliers reuse the existing controls, with individual effective-price previews. Long names wrap, narrow layouts adapt, and colors follow DSH theme tokens.

Only 24 model cards render initially. Search covers the full list and more results can be expanded. Catalog groups and sync/history controls mount on demand. Searching and navigating never save configuration. Billing and recorded historical amounts retain their existing behavior.
