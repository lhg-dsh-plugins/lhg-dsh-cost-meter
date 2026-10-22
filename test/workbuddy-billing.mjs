import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { runStartupImports } from '../lib/index.js'

const root = mkdtempSync(join(tmpdir(), 'cm-workbuddy-billing-'))
const model = 'deepseek-v4.1-flash'
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
const recorded = days => JSON.parse(JSON.stringify(days, (key, value) => key.startsWith('apiCost') ? undefined : value))
const now = Date.now()
let ledger
try {
  for (const route of ['workbuddy-ai', 'workbuddy-global']) for (const [name, enabled, classification, expectedPlan] of [
    ['enabled-auto', true, 'auto', true],
    ['explicit-plan', false, 'plan', true],
    ['explicit-api', true, 'api', false],
  ]) {
    const migration = route === 'workbuddy-ai' ? 'workbuddy-ai-provider-split-v1' : 'workbuddy-global-provider-split-v1'
    const path = join(root, route + '-' + name + '.json')
    // Simulate a fully migrated old installation: all WorkBuddy AI calls were
    // recorded as API, even though the user intended to use its Plan family.
    ledger = new Ledger(sanitizeConfig({
      legacyAutoImportedAt: now, peakEnabled: false,
      codingPlans: { workbuddy: { enabled } },
      planBilling: { providers: { workbuddy: 'api', 'custom-credits': 'api' }, models: { [route + ':paid-model']: 'api' } },
      prices: { providers: Object.fromEntries([route, 'custom-credits', 'ordinary-api'].map(provider => [
        provider, { models: { [model]: { input: 1, output: 4 }, 'paid-model': { input: 2, output: 6 } } },
      ])) },
    }), {}, path)
    await runStartupImports(ledger, join(root, 'empty-sessions'))
    for (const [day, provider, id] of [
      [0, route, model], [1, route, model],
      [0, route, 'paid-model'], [1, 'custom-credits', model],
      [0, 'ordinary-api', model], [1, 'ordinary-api', model],
    ]) {
      ledger.account({ input: 1000, output: 200 }, id, 'session-' + day, now - day * 86400000, provider)
    }
    ledger.flush()
    const originals = structuredClone(ledger.days)
    assert.ok(Object.values(originals).every(day => day.apiCost === day.cost && day.cost > 0))
    ledger.config = sanitizeConfig({ ...ledger.config,
      planBilling: { ...ledger.config.planBilling, providers: { workbuddy: classification, 'custom-credits': 'plan' } },
      // The correction must preserve frozen amounts despite a later rate edit.
      exchangeRate: 99,
    })
    ledger.migrations = ledger.migrations.filter(id => id !== migration)
    ledger.scheduleWrite()
    ledger.close()
    ledger = Ledger.load(path)
    const priceHistory = structuredClone(ledger.pricingHistory)
    // No session logs are available; the stored per-provider buckets suffice.
    const source = name === 'enabled-auto' ? { mode: 'rdb', listSessions: async () => [], readRecords: async () => [] } : null
    await runStartupImports(ledger, join(root, 'empty-sessions'), source)
    assert.deepEqual(recorded(ledger.days), recorded(originals), 'classification never changes recorded totals, tokens, calls or provider keys')
    assert.deepEqual(ledger.pricingHistory, priceHistory, 'no new price version or repricing revision')
    for (const day of Object.values(ledger.days)) {
      for (const row of [day, ...day.sessions]) {
        for (const suffix of ['', 'Cny', 'Eur']) {
          let apiTotal = 0
          for (const [key, bucket] of Object.entries(row.byProviderModel)) {
            const plan = key.startsWith('custom-credits:') || (expectedPlan && key === route + ':' + model)
            const expected = plan ? 0 : bucket['cost' + suffix]
            near(bucket['apiCost' + suffix], expected)
            apiTotal += expected
          }
          near(row['apiCost' + suffix], apiTotal)
        }
      }
      near(day.apiCost, day.sessions.reduce((sum, session) => sum + session.apiCost, 0))
    }
    const repaired = structuredClone(ledger.days)
    assert.equal(ledger.migrations.filter(id => id === migration).length, 1)
    ledger.close()
    ledger = Ledger.load(path)
    await runStartupImports(ledger, join(root, 'empty-sessions'), source)
    assert.deepEqual(ledger.days, repaired, 'restart retains the repair and cannot apply it twice')
    ledger.account({ input: 1000, output: 200 }, model, 'new-session', now, route)
    const newSession = Object.values(ledger.days).flatMap(day => day.sessions).find(row => row.id === 'new-session')
    assert.ok(newSession.cost > 0, 'Plan API-equivalent cost remains available')
    near(newSession.apiCost, expectedPlan ? 0 : newSession.cost)
    ledger.close()
    ledger = null
  }
  console.log('[ok] WorkBuddy AI billing: startup correction, explicit overrides, frozen currencies, daily/session totals, persistence and new calls')
} finally {
  ledger?.close()
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
  rmSync(root, { recursive: true, force: true })
}
