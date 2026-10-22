import assert from 'node:assert/strict'
import childProcess, { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { inspectBillionLaunch } from '../lib/billion-context-auto.js'
import { installBillionContextBilling } from '../lib/billion-context-billing.js'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { listBillionFiles, iterateBillionCalls } from '../lib/billion-context-history.js'

const root = mkdtempSync(join(tmpdir(), 'cm-billion-stock-')), savedHome = process.env.DSH_HOME
process.env.DSH_HOME = root
const effects = [], children = [], servers = [], inputs = [], originalSpawn = childProcess.spawn, originalLowSpawn = childProcess.ChildProcess.prototype.spawn
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const listen = server => new Promise(resolve => { servers.push(server); server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)) })
const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
const price = { cacheMiss: 2, output: 8, cacheHit: .5, cacheWrite: 3 }
const config = sanitizeConfig({ peakEnabled: false, prices: { providers: { fixture: { models: { main: price } }, '127.0.0.1': { models: { main: price, summary: price } } } } })
const ledger = new Ledger(config, {}, join(root, 'storages/cost-meter/ledger.json'))
const ctx = { effect: fn => effects.push(fn()), on() {}, get() {} }
let bridge = installBillionContextBilling(ctx, ledger)
const proxySource = `
import { createServer } from 'node:http';
async function fetchWithTimeout(url, opts) { return { response: await fetch(url, opts), clearTimer() {} }; }
async function fetchWithRetry(url, opts) { for (let attempt = 1; attempt <= 2; attempt++) { const result = await fetchWithTimeout(url, opts); if (result.response.ok) return result; await result.response.text(); } }
async function requestSummaryBody(deps, body) { for (let attempt = 1; attempt <= 2; attempt++) { return fetchWithTimeout(deps.url, { method: 'POST', body }); } }
async function handle(req, res) {
  if (req.url === '/__bili/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  const upstream = new URL(req.url.slice('/bili/'.length));
  if (upstream.searchParams.has('multi')) {
    const summary = await requestSummaryBody({ url: upstream.origin + '/v1/messages' }, JSON.stringify({ model: 'summary' })); await summary.response.text();
    const retry = await fetchWithRetry(upstream.origin + '/v1/chat/completions?retry', { method: 'POST', body }); await retry.response.text();
  }
  const result = await fetchWithTimeout(upstream.href, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
  const text = await result.response.text(); res.writeHead(result.response.status, { 'content-type': 'application/json' }); res.end(text);
  if (upstream.searchParams.has('settle')) await new Promise(resolve => setTimeout(resolve, 2500));
}
createServer((req,res) => handle(req,res).catch(() => { res.statusCode = 500; res.end('{}'); })).listen(0,'127.0.0.1',function() { console.log('PORT=' + this.address().port); });
`
const nativeSource = `function installNativeFetchIntercept(state) { installFetchChain(send => async(input, init) => send(input, init)); }`
let upstream, version = '9.8.7', retries = 0
async function start(directory, args = []) {
  const child = spawn(process.execPath, [join(directory, 'dist/index.js'), ...args], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  children.push(child)
  let output = '', errors = ''
  child.stderr.on('data', bytes => { errors += bytes; if (errors.length > 4000) errors = errors.slice(-4000) })
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('stock startup timeout: ' + errors)), 20000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(Error('stock exited ' + code + ': ' + errors)) })
    child.stdout.on('data', bytes => { output += bytes; const found = /PORT=(\d+)/.exec(output); if (found) { clearTimeout(timer); resolve('http://127.0.0.1:' + found[1]) } })
  })
}
async function use(origin, sessionId, multi = false, { probe = true, native = false, settle = false } = {}) {
  if (probe) {
    const health = await fetch(origin + '/__bili/health'); await health.text()
    assert.equal(health.headers.get('x-dsh-cost-meter-protocol'), '1')
  }
  const scope = bridge.createScope({ sessionId, model: 'main', provider: 'fixture' }, Date.now())
  const response = await scope.run(() => fetch((native ? upstream : origin + '/bili/' + upstream) + '/v1/chat/completions' + (multi ? '?multi' : settle ? '?settle' : ''), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'main', messages: [{ role: 'user', content: 'PRIVATE-STOCK-PROMPT' }] }),
  }))
  assert.equal(response.status, 200)
  await response.text()
  const covered = await scope.finish({ inputTokens: 100, outputTokens: 20 })
  assert.equal(covered, true, sessionId + ': ' + JSON.stringify(bridge.status()) + (covered ? '' : '\n' + readdirSync(ledger.path + '.billion-context/groups').filter(file => file.endsWith('.status.json')).map(file => readFileSync(join(ledger.path + '.billion-context/groups', file), 'utf8')).join('\n')))
}
async function records() {
  const result = []
  for (const file of listBillionFiles(ledger.path)) for await (const item of iterateBillionCalls(file)) result.push(item.row)
  return result
}
try {
  upstream = await listen(createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    inputs.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
    assert.equal(req.headers['x-dsh-cost-meter-group'], undefined)
    if (req.url.includes('retry') && retries++ === 0) return json(res, { error: 'retry' }, 503)
    json(res, req.url.includes('messages') ? { content: [{ type: 'text', text: 'summary' }], usage: { input_tokens: 12, output_tokens: 3 } }
      : { choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } } })
  }))
  const pkg = join(root, 'stock'), proxy = join(pkg, 'dist/index.js'), native = join(pkg, 'dist/agent/dsh-native.js')
  mkdirSync(join(pkg, 'dist/agent'), { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'billion-context', version, type: 'module' }))
  writeFileSync(proxy, proxySource); writeFileSync(native, nativeSource)
  const before = [hash(proxy), hash(native), hash(join(pkg, 'package.json'))]
  assert.equal(inspectBillionLaunch([proxy]).version, '9.8.7', 'unchanged contracts work with future releases')
  assert.equal(inspectBillionLaunch(['--eval', 'arbitrary code']), null)
  const origin = await start(pkg)
  await Promise.all([use(origin, 'main-conversation', true), use(origin, 'subagent')])
  const calls = await records()
  assert.equal(calls.length, 5, 'summary, both retry attempts, and both main requests are observed')
  assert.equal(calls.filter(row => row.kind === 'compaction').length, 1)
  assert.equal(calls.filter(row => row.sessionId === 'subagent').length, 1)
  assert.ok(calls.some(row => row.attempt === 2))
  assert.equal(bridge.status().compatibility, 'ready')
  const total = ledger.sumDays().cost
  assert.ok(total > 0)
  assert.equal(ledger.sumDays().calls, 4, 'missing usage on the failed attempt remains unreported')
  await bridge.ingest(); assert.equal(ledger.sumDays().cost, total)
  assert.deepEqual([hash(proxy), hash(native), hash(join(pkg, 'package.json'))], before, 'original package files and version are untouched')
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE-STOCK-PROMPT/)
  await use(origin, 'delayed-receipt', false, { settle: true })
  assert.equal((await records()).filter(row => row.sessionId === 'delayed-receipt').length, 1, 'a receipt arriving after the response body is still imported exactly once')
  for (const dispose of effects.splice(0)) dispose?.()
  bridge = installBillionContextBilling(ctx, ledger)
  await use(origin, 'after-hot-reload', false, { probe: false })
  assert.equal((await records()).filter(row => row.sessionId === 'after-hot-reload').length, 1, 'the live original proxy survives a cost-meter reload')
  const plain = spawn(process.execPath, ['-e', 'console.log(process.env.DSH_COST_METER_BILLION_LOADER || "unrelated")'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let plainText = ''; plain.stdout.on('data', bytes => { plainText += bytes }); await once(plain, 'exit'); assert.equal(plainText.trim(), 'unrelated')
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'billion-context', version: '0.1.180', type: 'module' }))
  assert.equal(inspectBillionLaunch([proxy]).reason, 'needs_update')
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'billion-context', version: '9.8.8', type: 'module' }))
  writeFileSync(proxy, proxySource.replace('response: await fetch', 'changed: await fetch'))
  assert.equal(inspectBillionLaunch([proxy]).reason, 'changed')
  const changed = await start(pkg)
  assert.equal(bridge.status().compatibility, 'changed', 'a changed launch produces the actual feedback notice')
  const changedHealth = await fetch(changed + '/__bili/health'); await changedHealth.text()
  assert.equal(changedHealth.headers.get('x-dsh-cost-meter-protocol'), null, 'changed logic launches unchanged instead of loading speculative hooks')
  // Published packages run their original CLI, with the automatic loader only.
  if (process.env.DSH_TEST_BILLION_PACKAGE) {
    const directory = join(root, 'official'); mkdirSync(directory)
    childProcess.execFileSync('tar', ['-xf', resolve(process.env.DSH_TEST_BILLION_PACKAGE), '-C', directory])
    const original = join(directory, 'package'), entry = join(original, 'dist/index.js'), fingerprint = hash(entry)
    const info = inspectBillionLaunch([entry]); assert.ok(info?.fingerprint)
    const configFile = join(root, 'official-config.json')
    writeFileSync(configFile, JSON.stringify({ log: false, autoUpdate: false, advisoryCheck: false, releaseNotesCheck: false, mitm: { enabled: false } }))
    const childEnv = { ...process.env, BILI_CONFIG_FILE: configFile, BILI_SESSIONS_DIR: join(root, 'official-sessions'),
      XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
      ACP_AUTO_UPDATE: '0', BILI_ADVISORY_CHECK: '0', BILI_RELEASE_NOTES_CHECK: '0', BILI_MITM: '0', ACP_PROXY_MODE: 'direct' }
    const server = createServer(); const reserved = await listen(server); await new Promise(resolve => server.close(resolve))
    const port = new URL(reserved).port
    const child = spawn(process.execPath, [entry, 'start', '--host', '127.0.0.1', '--port', port], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); children.push(child)
    let logs = ''; child.stdout.on('data', bytes => { logs += bytes }); child.stderr.on('data', bytes => { logs += bytes })
    let healthy = false
    for (let n = 0; n < 120; n++) {
      if (child.exitCode !== null) throw Error('official CLI exited: ' + logs.slice(-4000))
      try { const res = await fetch(reserved + '/__bili/health'); healthy = res.ok; await res.text() } catch {}
      if (healthy) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(healthy, 'original CLI starts with the automatic adapter: ' + logs.slice(-1500))
    try { await use(reserved, 'official-stock') } catch (error) { console.error(logs.slice(-7000)); throw error }
    assert.ok((await records()).some(row => row.sessionId === 'official-stock'))
    assert.equal(hash(entry), fingerprint)
    const nativePath = join(original, 'dist/agent/dsh-native.js'), nativeHash = hash(nativePath)
    const beforeFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch'), beforeFlag = globalThis[Symbol.for('billion-context.native-fetch-intercept')]
    const savedProxy = process.env.BILLION_CONTEXT_PROXY, savedTest = process.env.NODE_TEST_CONTEXT
    let native
    try {
      process.env.BILLION_CONTEXT_PROXY = reserved; delete process.env.NODE_TEST_CONTEXT
      native = await import(pathToFileURL(nativePath).href)
      native.apply({ tools: { register() {} }, commands: { register() {} }, on() {},
        agents: { currentInitiator: () => ({ session: { id: 'official-native', header: {} } }) } })
      await native._settleNativeForTest()
      try { for (let request = 0; request < 8; request++) await use(reserved, 'official-native', false, { native: true }) } catch (error) { console.error(logs.slice(-7000)); throw error }
      assert.equal((await records()).filter(row => row.sessionId === 'official-native').length, 8, 'consecutive original native requests retain their billing scope and completion receipts')
    } finally {
      native?._resetRegisterForTest()
      Object.defineProperty(globalThis, 'fetch', beforeFetch)
      const key = Symbol.for('billion-context.native-fetch-intercept')
      if (beforeFlag === undefined) delete globalThis[key]; else globalThis[key] = beforeFlag
      if (savedProxy === undefined) delete process.env.BILLION_CONTEXT_PROXY; else process.env.BILLION_CONTEXT_PROXY = savedProxy
      if (savedTest === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = savedTest
    }
    assert.equal(hash(nativePath), nativeHash)
    for (const order of ['billion-first', 'cost-first']) {
      const cold = spawn(process.execPath, [fileURLToPath(new URL('./billion-context-startup.mjs', import.meta.url)), nativePath, order], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let output = ''; cold.stdout.on('data', bytes => { output += bytes }); cold.stderr.on('data', bytes => { output += bytes })
      const [code] = await once(cold, 'exit'); assert.equal(code, 0, output)
    }
    console.log('[ok] official stock billion-context ' + info.version + ': unmodified CLI, automatic request association, durable usage and unchanged source')
  }
  console.log('[ok] stock auto integration: future version, summary/retry/subagent, no companion, no source writes, unrelated spawn preserved')
} finally {
  for (const child of children) if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
  for (const server of servers) { server.closeAllConnections?.(); if (server.listening) await new Promise(resolve => server.close(resolve)) }
  for (const dispose of effects) dispose?.()
  bridge.dispose(); ledger.close()
  assert.equal(childProcess.spawn, originalSpawn, 'unload restores the original spawn export')
  assert.equal(spawn, originalSpawn, 'unload restores live ESM imports')
  assert.equal(childProcess.ChildProcess.prototype.spawn, originalLowSpawn, 'unload restores the process launch hook')
  if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome
  rmSync(root, { recursive: true, force: true })
}
