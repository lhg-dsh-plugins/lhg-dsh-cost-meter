# OpenRouter model prices / 模型价格

## English

Open the model picker beside the message input and hover an **OpenRouter** model. Its existing DSH tooltip shows input, output, cache-read and cache-write prices, context length and the last successful update time. Prices load when model rows appear and refresh every minute while the menu and browser are visible; hovering or returning to the foreground also checks for an update, subject to a 15-second cooldown. Closing the menu stops price requests. No settings visit is required.

The tooltip matches the host provider and exact model ID, keeping paid and `:free` variants separate. Models missing from the public catalog show an unavailable message; ambiguous host labels are left unchanged. Failed refreshes retain the previous prices and timestamp with a failure notice. The tooltip keeps DSH's native appearance and model selection behavior and follows the plugin language. Unloading the plugin restores the original tooltip.

Open **Settings → Cost → Prices → OpenRouter model prices** before choosing a model. Search by name or full model ID (for example, `flash`), sort by input or output price, and follow a model link to its OpenRouter page.

The panel shows public input, output, cache-read and cache-write prices in **USD per million tokens**, plus context length. `$0` is a published zero rate; `—` means that the catalog did not provide the field. Paid models and `:free` variants are separate rows. Automatic routing entries with negative placeholder prices are omitted.

The panel immediately restores the previous catalog, search, sort order and page when reopened in the same DSH session. A snapshot checked less than a minute ago does not trigger another request. Older snapshots stay visible while a background refresh runs; closing and reopening during a request shares that request. While the panel and browser are visible, it refreshes every minute; returning to the foreground also refreshes. **Refresh prices** requests an update immediately, with a shared 15-second cache to limit duplicate requests across windows. The timestamp shows the last successful fetch. A failed request preserves the previous prices and timestamp and displays an error. **Price changed** marks token-rate changes since the previous successful refresh while this panel is open.

This lookup only sends an unauthenticated `GET` to [OpenRouter's public models endpoint](https://openrouter.ai/api/v1/models). It requires no API key, sends no model inference requests and incurs no model usage charges. Browsing does not change configured billing rates, credentials or the historical ledger. The existing background billing-price synchronization remains separate.

The catalog is a reference, not a binding quote for the next request. Provider routing, price tiers, promotions and additional image/search/request fees can affect the actual bill. Open the model's official page for those details. The UI uses the existing DSH theme variables and controls, supports Chinese and English, and requires the host's asynchronous module loader (also used by Cost statistics).

## 中文

打开输入框旁的模型选择菜单，悬停 **OpenRouter** 模型，DSH 原有提示中会显示输入、输出、缓存读取和缓存写入单价、上下文长度以及最近成功更新时间。模型列表出现时查询价格，菜单与浏览器处于前台时每分钟刷新；悬停模型或返回前台也会检查更新，两次请求至少间隔 15 秒。关闭菜单后停止价格请求，无需先进入设置。

提示根据宿主提供商和完整模型 ID 匹配，付费模型与 `:free` 版本分别取价。公开目录中没有的模型明确显示价格不可用；宿主名称有歧义时保留原提示。刷新失败时保留旧价格和时间，并标记失败。提示沿用 DSH 原生外观和模型选择行为，跟随插件语言，卸载插件后恢复原提示。

选择模型前，打开 **设置 → 费用 → 价格 → OpenRouter 模型价格**。可以按模型名或完整模型 ID 搜索，例如 `flash`，按输入价或输出价排序，并点击模型名称查看 OpenRouter 官方页面。

面板显示输入、输出、缓存读取和缓存写入价格，单位为 **美元 / 百万 tokens**，同时列出上下文长度。`$0` 表示目录中的价格为零，`—` 表示目录没有提供该字段。付费模型与 `:free` 版本分别列出；负数占位价格的自动路由条目不显示。

在同一 DSH 会话中重新打开面板时，立即恢复上次价格、搜索词、排序和页码。一分钟内检查过的目录直接复用；超过一分钟时先显示旧表，再后台刷新。刷新期间关闭重开也共用同一次请求。面板与浏览器处于前台时每分钟刷新一次，返回前台时也会刷新。点击 **刷新价格** 可立即请求更新；多个窗口共享 15 秒缓存，避免重复请求。更新时间始终对应最近一次成功查询。查询失败时保留旧价格和原时间，并显示错误。面板打开期间，相比上次成功刷新发生变化的 token 单价标记为 **价格已变动**。

查询仅对 [OpenRouter 公开模型接口](https://openrouter.ai/api/v1/models) 发送不带凭据的 `GET` 请求，无需 API Key，不发送模型推理请求，不产生模型使用费用。浏览价格不会修改计费单价配置、凭据或历史账本。原有后台计费价格同步继续独立运行。

目录价格是参考价，具体路由、价格阶梯、优惠以及图片、搜索、请求等附加费用以 OpenRouter 为准，可点击模型查看详情。界面沿用 DSH 主题变量和控件，支持中英文；需要宿主支持异步模块加载，与费用统计页要求一致。
