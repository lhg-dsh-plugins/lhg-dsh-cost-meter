/**
 * Regenerates ledger.json with the v1.9.12 library (commit 5900bb9), never with this checkout:
 *   git archive 5900bb9 lib package.json | tar -x -C <old>; ln -s "$PWD/node_modules" <old>/node_modules
 *   TZ=UTC node test/fixtures/ollama-cloud-upgrade-1.9.12/generate.mjs <old>/lib
 * The calls (sessions.json) are accounted by the old Ledger, so recorded amounts and the
 * frozen price version are exactly what an upgrading user has on disk.
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

if (process.env.TZ !== 'UTC' || !process.argv[2]) throw Error('usage: TZ=UTC node generate.mjs <v1.9.12 lib directory>')
const { Ledger, sanitizeConfig } = await import(pathToFileURL(resolve(process.argv[2], 'store.js')))
const sessions = JSON.parse(readFileSync(new URL('./sessions.json', import.meta.url), 'utf8'))
const root = mkdtempSync(join(tmpdir(), 'cm-ollama-upgrade-')), path = join(root, 'ledger.json')
try {
  const ledger = new Ledger(sanitizeConfig({ legacyAutoImportedAt: 1, exchangeRate: 7, exchangeRateAuto: false, hideOfficialBalance: true, goQuota: { enabled: false }, balance: { display: 'off' } }), {}, path)
  for (const [id, calls] of Object.entries(sessions)) for (const { at, provider, model, input } of calls) ledger.account({ input }, model, id, Date.parse(at), provider)
  ledger.close()
  writeFileSync(new URL('./ledger.json', import.meta.url), readFileSync(path))
} finally {
  rmSync(root, { recursive: true, force: true })
}
