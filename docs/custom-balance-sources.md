# 自定义余额：随机端口、局域网与 WorkBuddy2API

## 跟随 DSH 随机端口

在 **设置 → 费用 → 额度 → 自定义 Provider 余额** 中，请求 URL 可以填写以单个 `/` 开头的路径：

```json
{
  "enabled": true,
  "label": "WorkBuddy 积分",
  "unit": "CREDITS",
  "request": { "url": "/plugins/dsh-workbuddy-connect/status" },
  "extract": { "remaining": "credits.total" }
}
```

插件在查询时读取 DSH `webServer.port`，访问当前宿主的本机 HTTP 服务。端口改变后旧余额缓存失效，配置仍保存相对路径。服务尚未监听时提示稍后重试；不会扫描端口、改写账本中的 URL，或把浏览器提供的 origin 当作查询目标。`//host/path`、反斜杠和带凭据的 URL 不被接受，重定向不会被跟随。

`dsh-workbuddy-connect` 的状态路由与独立部署的 WorkBuddy2API 是两种来源。只有宿主内注册的路由使用相对路径；独立服务填写其实际 URL。

## 局域网 HTTP

HTTPS 和本机回环 HTTP 继续可用。访问 `http://192.168.1.20:8790` 等非回环地址时，在同一条余额配置中：

1. 在凭据白名单填写准确的 `192.168.1.20:8790`。
2. 勾选“允许非回环 HTTP”。

这对应 `allowedHosts: ["192.168.1.20:8790"]` 和 `allowInsecureHttp: true`。两个条件缺一不可；白名单按准确的主机和端口匹配，不接受 `192.168.*.*`。HTTP 会明文传输请求头中的凭据，开关默认关闭。已有 CLIProxyAPI 网关配置仍使用其原有的同名开关和白名单。

## WorkBuddy2API 积分预设

点击 **+ WorkBuddy2API 积分**，会创建一条默认关闭的可编辑配置：

```json
{
  "label": "WorkBuddy2API 积分",
  "unit": "CREDITS",
  "refreshMinutes": 15,
  "request": {
    "url": "http://127.0.0.1:8790/api/credits/expiry?package_limit=1",
    "method": "GET",
    "headers": { "X-Admin-Token": "{{WORKBUDDY2API_ADMIN_TOKEN}}" }
  },
  "extract": { "remaining": "summary.available_remaining" },
  "allowedHosts": ["127.0.0.1:8790"],
  "allowInsecureHttp": false
}
```

填入实际地址和端口，在凭据输入框保存 WorkBuddy2API 管理后台的 **X-Admin-Token**，再启用卡片。该令牌与模型推理 API Key 不同；过期后需要更新。密钥通过 DSH 凭据库保存，不写入上述配置。修改服务地址时同步修改白名单。

显示的是**活跃账号池的可用积分**，不与美元费用换算，也不把仅覆盖部分账号的到期快照 `summary.total_remaining` 当成全部余额。没有可信的总额度就不编造进度条上限。查询只读取服务器已有统计，不发模型请求、不触发账号积分刷新任务。`package_limit=1` 缩小不需要的积分包明细；插件只保留提取后的数字。

上游契约核对于 2026-10-18，commit `02f82cdf3282475ce3c1e87f01afdc044636f549`：

- [积分路由和汇总字段](https://github.com/xiaofan6ya/workbuddy2api/blob/02f82cdf3282475ce3c1e87f01afdc044636f549/admin/routers/credits.py)
- [X-Admin-Token 鉴权](https://github.com/xiaofan6ya/workbuddy2api/blob/02f82cdf3282475ce3c1e87f01afdc044636f549/admin/security.py)
- [默认监听端口](https://github.com/xiaofan6ya/workbuddy2api/blob/02f82cdf3282475ce3c1e87f01afdc044636f549/admin/config.py)

本轮验证包括真实本地 HTTP 服务的随机端口切换、配置往返和合成 WorkBuddy2API 响应；未连接用户的真实 WorkBuddy2API 账号。

贡献来源：@Jav1es 在 [#311](https://github.com/Han-1413141/dsh-cost-meter/issues/311) 提供随机端口复现及相对路径建议；@snhun 在 [#309](https://github.com/Han-1413141/dsh-cost-meter/issues/309) 提出局域网 HTTP 需求，在 [#310](https://github.com/Han-1413141/dsh-cost-meter/issues/310) 提出 WorkBuddy2API 接入需求。

## English setup

Root-relative URLs such as `/plugins/dsh-workbuddy-connect/status` follow the running DSH web server's actual port. Independent WorkBuddy2API deployments use an absolute URL. Non-loopback HTTP requires both `allowInsecureHttp: true` and an exact `host:port` in `allowedHosts`; this explicitly permits plaintext transport. Redirects remain blocked.

The **+ WorkBuddy2API credits** preset reads `GET /api/credits/expiry?package_limit=1` with an admin `X-Admin-Token` stored as `WORKBUDDY2API_ADMIN_TOKEN` in DSH credentials. Set the real server address and matching allowlist, update expired admin tokens, then enable the card. The displayed `summary.available_remaining` is the active account pool's available credits, not currency, a single model API key's allowance, or the incomplete expiry snapshot total. No model request or upstream credit-refresh task is triggered. Authentication was tested with synthetic responses, not a live account.
