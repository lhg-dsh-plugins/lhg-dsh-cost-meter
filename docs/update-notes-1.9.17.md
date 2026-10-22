# v1.9.17

## 中文

- 主页侧栏恢复普通展示，移除六点拖动手柄、额外左侧留白和保存提示；拖动与方向键排序仅保留在“费用 → 显示”的预览中。
- 修复网关卡片拖动遗漏来源 ID 导致排序保存失败的问题；无效排序标识在提交前过滤，保存失败后仍可继续修改组件显示。
- “侧栏布局”默认展开，切换组件时保持用户的展开选择；四种布局缩略图在窄面板中排为两列。
- 合并卡片使用对称内边距和紧凑行高，统一简洁卡片的今日行背景；移除拖动造成的多余空间，三行卡片不再出现内部滚动条。
- `dsh-our-free-model` 免费计费选项改为同一行的开关与文字，说明缩短；仅该插件后续调用记为免费，Token、历史费用与其他渠道规则不变。
- 修复皮肤隐藏更新公告却留下模态锁定的问题：为公告补齐 dialog 语义与显示样式，无法显示时关闭模态，避免锁住整页。感谢 [@SherUnlocked-4869](https://github.com/SherUnlocked-4869) 在 [#355](https://github.com/Han-1413141/dsh-cost-meter/issues/355) 提供复现和定位。
- 纳入 [@LetterXbox](https://github.com/LetterXbox) 在 [PR #358](https://github.com/Han-1413141/dsh-cost-meter/pull/358) 提供的 Ollama Cloud 快照模型日历修复，问题来源 [#356](https://github.com/Han-1413141/dsh-cost-meter/issues/356)。带标签模型仍需已有价格或手动映射，历史金额保留原规则。

更新后完全退出并重启 DSH，使宿主与界面同时加载新版本。原有组件显示开关和已保存顺序继续生效。

## English

- Keep drag and keyboard reordering inside Display settings. The home sidebar no longer adds handles, padding or save-status nodes.
- Preserve gateway source IDs when ordering cards; a failed save no longer blocks subsequent display changes. Sidebar layout choices start expanded.
- Balance combined-card spacing, share the Simple card background with its Today row, and avoid an inner scrollbar for the three-row card.
- Align the free-model checkbox with its label and shorten the explanation without changing billing behavior.
- Keep update guides visible under skin dialog rules and close an invisible modal instead of blocking DSH (#355, reported and diagnosed by @SherUnlocked-4869).
- Include @LetterXbox’s reviewed PR #358: configured Ollama Cloud snapshot models use its own calendar; historical prices are preserved and automatic price matching is unchanged.

Fully quit and restart DSH after updating so the host and UI load the same version. Existing visibility preferences and saved order are retained.
