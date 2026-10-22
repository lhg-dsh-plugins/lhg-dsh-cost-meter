# v1.9.7

## 中文

修复“试试更轻巧的侧栏”提示无法关闭的问题。

- 提示位置跟随 DSH 的窗口浮层位置，关闭按钮完整避开桌面端标题栏的拖动区域。窄窗口、全屏、macOS 标题栏和网页端分别按实际可用空间定位。
- 引导改用浏览器的非模态浮层，保持页面其他操作可用，避免皮肤或布局插件的容器变换、裁切和普通高层级覆盖。背景保留皮肤色调并保持不透明，卡片明确接收鼠标事件且不作为窗口拖动区。
- 同一页面因插件布局重复挂载提示时，一次关闭同步隐藏所有实例。关闭标记保留在本机，不改变用户的简化显示选择；设置保存失败或卡住时仍可关闭，本地存储不可用时当前提示也立即消失。
- 不支持浏览器浮层 API 时回退到固定位置显示；关闭仍可操作。

本地使用已构建客户端和真实 Chrome，覆盖深色、浅色、半透明皮肤，以及 Windows 普通／窄窗口、macOS 标题栏、全屏、手机宽度网页共 15 组显示与点击场景。测试包含变换／裁切／禁用鼠标事件的插件容器、普通高层级覆盖、重复挂载、保存失败与等待、刷新、Escape 和旧 API 回退。上述插件场景使用隔离夹具模拟，未逐个运行第三方插件；测试无外部请求和模型调用。

安装更新后，完全退出 DSH（包括托盘）再打开。

## English

Fixes dismissal of the “A lighter sidebar” introduction.

The guide follows DSH window overlay positioning so the complete close button stays below native titlebars. A non-modal browser popover escapes transformed or clipped plugin containers and ordinary stacking contexts while keeping the page interactive. Theme colors remain intact with an opaque background and explicit pointer handling.

Dismissing one of several duplicated slot instances closes all of them. Dismissal never waits for settings saves and remains available during failed or pending saves. Local storage remembers dismissal without changing the user's layout selection; unavailable storage still allows the current guide to close. Browsers without the popover API retain a fixed-position fallback.

A real Chrome regression exercises the built client across three synthetic skins and five window configurations, including obstructing plugin containers, duplicated slots, click targets, reloads, offline/pending saves, Escape and API fallback. Plugin layouts are simulated fixtures rather than full third-party plugin installations. No external or model requests are made.

Fully quit DSH, including its tray process, and reopen after installing this update.
