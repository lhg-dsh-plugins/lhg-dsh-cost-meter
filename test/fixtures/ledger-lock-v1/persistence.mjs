// Frozen v1.9.9 lock transaction from 2d40d2c18e607662e3ed53ff25c04f9e3210a58d; do not update with production.
import { mkdirSync, readdirSync, writeFileSync, unlinkSync, rmdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ledgerLockOwner, staleLedgerLockOwner } from './owner.mjs'
const pause = new Int32Array(new SharedArrayBuffer(4))
export function withLedgerLock(path, action, timeoutMs = 5000) {
  mkdirSync(dirname(path), { recursive: true })
  const lock = `${path}.lock`
  const owner = `${process.pid}-${randomUUID()}`
  const record = ledgerLockOwner()
  const identities = new Map()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      mkdirSync(lock)
      try { writeFileSync(join(lock, owner), record, { flag: 'wx' }) } catch (error) {
        try { unlinkSync(join(lock, owner)) } catch {}
        rmdirSync(lock)
        throw error
      }
      break
    } catch (error) {
      // Windows can briefly report EPERM while another process finishes removing
      // a directory whose last read handle has only just closed.
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error
      try {
        const names = readdirSync(lock)
        const previous = names.length === 1 && names[0].match(/^(\d+)-[a-f0-9-]+$/)
        if (previous) {
          // Only the contender that removes this unique owner file may remove the
          // directory. Other contenders cannot accidentally unlink a new lock.
          if (staleLedgerLockOwner(join(lock, names[0]), Number(previous[1]), identities)) {
            unlinkSync(join(lock, names[0])); rmdirSync(lock); continue
          }
        } else if (names.length === 0 && Date.now() - statSync(lock).mtimeMs > 30_000) {
          rmdirSync(lock) // Also recovers a process killed between mkdir and owner creation.
          continue
        }
      } catch (probe) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EPERM'].includes(probe.code)) throw probe
      }
      if (Date.now() >= deadline) throw Object.assign(new Error('Ledger is busy; preserving pending changes for retry'), { code: 'EBUSY' })
      Atomics.wait(pause, 0, 0, 10)
    }
  }
  try { return action() } finally {
    unlinkSync(join(lock, owner))
    rmdirSync(lock)
  }
}
