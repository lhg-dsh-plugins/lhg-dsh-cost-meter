// #237: reproduce PID reuse with a genuinely live PID and an earlier lock identity.
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withLedgerLock } from '../lib/ledger-persistence.js'
import { staleLedgerLockOwner } from '../lib/ledger-lock-owner.js'
import { Ledger, defaultConfig } from '../lib/store.js'

const filename = fileURLToPath(import.meta.url)
if (process.argv[2] === '--holder') {
  withLedgerLock(process.argv[3], () => {
    process.send('held')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000)
  })
  process.exit(0)
} else {
  const root = mkdtempSync(join(tmpdir(), 'cm-lock-recovery-'))
  let child, stopped
  const oldTime = new Date(Date.now() - process.uptime() * 1000 - 10000)
  const plant = (path, pid, text, aged = true) => {
    mkdirSync(`${path}.lock`, { recursive: true })
    const owner = join(`${path}.lock`, `${pid}-${randomUUID()}`)
    writeFileSync(owner, text)
    if (aged) utimesSync(owner, oldTime, oldTime)
    return owner
  }
  try {
    // Exact reported layout: an old empty owner file now names the current PID.
    const path = join(root, 'ledger.json')
    const seed = new Ledger(defaultConfig(), {}, path)
    seed.account({ input: 100, output: 20 }, 'deepseek-v4-flash', 'preserved', Date.now(), 'deepseek')
    seed.close()
    const before = readFileSync(path, 'utf8')
    plant(path, process.pid, '')
    const recovered = withLedgerLock(path, () => Ledger.load(path), 100)
    assert.equal(recovered.today().calls, 1)
    assert.equal(readFileSync(path, 'utf8'), before, 'PID recovery does not reprice or rewrite the ledger')
    recovered.close()
    assert.equal(existsSync(`${path}.lock`), false)

    // Real owner metadata remains valid despite an artificially old mtime.
    let record
    withLedgerLock(path, () => {
      const owner = join(`${path}.lock`, readdirSync(`${path}.lock`)[0])
      record = JSON.parse(readFileSync(owner, 'utf8'))
      assert.equal(record.version, process.platform === 'win32' ? 2 : 1)
      utimesSync(owner, oldTime, oldTime)
      assert.throws(() => withLedgerLock(path, () => assert.fail('must not enter'), 25), /Ledger is busy/)
      assert.equal(existsSync(owner), true, 'old mtime never expires a matching native identity')
    })
    if (record.identity) {
      const previous = structuredClone(record)
      previous.identity.start = String(BigInt(previous.identity.start) - (previous.identity.unit === 'ms' ? 60000n : 1n))
      plant(path, process.pid, JSON.stringify(previous), false)
      assert.equal(withLedgerLock(path, () => 'recovered', 100), 'recovered', 'birth identity detects reuse even with recent mtime')
    }

    // An incomplete/unknown live owner cannot be expired using file age.
    const malformed = plant(path, process.pid, '{incomplete')
    assert.throws(() => withLedgerLock(path, () => assert.fail('must not enter'), 25), /Ledger is busy/)
    assert.equal(readFileSync(malformed, 'utf8'), '{incomplete')
    rmSync(malformed); rmdirSync(`${path}.lock`)
    const recent = plant(path, process.pid, '', false)
    assert.throws(() => withLedgerLock(path, () => assert.fail('must not enter'), 25), /Ledger is busy/)
    rmSync(recent); rmdirSync(`${path}.lock`)

    // A different real process holds the lock; its age is irrelevant.
    const childPath = join(root, 'child.json')
    child = fork(filename, ['--holder', childPath], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true })
    stopped = new Promise(resolve => child.once('exit', resolve))
    await new Promise((resolve, reject) => {
      child.once('message', resolve); child.once('error', reject)
      child.once('exit', () => reject(new Error('holder exited before ready')))
    })
    const childOwner = join(`${childPath}.lock`, readdirSync(`${childPath}.lock`)[0])
    const childText = readFileSync(childOwner, 'utf8')
    utimesSync(childOwner, oldTime, oldTime)
    assert.throws(() => withLedgerLock(childPath, () => assert.fail('must not enter'), 25), /Ledger is busy/)
    assert.equal(readFileSync(childOwner, 'utf8'), childText)

    // The same live foreign PID reused after an earlier process also recovers.
    const foreign = JSON.parse(childText)
    if (foreign.identity) {
      foreign.identity.start = String(BigInt(foreign.identity.start) - (foreign.identity.unit === 'ms' ? 60000n : 1n))
      const foreignPath = join(root, 'foreign.json')
      const foreignOwner = plant(foreignPath, child.pid, JSON.stringify(foreign), false)
      // Probe the real foreign process once. A timed-out OS query must preserve
      // the owner; a known native identity must detect the earlier birth.
      const identities = new Map()
      assert.equal(staleLedgerLockOwner(foreignOwner, child.pid, identities), Boolean(identities.get(child.pid)))
      assert.equal(readFileSync(foreignOwner, 'utf8'), JSON.stringify(foreign), 'probing never removes the owner')
      // Always verify PID reuse with the identity supplied by the real child,
      // independently of PowerShell startup load on Windows CI runners.
      assert.equal(staleLedgerLockOwner(foreignOwner, child.pid, new Map([[child.pid, JSON.parse(childText).identity]])), true)
    }
    const legacyForeign = join(root, 'legacy-foreign.json')
    const legacyOwner = plant(legacyForeign, child.pid, '')
    // Reuse the real holder's native identity to isolate legacy timestamp rules.
    // A second Windows PowerShell startup can time out on a busy runner; that
    // legitimately produces unknown ownership, not a failed timestamp rule.
    // The preceding foreign-lock case still exercises the uncached native probe.
    const legacyIdentity = JSON.parse(childText).identity
    assert.equal(staleLedgerLockOwner(legacyOwner, child.pid, new Map([[child.pid, legacyIdentity]])),
      Number.isFinite(legacyIdentity?.startedAtMs), 'pre-birth legacy locks qualify only with a known native start time')
    assert.equal(readFileSync(legacyOwner, 'utf8'), '', 'the ownership probe never removes the lock itself')
    child.kill('SIGKILL'); await stopped
    assert.equal(withLedgerLock(childPath, () => 'after-death', 100), 'after-death')
    assert.equal(readFileSync(path, 'utf8'), before)
    console.log('[ok] #237: legacy/native PID reuse, unchanged ledger, real live holder, unknown owner and dead-lock recovery')
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await stopped }
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    rmSync(root, { recursive: true, force: true })
  }
}
