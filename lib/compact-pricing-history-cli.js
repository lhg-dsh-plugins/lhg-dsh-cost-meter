#!/usr/bin/env node
import { parseArgs, isDeepStrictEqual } from 'node:util'
import { realpathSync, readFileSync } from 'node:fs'
import { withLedgerLock, readLedger, writeLedger } from './ledger-persistence.js'
import { normalizePricingHistory, encodePricingHistory } from './billing-history.js'

const { values } = parseArgs({ options: {
  ledger: { type: 'string' }, apply: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
} })
try {
  if (values.help || !values.ledger) {
    console.log('node lib/compact-pricing-history-cli.js --ledger <ledger.json> [--apply]\n默认预览大小，不改账本。退出全部 DSH 后加 --apply 无损转换历史价表，原文件另存 .pricing-history-v1.bak。\nPreview only by default. Stop all DSH instances before --apply. Keeps every price version and backs up the original ledger.')
    if (!values.help) process.exitCode = 1
  } else {
    const path = realpathSync(values.ledger)
    withLedgerLock(path, () => {
      const state = readLedger(path), original = state.pricingHistory
      if (!original?.versions || !original?.changes) throw new Error('No historical price catalog found / 未找到历史价表')
      const history = normalizePricingHistory(original, state.config)
      if (Object.keys(history.versions).length !== Object.keys(original.versions).length
        || !isDeepStrictEqual(history.changes, original.changes)) {
        throw new Error('Invalid historical versions; ledger unchanged / 历史价格版本无效，未改账本')
      }
      // Keep timeline/repricing records byte-for-byte in meaning, including future optional fields.
      const next = { ...state, pricingHistory: { ...original, versions: history.versions } }
      const before = Buffer.byteLength(readFileSync(path)), after = Buffer.byteLength(JSON.stringify({ ...next, pricingHistory: encodePricingHistory(next.pricingHistory) }))
      if (values.apply && original.format !== 2) writeLedger(path, next, true)
      console.log(JSON.stringify({ versions: Object.keys(history.versions).length, beforeBytes: before, afterBytes: after,
        written: values.apply && original.format !== 2, ...(values.apply && original.format !== 2 ? { backup: `${path}.pricing-history-v1.bak` } : {}) }))
    }, 0)
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
