// #327: frozen old readers, real Windows processes, and deterministic unit cases.
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { ledgerLockOwner, staleLedgerLockOwner } from '../lib/ledger-lock-owner.js'
import { withLedgerLock } from '../lib/ledger-persistence.js'
import { ledgerLockOwner as oldOwner, staleLedgerLockOwner as oldStale } from './fixtures/ledger-lock-v1/owner.mjs'
import { withLedgerLock as oldLock } from './fixtures/ledger-lock-v1/persistence.mjs'

const filename = fileURLToPath(import.meta.url)
if (process.argv[2] === '--holder') {
  const old = process.argv[3] === 'old'
  ;(old ? oldLock : withLedgerLock)(process.argv[4], () => {
    process.send({ record: JSON.parse((old ? oldOwner : ledgerLockOwner)()) })
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000)
  })
  process.exit(0)
} else {
  const source = readFileSync(new URL('../lib/ledger-lock-owner.js', import.meta.url), 'utf8')
  const frozen = readFileSync(new URL('./fixtures/ledger-lock-v1/owner.mjs', import.meta.url), 'utf8')
  // Execute the actual source with OS boundaries replaced. This runs Windows
  // cases on Linux CI too, and makes PowerShell failures/clock offsets repeatable.
  const load = (code, options = {}) => {
    const pid = 321, foreign = 654, start = 1700000000000
    const ticks = String((BigInt(start) + 62135596800000n) * 10000n)
    let text = '', probes = 0
    const context = {
      process: { platform: 'win32', pid, env: {}, uptime: () => 50,
        kill: () => { if (options.dead) throw Object.assign(new Error(), { code: 'ESRCH' }) } },
      Date: { now: () => start + 50000 + (options.clockOffset ?? 0) },
      performance: { timeOrigin: start },
      hostname: () => 'test-host', join,
      readFileSync: () => text, statSync: () => ({ mtimeMs: start - 60000 }),
      execFileSync: () => { probes++; if (options.unavailable) throw new Error('unavailable'); return ticks },
    }
    const exports = new vm.Script(code.replace(/^import .*\n/gm, '').replace(/export function /g, 'function ')
      + '\n;({ledgerLockOwner, staleLedgerLockOwner})').runInNewContext(context)
    return { ...exports, pid, foreign, start, ticks, probes: () => probes,
      probe: (record, ownerPid = pid, identities) => { text = typeof record === 'string' ? record : JSON.stringify(record); return exports.staleLedgerLockOwner('owner', ownerPid, identities) } }
  }
  const now = load(source, { clockOffset: -60000 })
  const record = JSON.parse(now.ledgerLockOwner())
  assert.equal(record.version, 2)
  assert.equal(Number(record.identity.start), now.start, 'late module import/wall-clock shift does not change the startup origin')
  for (let i = 0; i < 10; i++) assert.equal(now.ledgerLockOwner(), JSON.stringify(record))
  assert.equal(now.probes(), 0, 'normal Windows owner writes never spawn PowerShell')
  assert.equal(now.probe(record), false)
  const native = { version: 1, host: 'test-host', identity: { platform: 'win32', start: now.ticks } }
  assert.equal(now.probe(native), false, 'new reader preserves old native lock naming its own PID')
  assert.equal(now.probe(native), false)
  assert.equal(now.probes(), 1, 'native self probe is lazy and cached')
  const reusedNative = structuredClone(native)
  reusedNative.identity.start = String(BigInt(now.ticks) - 1n)
  assert.equal(now.probe(reusedNative), true, 'native one-tick identity differences remain exact')
  const foreignCache = new Map([[now.foreign, native.identity]])
  assert.equal(now.probe(record, now.foreign, foreignCache), false, 'ms/native units identify a live foreign owner')
  for (const [offset, stale] of [[-60000, true], [-2001, true], [-2000, false], [-1, false], [0, false], [60000, false]]) {
    const previous = structuredClone(record)
    previous.identity.start = String(now.start + offset)
    assert.equal(now.probe(previous, now.foreign, foreignCache), stale, `foreign ms/native offset ${offset}`)
    assert.equal(now.probe(previous), stale, `self ms/ms offset ${offset}`)
  }
  for (const invalid of [null, { ...record, version: 3 }, { ...record, identity: { ...record.identity, unit: 'seconds' } },
    { ...record, identity: { ...record.identity, start: '9007199254740992' } }, '{incomplete']) {
    assert.equal(now.probe(invalid, now.foreign, foreignCache), false, 'unknown live ownership never expires')
  }
  assert.equal(now.probe({ ...record, host: 'other-host' }, now.foreign, foreignCache), false)
  assert.equal(load(source, { unavailable: true }).probe(record, now.foreign), false, 'failed OS probe preserves the lock')
  assert.equal(load(source, { unavailable: true }).probe(native), false)
  assert.equal(load(source, { dead: true }).probe(record), true, 'dead PID recovers either metadata version')
  const old = load(frozen)
  assert.equal(old.probe(record), false, 'actual v1.9.9 reader must not mistake ms for ticks')
  const originalPrRecord = { ...record, version: 1 }
  assert.equal(old.probe(originalPrRecord), true, 'control reproduces the original PR double-entry bug')
  console.log('[ok] #327: Windows v1/v2 units, PID reuse, native precision, clock shift, unknown owners and zero startup probes')

  if (process.platform === 'win32') {
    const root = mkdtempSync(join(tmpdir(), 'cm-lock-compat-'))
    let child, stopped
    const plant = (path, pid, text) => {
      mkdirSync(`${path}.lock`)
      const owner = join(`${path}.lock`, `${pid}-${randomUUID()}`)
      writeFileSync(owner, JSON.stringify(text))
      return owner
    }
    const stop = async () => { child.kill('SIGKILL'); await stopped; child = null }
    try {
      const ownNative = JSON.parse(oldOwner())
      assert.ok(ownNative.identity, 'real Windows native identity must be available')
      const nativePath = join(root, 'native-self.json')
      const selfOwner = plant(nativePath, process.pid, ownNative)
      assert.equal(staleLedgerLockOwner(selfOwner, process.pid), false)
      assert.throws(() => withLedgerLock(nativePath, () => assert.fail('live old owner'), 25), /Ledger is busy/)
      ownNative.identity.start = String(BigInt(ownNative.identity.start) - 1n)
      writeFileSync(selfOwner, JSON.stringify(ownNative))
      assert.equal(withLedgerLock(nativePath, () => 'native-recovered', 100), 'native-recovered')

      for (const mode of ['new', 'old']) {
        const path = join(root, `${mode}.json`)
        child = fork(filename, ['--holder', mode, path], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true })
        stopped = new Promise(resolve => child.once('exit', resolve))
        const held = await new Promise((resolve, reject) => {
          child.once('message', resolve); child.once('error', reject)
          child.once('exit', () => reject(new Error('holder exited before acquiring lock')))
        })
        const owner = join(`${path}.lock`, readdirSync(`${path}.lock`)[0])
        const original = readFileSync(owner, 'utf8')
        const oldTime = new Date(Date.now() - 120000)
        utimesSync(owner, oldTime, oldTime)
        assert.equal(oldStale(owner, child.pid), false, `old reader preserves live ${mode} owner`)
        assert.throws(() => oldLock(path, () => assert.fail('old reader entered held lock'), 25), /Ledger is busy/)
        assert.throws(() => withLedgerLock(path, () => assert.fail('new reader entered held lock'), 25), /Ledger is busy/)
        assert.equal(readFileSync(owner, 'utf8'), original)
        process.kill(child.pid, 0)
        assert.equal(child.exitCode, null, 'holder remains genuinely alive throughout exclusion checks')
        const previous = structuredClone(held.record)
        assert.ok(previous.identity)
        previous.identity.start = String(BigInt(previous.identity.start) - (mode === 'new' ? 60000n : 1n))
        const reused = join(root, `${mode}-reused.json`)
        plant(reused, child.pid, previous) // Recent mtime: identity, not file age, proves reuse.
        assert.equal(withLedgerLock(reused, () => 'recovered', 100), 'recovered', `${mode} foreign PID reuse`)
        await stop()
        assert.equal(withLedgerLock(path, () => 'after-death', 100), 'after-death')
        assert.equal(existsSync(`${path}.lock`), false)
      }
      console.log('[ok] #327: actual Windows old/new holder-reader exclusion, native self lock, recent-mtime PID reuse and dead-holder recovery')
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) await stop()
      assert.equal(dirname(resolve(root)), resolve(tmpdir()))
      rmSync(root, { recursive: true, force: true })
    }
  }
}
