# v1.9.12

## 中文

### 恢复侧边调整，压缩控件高度

“设置 → 费用 → 显示”恢复左侧预览、右侧调整。布局根据设置面板自身宽度适配，桌面端 480、620、900 像素面板保持双栏；手机端和更窄的面板自动换行。放大预览独立计算可用宽度，不再受背后窄设置面板影响。

- “显示此组件”改为紧凑开关行；相关短选项分成两列，较长的说明和下拉框占完整一行。
- 模型明细的统计周期、卡片位置及数字设置成组排列。侧栏布局按需展开，“金额与语言”收在右侧可展开区域。
- 预览画布限制高度并允许内部滚动，避免完整模型明细把整个设置页面撑长。深浅主题和窄窗口均保留组件边界。

### 隐藏组件与内部子项保留淡灰预览

隐藏的组件保留在预览中并显示淡灰背景。选中组件后，其内部关闭的余额进度条、预算明细、Go 其他时段、模型展开内容、Token、费用占比，以及峰谷倒计时或切换时刻也保留淡灰示意。点击侧栏子项可定位右侧对应设置。

简洁布局不显示的内部明细放在带说明的淡灰示例中。当前数据缺失时使用标签或“—”，不填造费用；Codex 只返回周额度时不补造 5h 窗口。示例配置只用于预览，不保存到账本，也不启用账户查询。

输入区补齐真实的最高花费模型摘要，右下角额度按实际界面分成独立胶囊。侧栏模型卡片与输入区模型摘要使用各自的显示开关；输入区只提供实际影响该摘要的统计周期设置。

### 放大预览关闭按钮

关闭按钮使用完整 40 × 40 像素点击区域，小屏为 44 × 44 像素。标题栏避开桌面窗口拖动区域，预览内容滚动时关闭按钮保持可见。测试覆盖四角、中央、按钮外侧以及滚动后的实际鼠标点击。

### 验证

- 已构建客户端的浏览器回归覆盖两种主题、三个区域、三种侧栏布局、窄设置面板、显示开关保存与重新进入、内部滚动与点击定位。
- 4 倍 CPU 限速、宿主页含 20,000 个节点时，25 次重新进入显示设置的 P95 为 33 ms；预览未扫描或复制宿主对话内容，未发起外部请求。
- 余额关闭后重新开启、来源权限隔离、峰谷样式选择、显示控制与模型卡片回归通过；完成独立子代理复查。

更新后完全退出 DSH（包括托盘）再打开。

## English

Display settings restore a side-by-side preview and inspector. Desktop settings panes at 480, 620 and 900 pixels keep both columns; mobile and narrower panes adapt to the available space. Enlarged previews use their own width independently of the underlying settings pane.

The main visibility switch is a compact row. Related short options share two columns, long controls use a full row, and currency/language settings are collapsible in the inspector. A scrollable preview canvas prevents expanded model details from stretching the entire page.

Hidden components and disabled nested details remain visible in light gray. Sidebar child elements can focus their corresponding controls. Simple layouts show unavailable nested details in a labeled gray sample. Missing current data uses labels or an em dash, and weekly-only Codex accounts gain no fabricated 5h window. Preview configuration never changes the ledger or enables account queries.

The composer now previews the real highest-cost model summary and individual quota chips. Sidebar model cards and composer summaries have independent visibility switches, and composer controls only include options that affect its summary.

The enlarged preview has a full 40 × 40 pixel close target, increased to 44 × 44 on small screens. It avoids native drag regions and remains visible while the preview scrolls. Real mouse tests cover the corners, center, outside clicks and scrolling.

Browser regressions cover both themes, all three regions, sidebar layouts, narrow panes, persisted visibility and nested hit regions. Under 4× CPU throttling with 20,000 host nodes, the P95 for 25 settings reopenings was 33 ms, with no external requests or host conversation scans. Balance reopening, source permission isolation, peak style selection and model card checks pass; independent agent review is complete.

Fully quit DSH, including its tray process, and reopen after updating.
