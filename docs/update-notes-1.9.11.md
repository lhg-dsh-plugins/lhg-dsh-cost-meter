# v1.9.11

## 中文

### 显示设置统一

在“设置 → 费用 → 显示”中选择组件后，右侧固定显示“显示此组件”开关。侧栏、输入区和会话内容使用相同顺序：选择组件、开关、组件选项。移除预览上方重复的预算、今日用量、峰谷时段和模型花费勾选项；详细选项的开关也统一靠右。

显示位置只选择侧栏、设置页等位置，关闭由组件开关控制。隐藏侧栏额度保留设置页查询和凭据；切换显示不启用未配置的额度查询。输入区从关闭状态单独开启一项时，不再顺带显示其他额度条。侧栏布局放在组件选项下方，可展开切换简洁、标准和紧凑样式；窄窗口自动改为上下排列。

### 侧栏金额与官方 Flash 名称

- 今日费用和模型花费收起摘要的金额、模型数靠右显示，标准、紧凑和简洁布局均保持标签与数值分开。
- 官方提供商的 `deepseek-flash`、`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`deepseek-v4.1-flash` 统一显示为 **DeepSeek V4.1 Flash**，涵盖本轮费用、原生搜索、逐次调用、模型排行和费用图表。原始调用 ID、价格匹配和历史金额保留，逐次调用悬停仍可查看原始 ID。
- 只归一化官方提供商名称，第三方提供商的模型名称保持原样。模型依据：[DeepSeek 官方模型与定价说明](https://api-docs.deepseek.com/quick_start/pricing/)。

### 两个上游兼容监控 issue

针对 GitHub Actions 机器人生成的 [#329](https://github.com/Han-1413141/dsh-cost-meter/issues/329) 和 [#330](https://github.com/Han-1413141/dsh-cost-meter/issues/330)，执行实际 npm 发布包的兼容回归后更新监控基线。两版均能使用现有接入，不需要用户安装额外兼容包。

- **billion-context 0.1.201**：验证新版 `forceDirect` 绕过自定义传输后仍只记录一次费用；原生回退先恢复请求内容，无法恢复而在本地拒绝的请求不生成计费回执。原有压缩、重试、子代理、四种协议和重启去重继续验证。CI 增加 0.1.201，保留旧版覆盖。
- **dsh-codex-subscription 3.1.1**：使用发布包中的额度解析器、RPC 处理器、传输注册和真实 DSH 请求格式，验证周额度、5h＋周额度、刷新、重置时间、未登录和异常数据回退。仅返回周额度的账户不补造 5h。

上述兼容及界面测试使用本地合成数据，不读取真实账户凭据、不请求模型，也不产生模型费用。监控继续检查三个插件，未来接口变化仍会创建或更新 issue。

更新后完全退出 DSH（包括托盘）再打开。

## English

Display settings now provide the same right-hand **Show this component** switch for every sidebar, composer and conversation component. Redundant checkboxes above the preview are removed, boolean options align to the right, and placement is separate from visibility. Sidebar layout choices expand below component options; narrow windows stack the preview and controls. Enabling one item from a disabled composer strip preserves the visibility of its siblings.

Today amounts and collapsed model-cost summaries align to the right in all sidebar layouts. Official Flash aliases display as **DeepSeek V4.1 Flash** throughout turn details, native search, calls, rankings and charts. Recorded identifiers, historical prices and amounts stay intact; individual-call tooltips retain the raw identifier. Third-party model names stay unchanged. See the [official DeepSeek documentation](https://api-docs.deepseek.com/quick_start/pricing/).

Published-package regressions resolve the GitHub Actions compatibility reports [#329](https://github.com/Han-1413141/dsh-cost-meter/issues/329) and [#330](https://github.com/Han-1413141/dsh-cost-meter/issues/330):

- **billion-context 0.1.201**: the new direct transport path remains metered exactly once; native fallback restores the body before sending, and locally refused requests create no billable receipt. Existing retry, compaction, subagent, protocol and restart checks remain covered.
- **dsh-codex-subscription 3.1.1**: actual published quota parsing and RPC code works with weekly-only and dual-window responses, manual refresh, reset times and failure fallback. Weekly-only accounts gain no fabricated 5h window.

Both releases work with the existing automatic integration. No companion installation is required. Monitoring baselines and CI package coverage are updated after these checks. Tests use local synthetic data without account credentials or model requests.

Fully quit DSH, including its tray process, and reopen after updating.
