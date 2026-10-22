import { readFileSync, statSync } from 'node:fs'
import { withLedgerLock, writeLedger } from './ledger-persistence.js'
import { validWorkBuddyAccountId } from './workbuddy-accounts.js'

const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const round = n => Math.round(n * 1e8) / 1e8
const dayOf = time => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Independent, bounded credit observations: these are never currency ledger entries. */
export function observeWorkBuddyAccounts(path, snapshot, now = Date.now()) {
  return withLedgerLock(path, () => {
    let disk = { version: 1, accounts: {} }
    try {
      if (statSync(path).size > 4 * 1024 * 1024) throw new Error('WorkBuddy statistics file too large')
      disk = JSON.parse(readFileSync(path, 'utf8'))
      if (disk.version !== 1 || !disk.accounts || Array.isArray(disk.accounts) || typeof disk.accounts !== 'object') throw new Error('Invalid WorkBuddy statistics file')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const stamp = snapshot.fetchedAt ?? now, today = dayOf(now)
    const recent = new Set(Array.from({ length: 7 }, (_, index) => { const date = new Date(now); date.setDate(date.getDate() - index); return dayOf(date) }))
    const observed = snapshot.accounts.map(account => {
      if (!validWorkBuddyAccountId(account.id)) return account
      let row = disk.accounts[account.id]
      if (row && (!finite(row.remaining) || !finite(row.at) || !finite(row.total) || !finite(row.since))) throw new Error('Invalid WorkBuddy account statistics')
      if (finite(account.remaining) && (!row || stamp > row.at)) {
        const decrease = row ? round(Math.max(0, row.remaining - account.remaining)) : 0
        row = { since: row?.since ?? stamp, at: stamp, remaining: account.remaining,
          total: round((row?.total ?? 0) + decrease), days: { ...(row?.days ?? {}) } }
        row.days[today] = round((finite(row.days[today]) ? row.days[today] : 0) + decrease)
        row.days = Object.fromEntries(Object.entries(row.days).filter(([day, value]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && finite(value)).sort(([a], [b]) => b.localeCompare(a)).slice(0, 180))
        disk.accounts[account.id] = row
      }
      return { ...account, ...(row ? { observedTotal: row.total, observedToday: row.days?.[today] ?? 0,
        observedWeek: round(Object.entries(row.days ?? {}).reduce((sum, [day, value]) => sum + (recent.has(day) && finite(value) ? value : 0), 0)), since: row.since } : {}) }
    })
    // Retain recent accounts even when deselected; never persist names or credentials.
    disk.accounts = Object.fromEntries(Object.entries(disk.accounts).filter(([id]) => validWorkBuddyAccountId(id))
      .sort((a, b) => b[1].at - a[1].at).slice(0, 400))
    writeLedger(path, disk)
    return { ...snapshot, accounts: observed }
  }, 500)
}
