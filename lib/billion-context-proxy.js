/** Optional billion-context producer. Observes consumed usage; never changes routing or payloads. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, lstatSync, mkdirSync, openSync, writeSync, closeSync, fsyncSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const scope = new AsyncLocalStorage(), producer = randomUUID(), sequences = new Map()
export const BILLION_GROUP_HEADER = 'x-dsh-cost-meter-group'
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const modelId = value => typeof value === 'string' && /^[\w./:@+-]{1,200}$/.test(value)
const home = () => process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
export const billionBridgeConfigPath = () => join(home(), 'storages', 'cost-meter', 'billion-context-bridge.json')

function readSmall(path) {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw Error('Invalid metering metadata')
  return JSON.parse(readFileSync(path, 'utf8'))
}
function safeDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Invalid metering directory')
}
export function meterBillionRequest(request, response, operation) {
  if (request.method === 'GET' && request.url === '/__bili/health') {
    response.setHeader('x-dsh-cost-meter-protocol', '1')
    response.setHeader('x-dsh-cost-meter-pid', String(process.pid))
  }
  const id = request.headers?.[BILLION_GROUP_HEADER]
  delete request.headers?.[BILLION_GROUP_HEADER]
  if (!uuid(id)) return operation()
  let current
  try {
    const config = readSmall(billionBridgeConfigPath())
    if (config.protocol !== 1 || typeof config.root !== 'string' || !config.root) throw Error('Unsupported metering protocol')
    const group = readSmall(join(config.root, 'groups', id + '.json'))
    if (group.protocol !== 1 || group.groupId !== id || typeof group.sessionId !== 'string' || !uuid(group.streamId)) throw Error('Invalid metering reservation')
    safeDirectory(config.root)
    response.setHeader(BILLION_GROUP_HEADER, id)
    current = { root: config.root, groupId: id, streamId: group.streamId, sessionId: group.sessionId, kind: 'model', group: { pending: 0, written: 0, failed: false, finished: false } }
  } catch {}
  if (!current) return operation()
  const done = () => { current.group.finished = true; writeGroupStatus(current) }
  // The original proxy persists conversation state after ending its response.
  // The response boundary plus zero pending upstream calls is enough to import
  // the completed usage; any later background calls still use the same journal.
  response.once?.('finish', done)
  let result
  try { result = scope.run(current, operation) } catch (error) { response.removeListener?.('finish', done); done(); throw error }
  return Promise.resolve(result).finally(() => { response.removeListener?.('finish', done); done() })
}
function writeGroupStatus(current, attempt = 0) {
  const file = join(current.root, 'groups', current.groupId + '.status.json'), temp = file + '.' + process.pid + '.tmp'
  const group = current.group
  clearTimeout(group.retry)
  group.retry = undefined
  try {
    writeFileSync(temp, JSON.stringify({ protocol: 1, groupId: current.groupId, complete: group.finished && group.pending === 0, failed: group.failed, records: group.written, pending: group.pending, finished: group.finished }), { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, file)
  } catch (error) {
    // Windows may briefly deny replacement while another process reads the
    // receipt. Retry the latest state without blocking or poisoning valid usage.
    const delays = [10, 25, 50, 100, 200]
    if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code) && attempt < delays.length) {
      group.retry = setTimeout(() => writeGroupStatus(current, attempt + 1), delays[attempt])
      group.retry.unref?.()
    } else group.failed = true
  }
}
export function withBillionMeterKind(kind, operation) {
  const current = scope.getStore()
  return current ? scope.run({ ...current, kind }, operation) : operation()
}
export function withBillionMeterAttempt(attempt, operation) {
  const current = scope.getStore()
  return current ? scope.run({ ...current, attempt }, operation) : operation()
}

/** Read just the top-level model string without materializing another prompt object. */
function requestModel(body) {
  if (body instanceof Uint8Array) body = Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8')
  if (typeof body !== 'string') return null
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (char === '"') {
      const start = i
      while (++i < body.length) { if (body[i] === '\\') i++; else if (body[i] === '"') break }
      if (depth !== 1 || body.slice(start, i + 1) !== '"model"') continue
      let tail = i + 1
      while (/\s/.test(body[tail] ?? '') && tail < body.length) tail++
      if (body[tail++] !== ':') continue
      while (/\s/.test(body[tail] ?? '') && tail < body.length) tail++
      if (body[tail] !== '"') continue
      const end = tail + 1
      while (++tail < body.length) { if (body[tail] === '\\') tail++; else if (body[tail] === '"') break }
      try { const model = JSON.parse(body.slice(end - 1, tail + 1)); return modelId(model) ? model : null } catch { return null }
    } else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') depth--
  }
  return null
}
export function normalizeBillionUsage(protocol, usage) {
  if (!usage || typeof usage !== 'object') return null
  let input, output, cacheRead = 0, cacheWrite = 0, reasoning = 0
  if (protocol === 'anthropic') {
    input = usage.input_tokens; output = usage.output_tokens
    cacheRead = usage.cache_read_input_tokens ?? 0; cacheWrite = usage.cache_creation_input_tokens ?? 0
  } else if (protocol === 'google') {
    cacheRead = usage.cachedContentTokenCount ?? 0
    reasoning = usage.thoughtsTokenCount ?? 0
    input = usage.promptTokenCount
    output = usage.candidatesTokenCount
    if (count(output) && count(reasoning)) output += reasoning
    if (count(input) && count(cacheRead)) input -= cacheRead
  } else {
    const responses = protocol === 'responses'
    cacheRead = responses ? usage.input_tokens_details?.cached_tokens ?? 0 : usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0
    input = responses ? usage.input_tokens : usage.prompt_tokens
    output = responses ? usage.output_tokens : usage.completion_tokens
    reasoning = (responses ? usage.output_tokens_details : usage.completion_tokens_details)?.reasoning_tokens ?? 0
    if (count(input) && count(cacheRead)) input -= cacheRead
  }
  if (![input, output, cacheRead, cacheWrite, reasoning].every(count)) return null
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: reasoning }
}
export function beginBillionCall(url, options) {
  const current = scope.getStore()
  if (!current || String(options?.method ?? 'GET').toUpperCase() !== 'POST') return null
  try {
    const address = new URL(url)
    const path = address.pathname
    const protocol = /\/chat\/completions\/?$/.test(path) ? 'openai' : /\/messages\/?$/.test(path) ? 'anthropic'
      : /\/responses(?:\/compact)?\/?$/.test(path) ? 'responses' : /:(?:streamGenerateContent|generateContent)$/.test(path) ? 'google' : null
    if (!protocol) return null
    const model = requestModel(options.body) ?? (protocol === 'google' ? decodeURIComponent(path.match(/\/models\/([^/:]+):/)?.[1] ?? '') : null)
    if (!modelId(model)) return null
    current.group.pending++
    return { ...current, attempt: current.attempt ?? 1, callId: randomUUID(), model, protocol, upstream: address.origin, startedAtMs: Date.now(), usage: null, terminal: false, finished: false }
  } catch { return null }
}
function finish(call, status) {
  if (!call || call.finished) return
  call.finished = true
  let written = false
  try {
    const sessionKey = createHash('sha256').update(call.sessionId).digest('hex')
    const root = join(call.root, 'calls', sessionKey); safeDirectory(root)
    const file = join(root, producer + '.jsonl')
    try { const info = lstatSync(file); if (!info.isFile() || info.isSymbolicLink()) return } catch (error) { if (error.code !== 'ENOENT') return }
    const seq = (sequences.get(root) ?? 0) + 1
    const row = { protocol: 1, source: producer, seq, callId: call.callId, groupId: call.groupId, streamId: call.streamId, sessionId: call.sessionId,
      kind: call.kind, attempt: call.attempt, upstream: call.upstream, model: call.model, startedAtMs: call.startedAtMs, status, complete: call.terminal,
      usage: call.usage }
    const fd = openSync(file, 'a', 0o600)
    try {
      const bytes = Buffer.from('\n' + JSON.stringify(row) + '\n')
      let offset = 0
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset)
      fsyncSync(fd)
      sequences.set(root, seq)
      written = true
    } finally { closeSync(fd) }
  } catch { /* Metering failure never interrupts a model response. */ }
  finally {
    call.group.pending--
    if (written) call.group.written++
    else call.group.failed = true
    writeGroupStatus(call)
  }
}
export function failBillionCall(call) { finish(call, 'error') }
function observe(call, value) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { for (const part of value) observe(call, part); return }
  const message = value.type === 'message_start' ? value.message : value.response ?? value
  const raw = call.protocol === 'google' ? message.usageMetadata : message.usage
  if (raw && typeof raw === 'object') {
    call.rawUsage = { ...call.rawUsage, ...raw }
    call.usage = normalizeBillionUsage(call.protocol, call.rawUsage) ?? call.usage
  }
  if (value.type === 'message_stop' || value.type === 'message_delta' && value.usage?.output_tokens !== undefined
    || /^response\.(completed|incomplete|failed)$/.test(value.type ?? '')
    || call.protocol === 'openai' && raw?.completion_tokens !== undefined
    || call.protocol === 'google' && raw?.candidatesTokenCount !== undefined) call.terminal = true
}
export function meterBillionResponse(call, response) {
  if (!call) return response
  if (!response.body) { finish(call, 'complete'); return response }
  const sse = /text\/event-stream/i.test(response.headers.get('content-type') ?? '')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = '', dropping = false, eventData = '', dropEvent = false
  const event = () => {
    const data = eventData.trim()
    if (!dropEvent && data) {
      if (data === '[DONE]') call.terminal = true
      else { try { observe(call, JSON.parse(data)) } catch {} }
    }
    eventData = ''; dropEvent = false
  }
  const lineData = line => {
    if (line.trim() === '') { event(); return }
    if (!line.startsWith('data:')) return
    if (eventData.length + line.length > 512 * 1024) { dropEvent = true; eventData = ''; return }
    if (!dropEvent) eventData += (eventData ? '\n' : '') + line.slice(5).replace(/^ /, '')
  }
  const consume = text => {
    if (!sse) { if (!dropping && pending.length + text.length <= 4 * 1024 * 1024) pending += text; else { dropping = true; pending = '' } return }
    const lines = (pending + text).split('\n'); pending = lines.pop()
    for (const line of lines) {
      if (dropping) { dropping = false; continue }
      if (line.length > 512 * 1024) { dropEvent = true; continue }
      lineData(line)
    }
    if (pending.length > 512 * 1024) { pending = ''; dropping = true; dropEvent = true }
  }
  const body = new ReadableStream({ async pull(controller) {
    try {
      const result = await reader.read()
      if (!result.done) { consume(decoder.decode(result.value, { stream: true })); controller.enqueue(result.value); return }
      consume(decoder.decode())
      if (!sse && !dropping) { try { observe(call, JSON.parse(pending)); call.terminal = !!call.usage } catch {} }
      else if (sse) { if (pending) lineData(pending); event() }
      finish(call, 'complete'); controller.close()
    } catch (error) { finish(call, 'error'); controller.error(error) }
  }, async cancel(reason) { try { await reader.cancel(reason) } finally { finish(call, 'cancelled') } } })
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}
