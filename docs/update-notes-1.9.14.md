# v1.9.14

## 中文

### ChatGPT 订阅插件的 Codex 额度

安装并登录 `@eddyskywalker/dsh-chatgpt-subscription` 后，在“费用 → 额度”开启 Codex 额度。侧栏和输入区显示该插件当前账号的剩余额度、实际返回的 5 小时与周窗口，以及本机时间的重置日期；只返回周窗口时不补出 5 小时额度。

在“费用 → 显示”选择侧栏或输入区的 Codex 组件，可将数据源设为 `dsh-chatgpt-subscription`（配置值 `chatgpt`）。默认自动检测依次尝试 `dsh-codex-subscription`、`dsh-chatgpt-subscription`、`dsh-codex-connect`。固定数据源查询失败时显示登录与重试提示，点击即可重新查询。

普通查询使用已登录插件的同源状态接口，点击刷新调用其额度刷新接口。侧栏与输入区共用请求和缓存：成功缓存五分钟，失败一分钟后重试；两个位置都关闭后停止检查。适配代码按需加载，不读取或保存登录凭据，不发送模型请求。

接口依据为 [dsh-chatgpt-subscription](https://github.com/Aa728848/dsh-chatgpt-subscription) 的 npm 发布包 `0.29.0`。验证覆盖原发布包的额度解析与 HTTP 路由、源码和构建产物、配置保存、登录恢复、来源回退、迟到响应、双窗口与周窗口，以及真实浏览器中的侧栏和输入区显示。

更新后完全退出 DSH（包括托盘）再打开。

## English

### Codex quota from the ChatGPT subscription plugin

Sign in to `@eddyskywalker/dsh-chatgpt-subscription`, then enable Codex quota under Cost → Quotas. The sidebar and composer show the active account's remaining quota, actual 5-hour and weekly windows, and local reset times. Weekly-only responses stay weekly-only.

Select `dsh-chatgpt-subscription` in the Codex display component's data-source control (`chatgpt` in configuration), or keep auto-detection. Auto tries `dsh-codex-subscription`, `dsh-chatgpt-subscription`, then `dsh-codex-connect`. An explicitly selected source keeps its sign-in and retry entry when unavailable.

Normal reads use the signed-in plugin's same-origin status endpoint; clicking refresh uses its quota-refresh endpoint. Both display positions share requests and cache. Successful reads are cached for five minutes; failures can retry after one minute. Hiding both positions stops reads. The adapter loads on demand, keeps no login credentials, and sends no model requests.

Validated against the original parser and HTTP routes in the published `0.29.0` package, source and built assets, configuration persistence, sign-in recovery, fallback and stale-request isolation, actual windows, and the sidebar and composer in a real browser.

Fully exit DSH, including its tray process, and reopen after updating.
