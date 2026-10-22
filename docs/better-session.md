# better-session / SQLite 会话存储兼容

DSH 可安装 [`@morlay/better-session`](https://www.npmjs.com/package/@morlay/better-session)
把会话持久化到 SQLite（`@morlay/session-rdb`），此时会话记录不再写入
`$DSH_HOME/sessions` 下的 JSONL 文件。本插件通过统一的会话记录源读取会话：
JSONL 后端仍读文件，SQLite 后端经宿主 `sessionPersistence` 服务读数据库。

## 已适配的行为

- **回填 / 导入安装前历史**：`backfillLegacyLedger` / `importLegacyHistory` /
  `repairPlanHourBuckets` / `recomputeLedgerPricingBasis` / `repairForkSeed`
  都通过同一记录源枚举会话；SQLite 下自动切到数据库读取。
- **一次性迁移标记**：`fork-seed-dedup-v1`、`currency-basis-recompute-v1`、
  `holiday-offpeak-recompute-v1`、`plan-hours-attribution-v1`、
  `legacyAutoImportedAt` 与默认价格迁移，在 SQLite 空扫描时**不消费**，下次
  启动会重试；JSONL 后端语义不变（空扫描照旧视为已完成）。
- **启动日志**：启动时会打印一行当前后端，例如
  `[dsh-cost-meter] 会话存储后端: session-rdb (SQLite);回填/导入/重定价已切数据库读取;JSONL 修复工具不适用`。
- **手动导入的提示**：SQLite 下扫描 0 条时，导入结果会明确说明「当前宿主使用
  SQLite 会话存储」，避免与「确实没有安装前历史」混淆。
- **`dsh-cost-meter-repair-sessions` 修复工具**：检测到 SQLite 后端时提示不适用
  并以退出码 `2` 结束，不执行任何写入（该工具只修复 JSONL 日志）。

## 已知限制

- **跨后端历史并集未实现**：JSONL 模式下记录源只枚举现有的 JSONL 日志文件，
  不会再去数据库里合并历史。若你曾在 JSONL 后端产生会话、之后又切到
  better-session/SQLite，旧 JSONL 文件里的历史不会自动出现在导入结果中——请
  保留原 `sessions/` 目录并用 JSONL 修复工具/旧版插件完成一次导入，或先用
  better-session 自带工具把旧会话迁移进 SQLite。
- **降级暴露仅为第一阶段**：目前只提供启动日志、导入文案与修复 CLI 退出码，
  暂不在设置页/状态 schema 中展示后端信息。
- `repair-sessions-cli` 只适用于 JSONL 会话日志；SQLite 不需要修复工具。

---

# better-session / SQLite session storage compatibility

DSH may install [`@morlay/better-session`](https://www.npmjs.com/package/@morlay/better-session)
to persist sessions in SQLite (`@morlay/session-rdb`); session records are then no
longer written as JSONL files under `$DSH_HOME/sessions`. dsh-cost-meter reads
sessions through a unified record source: JSONL files for the JSONL backend, and
the host `sessionPersistence` service for the SQLite backend.

## What is adapted

- **Backfill / pre-install history import**: `backfillLegacyLedger`,
  `importLegacyHistory`, `repairPlanHourBuckets`,
  `recomputeLedgerPricingBasis` and `repairForkSeed` all enumerate sessions via
  the same record source, so SQLite hosts read from the database.
- **One-shot migration markers**: `fork-seed-dedup-v1`,
  `currency-basis-recompute-v1`, `holiday-offpeak-recompute-v1`,
  `plan-hours-attribution-v1`, `legacyAutoImportedAt` and the default-price
  migration are **not** consumed on an empty SQLite scan (they retry on the next
  start); JSONL semantics are unchanged (an empty scan still counts as done).
- **Startup log**: one line reports the active backend, e.g.
  `[dsh-cost-meter] 会话存储后端: session-rdb (SQLite);回填/导入/重定价已切数据库读取;JSONL 修复工具不适用`.
- **Manual import message**: on SQLite an empty scan says "This host uses SQLite
  session storage", so it is not confused with "no pre-install history".
- **`dsh-cost-meter-repair-sessions`**: when SQLite is detected the tool says it
  is not applicable and exits with code `2` without writing anything.

## Known limitations

- **No cross-backend history union yet**: in JSONL mode the record source only
  enumerates existing JSONL log files; it does not merge database history. If you
  used the JSONL backend and later switched to better-session/SQLite, old JSONL
  history is not included automatically. Keep the original `sessions/` directory
  and import it once with the JSONL tool/older plugin, or migrate old sessions
  into SQLite with better-session's own tooling first.
- **Phase 1 degradation visibility only**: startup log, import message and CLI
  exit code; the backend is not exposed in the settings UI or state schema yet.
- `repair-sessions-cli` only applies to JSONL session logs; SQLite needs no
  repair tool.
