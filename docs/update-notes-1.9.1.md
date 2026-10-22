# v1.9.1

## 中文

本版本修复皮肤类插件把主题别名（`--dsw-alias-bg-*`）调成半透明后，插件浮层与弹窗透出后方页面内容的问题；同时对记账、账本落盘合并、统计缓存与设置页自动保存路径做了可度量的性能优化。**无配置或账本格式变化，升级后无需手动迁移。**

### 皮肤半透明时浮层与弹窗不再透出后方内容

皮肤插件把 `--dsw-alias-bg-base` / `--dsw-alias-bg-layer-1` / `--dsw-alias-bg-layer-2` 设成 `rgba(...)` 时，插件里直接使用这些别名的容器会整体变透明，导致弹窗内部左右两栏、浮层与后方页面互相透出，文字不可读。

本版本把「遮挡面」（必须遮住下方内容的浮层/弹窗）统一改为**本地不透明基底 + 皮肤色渐变叠层**合成：

- `background-color` 使用不透明本地基底：浅色主题 `#fff`，深色主题（`body[data-ds-dark-theme]` / `html[data-theme=dark]`）`#151517`；
- `background-image` 用皮肤别名色做一层渐变，保留皮肤的色调与明暗观感；
- 默认主题或不透明皮肤下合成结果与原视觉完全一致；半透明皮肤下不再透出后方内容。

覆盖的遮挡面：

- 主包：统计明细弹窗（`.cm-stat-dialog`）、额度引导（`.cm-qguide`）、峰谷提醒（`.cm-peak-alert`）、精简侧栏底栏（`.cm-footer-stack.simple`）；
- 统计页：费用明细弹窗（`dialog.cm-fee-dialog`）、上下文费用开关引导（`.cm-context-intro`）、billion-context 提示（`.cm-billion-notice`）；
- 定价页：模型/价格组合浮层（`.cm-combo-panel`）；
- Codex 兼容弹窗复用统计弹窗样式，自动获得同样的不透明合成。

新增静态 fixture `test/skin-occlusion-static.mjs`（源码规则 + 构建产物标记双重断言），并在真实浏览器回归里模拟 Dream Skin（半透明 `--dsw-alias-bg-base` 与半透明 `--dsw-alias-bg-layer-2`），断言弹窗底色不透明且渐变里保留皮肤色。

### 记账性能：价格历史快照改为落盘时推进

此前每一笔用量入账都会重建整张价格历史快照（835 个模型，约 2.18ms 名称整理 + 0.66ms 哈希 + JSON 比较），占单笔记账耗时（1.3–2.3ms）的 99.8%。现在改为在落盘合并的锁内一次性推进价格历史，单笔记账不再触发重建。

- 1000 笔连续记账：1308ms → 93ms；
- 短窗口（1 / 5 / 20 / 50 笔）：42.4 / 46.4 / 64.5 / 102.9ms → 36.5 / 34.5 / 36.5 / 39.1ms（约 -26% / -43% / -62%）。

价格变更仍由配置写入路径记录，历史价格查询与重算结果不变。

### 落盘合并与渲染缓存优化

- 账本落盘合并（`mergeLedger`）不再无条件做 3 次全账本深拷贝：本地快照是自有对象时跳过克隆、磁盘快照与基线相同时直接复用，待提交记录仍逐条重放。普通 flush 由约 40ms 降到约 30ms，合并后的内存/磁盘账本内容与语义哈希（`30f37c10373d0a50`）和原实现完全一致。
- 统计页渲染缓存键改用 `pricesRev`，不再每帧序列化整张价格表（178KB，2.55ms → 0.015ms，约 170 倍）；旧宿主没有 `pricesRev` 时回退原来的整体序列化。
- 设置页自动保存的逐键差异比较增加引用短路：未变化的配置项直接跳过，不再对每个键序列化比较。

### 验证

- `node test/verify.mjs`：全部断言通过（含新增皮肤遮挡静态断言）。
- 真实浏览器回归：`test/statistics-dialog-titlebar.mjs`（229 条断言，含皮肤与窄屏几何）、`test/session-costs-browser.mjs`（含 Dream Skin 不透明合成断言）通过。
- 全部测试使用本地账本与合成数据，不发起真实模型请求、不消耗订阅额度。

### 升级方式

```powershell
dsh plugin --profile desktop add dsh-cost-meter@1.9.1
```

重启 DSH 后生效（web Profile 把 `desktop` 换成 `web`）。或重新运行一键安装脚本：`irm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/v1.9.1/install.ps1 | iex`。

## English

This release fixes translucent skin plugins leaking page content through plugin overlays and dialogs, and ships measured performance improvements for accounting, ledger flushes, statistics caching and settings auto-save. **No configuration or ledger schema changes; no manual migration is required.**

### Overlays and dialogs stay opaque with translucent skins

When a skin plugin sets `--dsw-alias-bg-base` / `--dsw-alias-bg-layer-1` / `--dsw-alias-bg-layer-2` to `rgba(...)`, containers that use those aliases directly become translucent: dialog columns, popovers and the page behind them bleed into each other and text becomes unreadable.

All "occluding" surfaces (overlays/dialogs that must cover what is behind them) now composite an **opaque local base + a skin-tint gradient**:

- `background-color` uses an opaque local base: `#fff` in light themes, `#151517` in dark themes (`body[data-ds-dark-theme]` / `html[data-theme=dark]`);
- `background-image` keeps the skin alias colour as a gradient layer, preserving the skin's hue;
- with the default theme or opaque skins the composite is visually identical to before; with translucent skins nothing behind the surface bleeds through.

Covered surfaces: the main stat dialog, quota guide, peak alert and simple footer (main bundle); the fee dialog, context-costs intro and billion-context notice (statistics page); and the model/price combo popover (pricing page). The Codex compat dialog reuses the stat dialog rule and inherits the fix.

A new static fixture (`test/skin-occlusion-static.mjs`) asserts both source rules and built-bundle markers, and the real-browser suites simulate a Dream Skin (translucent `--dsw-alias-bg-base` and `--dsw-alias-bg-layer-2`) and assert an opaque background with the skin tint preserved in the gradient.

### Faster accounting: price-history snapshots advanced at flush time

Every usage entry used to rebuild the whole price-history snapshot (835 models, ~2.18ms normalisation + 0.66ms hashing + JSON comparison), which was 99.8% of the per-entry cost (1.3–2.3ms). Price history is now advanced once inside the flush lock, so individual entries no longer rebuild it.

- 1000 consecutive entries: 1308ms → 93ms;
- short windows (1 / 5 / 20 / 50 entries): 42.4 / 46.4 / 64.5 / 102.9ms → 36.5 / 34.5 / 36.5 / 39.1ms (about -26% / -43% / -62%).

Price changes are still recorded on config writes, and historical pricing queries/repricing keep the same results.

### Ledger merge and render-cache optimisations

- `mergeLedger` no longer performs three unconditional deep clones of the whole ledger: the local snapshot is cloned only when it is not owned, and the disk snapshot is reused when it equals the base; pending records are still replayed one by one. A normal flush drops from ~40ms to ~30ms, and the merged in-memory/on-disk ledger content and semantic hash (`30f37c10373d0a50`) are identical to the previous implementation.
- The statistics render cache key now uses `pricesRev` instead of serialising the whole price table on every render (178KB, 2.55ms → 0.015ms, about 170×); hosts without `pricesRev` fall back to the old serialisation.
- Settings auto-save diffing short-circuits unchanged entries by reference, avoiding serialisation comparisons for every key.

### Verification

- `node test/verify.mjs`: all assertions pass, including the new skin-occlusion static fixture.
- Real-browser suites: `test/statistics-dialog-titlebar.mjs` (229 assertions incl. skin and narrow-viewport geometry) and `test/session-costs-browser.mjs` (incl. the Dream Skin opacity assertions) pass.
- All tests use local ledgers and synthetic data; no live model requests and no subscription quota consumption.

### Upgrading

```powershell
dsh plugin --profile desktop add dsh-cost-meter@1.9.1
```

Restart DSH afterwards (use `web` instead of `desktop` for the web profile), or rerun the one-click installer: `irm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/v1.9.1/install.ps1 | iex`.
