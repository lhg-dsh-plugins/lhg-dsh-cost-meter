# v1.9.18 更新说明

## 中文

### WorkBuddy 加密登录与积分查询

积分查询优先读取当前 DSH 中 `dsh-workbuddy-connect` 的本地状态接口，由连接插件处理 WorkBuddy 的加密登录文件。无需复制令牌或生成明文文件。未安装连接插件时，保留旧版明文登录文件兼容；提示会说明需要安装并启用匹配 DSH 内核的连接插件。

同一条刷新错误只显示一次。已用 WorkBuddy 5.6.2、dsh-workbuddy-connect 0.7.9 和真实加密登录文件验证积分查询，费用插件显示值与连接插件上游查询一致。

### 更新公告不再锁住整页

合并卡片与峰谷进度条介绍改为非模态窗口，补齐 `role="dialog"`。即使皮肤把公告隐藏，宿主仍能点击与滚动；打开时不可见的公告会关闭，不写入“已读”记录。关闭按钮、Escape 和样式选择继续有效。

感谢 [@SherUnlocked-4869](https://github.com/SherUnlocked-4869) 在 [issue #355](https://github.com/Han-1413141/dsh-cost-meter/issues/355) 提供环境、A/B 复现与隐藏模态窗口的定位。测试加载了 dsh-claude-style 0.16.3 的实际插件代码，并还原报告中的 `display:none` 模态状态；单独加载该皮肤时未自动触发隐藏，不能据此断言其他插件组合已全部复现。

### Ollama Cloud 快照模型计价

支持 `deepseek-v4.1-flash:1017`、`deepseek-v4-pro:0813` 及其可识别的连续后缀。自动匹配和显式价格映射均使用 Ollama Cloud 工作日 12:00–18:00 UTC 的峰价日历。精确条目、手动覆盖、本地模型及免费／在线变体保持各自规则。

已有账单保存原匹配规则，加载、回放和重启不会自动改价。需要修正旧账单时，在“价格”中对相应模型执行历史重算；重算保留调用时的汇率。

感谢 [@LetterXbox](https://github.com/LetterXbox) 在 [issue #356](https://github.com/Han-1413141/dsh-cost-meter/issues/356) 提供两个快照模型的复现、归一化原因定位和历史账单保护要求，并在 [PR #358](https://github.com/Han-1413141/dsh-cost-meter/pull/358) 实现日历修复、历史时间线恢复及升级回归测试。本版本在此基础上扩展自动匹配，保留幸存的策略切换时间。

### 今日消费与余额同行

在“费用 → 显示 → 侧栏”增加独立开关“今日消费与余额同行”。沿用现有布局，开启时默认显示费用，Token 可在今日组件设置中开启。今日消费与余额保留各自悬停详情；余额进度条继续显示，隐藏官方余额时可与自定义余额同行。排序在显示设置预览中调整。

感谢 [@zhuwnq](https://github.com/zhuwnq) 在 [issue #359](https://github.com/Han-1413141/dsh-cost-meter/issues/359) 提出同一行显示、保留悬停详情及进度条的需求。

## English

- WorkBuddy credits now use the connector's local status endpoint, including encrypted desktop logins. No token copying or plaintext export is required. Duplicate refresh errors are removed.
- Update introductions use non-modal dialogs with an explicit dialog role. Hidden notices no longer make the host inert; notices hidden at opening close without being marked as read.
- Ollama Cloud snapshot tags use the correct weekday 12:00–18:00 UTC peak calendar in host billing and browser projections, including explicit price aliases. Existing bills retain their saved matching policy until an explicit per-model recalculation, which preserves the original exchange rates.
- Scenario validation includes a real encrypted WorkBuddy login, the actual Claude skin 0.16.3 bundle plus the reported hidden-modal state, and synthetic ledgers produced by unmodified 1.9.16 code.

- A separate Today and balance on one line switch works with existing sidebar styles, retaining tooltip details, balance progress and custom balances.
