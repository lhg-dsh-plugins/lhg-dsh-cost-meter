# v1.9.15

## 中文

### 跟随皮肤透明度

在“费用 → 显示”勾选“跟随皮肤透明度”，费用页会共用设置窗口的背景，费用统计正文共用弹窗背景，避免液态玻璃皮肤下出现实心深蓝色块与硬边。费用明细、引导、提醒和下拉浮层保留皮肤色及至少 90% 不透明度，皮肤层色完全透明时也保留可读底色。

开关默认关闭，现有不透明遮挡效果保持原样；修改自动保存，重启后直接生效。只调整插件自己的界面。感谢 [@MuFeng262](https://github.com/MuFeng262) 在 [issue #345](https://github.com/Han-1413141/dsh-cost-meter/issues/345) 报告、定位问题并建议提供可选开关。

### Cline Pass 额度

新增 Cline Pass 套餐查询，一张卡片显示 5 小时、周、月窗口及重置时间。自定义渠道名在前后端使用相同的套餐识别规则；未知或无效额度不会显示为 0%，合法的 0、0.5、1 均保留原始百分比含义。

感谢 [@kongxiangyiren](https://github.com/kongxiangyiren) 在 [PR #343](https://github.com/Han-1413141/dsh-cost-meter/pull/343) 提供实现和回归测试。

更新后完全退出 DSH（包括托盘）再打开。

## English

### Follow skin transparency

Enable “Follow skin transparency” under Cost → Display to share the settings window background and use the dialog background throughout statistics content. This removes solid colour blocks and hard edges under translucent skins. Floating dialogs, guides, alerts and menus use the skin colour with an opacity floor of 90%, including when the skin background is fully transparent.

The option is off by default. Turning it off restores opaque surfaces immediately. Changes save automatically and apply again on startup. Only this plugin's surfaces change. Thanks to [@MuFeng262](https://github.com/MuFeng262) for the report, root-cause analysis and option proposal in [issue #345](https://github.com/Han-1413141/dsh-cost-meter/issues/345).

### Cline Pass quota

A single Cline Pass card shows the actual 5-hour, weekly and monthly windows and reset times. Client and server share plan-name matching rules. Invalid quota values stay unavailable; valid 0, 0.5 and 1 retain their literal percentage meaning.

Thanks to [@kongxiangyiren](https://github.com/kongxiangyiren) for implementation and regression tests in [PR #343](https://github.com/Han-1413141/dsh-cost-meter/pull/343).

Fully exit DSH, including its tray process, and reopen after updating.
