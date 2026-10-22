# v1.9.26

## 中文

### OpenDesign 额度窗口

修复 OpenDesign 的 5 小时与每周额度显示颠倒的问题。接口返回的窗口按 `durationSeconds` 识别：18,000 秒对应 5h，604,800 秒对应每周；使用比例和重置时间始终来自同一条记录，不依赖接口返回顺序。

例如，原先显示为“每周剩余 91%，当晚重置”和“5h 剩余 94%，下周重置”的数据，更新后会正确显示为“5h 剩余 91%，当晚重置”和“每周剩余 94%，下周重置”。侧栏、设置页、输入区额度条及悬浮说明同步生效。

补充了截图数据、中英文、已用/剩余方向、正反返回顺序和嵌套响应的回归测试，并验证 DSH 宿主的凭据查询流程。上游响应使用测试数据，未查询真实 OpenDesign 账号。

### 更新

在插件市场更新，或运行：

```powershell
dsh plugin --profile web add dsh-cost-meter@1.9.26
```

更新后完全退出并重启 DSH，再点击 OpenDesign 卡片刷新额度。

## English

### OpenDesign quota windows

Fix reversed 5-hour and weekly OpenDesign quotas. Each API window is identified by `durationSeconds`: 18,000 seconds means 5 hours, and 604,800 seconds means one week. Its usage percentage and reset time stay together, regardless of response order.

For example, data previously shown as “weekly: 91% remaining, resets tonight” and “5h: 94% remaining, resets next week” now appears under the correct 5h and weekly labels. The correction applies to the sidebar, settings, composer quota strip and tooltips.

Regression tests cover the reported values, both response orders, nested responses, Chinese and English, and used/remaining display directions. DSH credential queries were exercised with synthetic upstream responses; no live OpenDesign account was queried.

Update through the plugin market or run the command above. Fully exit and restart DSH, then click the OpenDesign card to refresh its quota.
