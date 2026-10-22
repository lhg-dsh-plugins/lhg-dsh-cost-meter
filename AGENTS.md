# AGENTS.md — 给 AI 助手的仓库须知

## Issue 与 PR 贡献署名

- 修复或实现他人提出的 issue、讨论或代码建议时，在 PR 正文注明其 GitHub 账号、原始链接和具体贡献；不能只写 `Fixes #编号`。
- 按实际情况区分问题报告、需求建议、复现、定位和代码贡献，不虚构署名或贡献。

## npm 发布令牌的位置

- npm 发布令牌存放在 **Windows 用户级环境变量 `NPM_TOKEN`** 中（经 `setx` 持久化于注册表 `HKCU\Environment\NPM_TOKEN`；新开终端 / 登录会话自动可用）。
- `%USERPROFILE%\.npmrc` 已配置为引用该变量：

  ```ini
  //registry.npmjs.org/:_authToken=${NPM_TOKEN}
  ```

- 因此发布时**无需再传任何凭据**；在已打开的旧终端里若读不到该变量，重启终端即可。
- npm 账号：`smallsun`（`npm whoami` 可自检）。

## npm 发布流程（dsh-cost-meter）

1. 更新 `package.json` 版本号 + CHANGELOG；推送 master 并打 tag（安装链 install.ps1 / 双语 README 引用的 tag 需同步，参考既有 release commit）；
2. `npm pack --dry-run` 核对包内容后直接 `npm publish --access public`；
3. 认证失败（E401/E403）时按序检查：
   - PowerShell 执行 `[Environment]::GetEnvironmentVariable('NPM_TOKEN','User')` 确认变量存在且有效；
   - 失效则用新令牌重跑 `setx NPM_TOKEN <令牌>` 后重启终端再试。

## 版本号约定（用户要求，2026-10-18 起）

- 发版默认**只递增补丁号（第三位）**：如 `1.8.36 → 1.8.37`、`1.9.0 → 1.9.1`。新增功能、新插件适配、UI 改动等一律按补丁号发布。
- **不要**默认升次版本号（`1.x.0`）或主版本号（`2.0.0`）；只有用户明确要求，或存在无法向后兼容的破坏性变更（且已先询问用户）时才升位。
- 版本仍需按既有流程五处对齐：`package.json`、`install.ps1`、`README.md`、`README.zh-CN.md`，并同步更新 `CHANGELOG.md` 与 `docs/UPDATE-HISTORY.md`。
- 参考：v1.9.0（多插件兼容大更新）是此约定之前发布的最后一例大版本；此后不再主动升次/主版本号。

## 安全约定

- **绝对不要**把令牌明文写入仓库文件、issue、PR、评论或命令输出——本仓库是公开的；
- 只允许记录指针位置（即本文件），令牌值只存在于用户环境变量中。
