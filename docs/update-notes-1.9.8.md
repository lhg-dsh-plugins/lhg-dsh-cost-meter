# v1.9.8

## 中文

### 修复 Deep Whale 皮肤下峰谷提醒被遮挡、无法点击

峰谷提醒此前仍是侧栏容器内的普通固定浮层。页面内容可能从上方覆盖它，同时提醒会继承宿主容器的鼠标禁用或窗口拖动属性，造成看似“透过去”、按钮无法点击。

现在峰谷提醒和侧栏引导共用浏览器最上层浮层；提醒明确接收鼠标事件并退出窗口拖动区域，保留不透明主题背景。居中、右下角、窄窗口均可点击“知道了”，关闭不依赖设置保存。弹窗之外的页面保持可操作。

本地加载 `dsh-deep-whale` 实际发布的 Maid Atelier `0.1.8` 与 Orca Link `0.1.8` 前端，覆盖亮色、深色、两种位置和三种窗口宽度，共 16 个组合；另检查真实切换时刻的关闭记忆、触屏、键盘以及页面级事件拦截。持续回归使用可复现容器变换、裁切、透明度和层级的本地样式，不依赖下载第三方包。

### 修复挂件拦截侧栏引导点击

v1.9.7 已解决提示被标题栏和容器遮挡的问题。本轮用实际插件前端组合检查时，进一步复现：鲸鱼挂件使用不透明自定义角色图并与提示按钮重叠时，会在 document 捕获阶段按图像坐标拦截点击，即使提示处于浏览器最上层也会受影响。

费用插件现在只在自己的侧栏引导范围内提前处理鼠标与触屏事件，“关闭”“保留当前显示”“开启简化显示”均可操作。布局选择只保存一次，关闭继续独立于设置保存。引导之外的页面操作、以及从外部开始后释放到引导区域的拖动，继续交给原有处理器。不修改或关闭第三方插件。

### 实际前端组合验证

| 插件 | npm 版本 | 本轮验证 |
| --- | --- | --- |
| Wallpaper Engine | `dsh-plugin-wallpaper-engine@1.3.3` | 实际前端与玻璃样式 |
| 鲸鱼挂件 | `dsh-whale-widget@0.4.2` | 实际前端、鼠标捕获、不透明角色图重叠 |
| Archive Manager | `@michengai/dsh-archive-manager@1.1.2` | 实际前端注册与样式 |
| 可组合记忆 | `dsh-mnemon@0.5.32` | 实际前端注册 |
| Free Search | `dsh-free-search@0.9.5` | 实际前端注册 |
| 插件市场 | `dshmarket@1.66.39` | 实际前端注册 |
| dsh-ops | `dsh-ops@0.3.0` | 无前端入口，检查包声明与宿主代码 |

包从 npm 下载并校验 SHA-512；六个实际前端在隔离 Chrome 页面共同加载，后台接口使用测试数据。测试不运行模型、搜索、记忆服务或命令工具，不读取用户凭据，也不向正在使用的桌面端额外安装这些第三方插件。此表验证的是提示交互兼容，不代表这些插件的全部业务功能或历史版本均已测试。

新增持续回归覆盖页面级鼠标拦截、三个按钮各执行一次、触屏关闭、外部拖动释放及页面其他按钮操作。

更新后完全退出 DSH（包括托盘）再打开。

## English

Fixes peak/off-peak reminders being painted underneath conversation content or losing pointer interaction with Deep Whale skins. Reminders now share the browser top-layer card used by the sidebar guide, explicitly accept pointer input, avoid native window dragging and retain an opaque theme background. Both center and corner positions remain dismissible without a settings save.

The published Maid Atelier 0.1.8 and Orca Link 0.1.8 browser clients were loaded locally across light/dark themes, both positions and three viewport widths (16 combinations). Real-transition dismissal, touch, keyboard and document-capture interception are also covered. CI uses local stacking/clipping fixtures without downloading third-party packages.

Fixes sidebar-guide actions being intercepted by floating widgets. An actual `dsh-whale-widget@0.4.2` client with an opaque custom avatar can consume document-capture events by image coordinates even when the guide is visually above it.

The cost meter now handles events within its own guide before document-level interceptors. Dismissal and both layout choices remain usable, with one settings write per choice. Unrelated page interactions and drags that started outside the guide continue to reach their existing handlers. Third-party plugin code and configuration are unchanged.

The real published browser clients of Wallpaper Engine 1.3.3, Whale Widget 0.4.2, Archive Manager 1.1.2, Mnemon 0.5.32, Free Search 0.9.5 and dshmarket 1.66.39 were loaded together in an isolated Chrome page with fixture backend data. Package integrity was verified. dsh-ops 0.3.0 has no browser client and was inspected statically. This validates guide interaction, not every plugin feature or historical version. No model, search, memory-provider or command-tool calls are made.

Fully quit DSH, including its tray process, and reopen after updating.
