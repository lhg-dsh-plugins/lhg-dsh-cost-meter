/** Source-preserving hooks: inspect executable syntax without running upstream code. */
import { parse } from 'acorn'
import { billionCompatibilityError } from './billion-context-compatibility.js'

const check = (value, reason) => { if (!value) throw billionCompatibilityError(reason) }
function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parents)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit, [...parents, node])
    else if (value && typeof value.type === 'string') walk(value, visit, [...parents, node])
  }
}
const calls = (node, name) => {
  const found = []
  walk(node, (item, parents) => { if (item.type === 'CallExpression' && item.callee.type === 'Identifier' && item.callee.name === name) found.push({ item, parents }) })
  return found
}
export function patchBillionRuntime(source, kind, helpers = {}) {
  check(!source.includes('__dshCm'), 'metering_already_present')
  let ast
  try { ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest' }) }
  catch { throw billionCompatibilityError('runtime_syntax_changed') }
  const functions = ast.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node).filter(node => node?.type === 'FunctionDeclaration')
  const edits = [], capabilities = {}
  const fn = (name, optional = false) => {
    const hits = functions.filter(node => node.id?.name === name)
    check(hits.length === 1 || optional && hits.length === 0, 'function_changed:' + name)
    return hits[0]
  }
  const wrap = (node, declaration) => {
    check(node.params.every(param => param.type === 'Identifier') && !node.generator, 'function_contract_changed:' + node.id.name)
    check(calls(node.body, node.id.name).length === 0, 'recursive_contract_changed:' + node.id.name)
    edits.push({ start: node.start, end: node.start, text: declaration + '\n' }, { start: node.id.start, end: node.id.end, text: '__dshCmOriginal_' + node.id.name })
  }
  const withAttempts = node => {
    const found = calls(node.body, 'fetchWithTimeout')
    check(found.length > 0 && calls(node.body, 'fetch').length === 0, 'retry_transport_changed:' + node.id.name)
    for (const { item, parents } of found) {
      const loop = [...parents].reverse().find(parent => parent.type === 'ForStatement' && parent.init?.type === 'VariableDeclaration'
        && parent.init.declarations.some(declaration => declaration.id.type === 'Identifier' && declaration.id.name === 'attempt'))
      check(loop && !item.optional, 'retry_attempt_changed:' + node.id.name)
      edits.push({ start: item.start, end: item.end, text: '__dshCmAttempt(attempt, () => ' + source.slice(item.start, item.end) + ')' })
    }
    return found.length
  }
  let imports
  if (kind === 'proxy') {
    const fetch = fn('fetchWithTimeout')
    check(fetch.async && fetch.params.length >= 2, 'fetch_contract_changed')
    let responses = 0
    walk(fetch.body, node => {
      if (node.type === 'ReturnStatement' && node.argument?.type === 'ObjectExpression') {
        const keys = node.argument.properties.map(prop => prop.key?.name ?? prop.key?.value)
        if (keys.includes('response') && keys.includes('clearTimer')) responses++
      }
    })
    check(responses > 0, 'fetch_result_changed')
    wrap(fetch, 'async function fetchWithTimeout(...args) { const call = __dshCmBegin(args[0], args[1]); try { const result = await __dshCmOriginal_fetchWithTimeout(...args); result.response = __dshCmResponse(call, result.response); return result; } catch (error) { __dshCmFail(call); throw error; } }')
    const handle = fn('handle')
    check(handle.async && handle.params.length >= 2, 'request_contract_changed')
    wrap(handle, 'function handle(...args) { return __dshCmRequest(args[0], args[1], () => __dshCmOriginal_handle(...args)); }')
    const summary = fn('requestSummaryBody')
    check(summary.async && summary.params.length >= 2, 'summary_contract_changed')
    wrap(summary, 'function requestSummaryBody(...args) { return __dshCmKind("compaction", () => __dshCmOriginal_requestSummaryBody(...args)); }')
    capabilities.summaryRetries = withAttempts(summary)
    capabilities.requestRetries = withAttempts(fn('fetchWithRetry'))
    const candidate = fn('createSummaryHttpCandidate', true)
    if (candidate) {
      let summarizes = false
      walk(candidate.body, node => { if (node.type === 'Property' && (node.key?.name ?? node.key?.value) === 'summarize') summarizes = true })
      check(summarizes, 'summary_candidate_changed')
      wrap(candidate, 'function createSummaryHttpCandidate(...args) { const candidate = __dshCmOriginal_createSummaryHttpCandidate(...args); return { ...candidate, summarize: (...work) => __dshCmKind("compaction", () => candidate.summarize(...work)) }; }')
    }
    capabilities.summaryCandidate = !!candidate
    imports = `import { meterBillionRequest as __dshCmRequest, beginBillionCall as __dshCmBegin, meterBillionResponse as __dshCmResponse, failBillionCall as __dshCmFail, withBillionMeterKind as __dshCmKind, withBillionMeterAttempt as __dshCmAttempt } from ${JSON.stringify(helpers.proxy ?? "./cost-meter-proxy.js")};\n`
  } else {
    check(kind === 'native', 'unknown_runtime_kind')
    const native = fn('installNativeFetchIntercept'), found = calls(native.body, 'send')
    let accessor = false
    walk(native.body, node => {
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'Object'
        && node.callee.property.name === 'defineProperty' && node.arguments[1]?.value === 'fetch') accessor = true
    })
    const chains = calls(native.body, 'installFetchChain').length
    check(found.length > 0 && (chains === 1 || chains === 0 && accessor && calls(native.body, 'makeChain').length > 0)
      && calls(native.body, 'fetch').length === 0, 'native_transport_changed')
    for (const { item } of found) {
      check(item.arguments.length >= 1 && !item.optional, 'native_send_changed')
      edits.push({ start: item.start, end: item.end, text: '__dshCmSend(send, ' + item.arguments.map(argument => source.slice(argument.start, argument.end)).join(', ') + ')' })
    }
    capabilities.nativeSends = found.length
    capabilities.nativeTransport = chains ? 'chain' : 'global-fetch-accessor'
    imports = `import { sendWithBillionMeter as __dshCmSend } from ${JSON.stringify(helpers.native ?? "./cost-meter-native.js")};\n`
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end)
  for (let i = 1; i < edits.length; i++) check(edits[i].end <= edits[i - 1].start, 'overlapping_runtime_hooks')
  for (const edit of edits) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
  const offset = source.startsWith('#!') ? source.indexOf('\n') + 1 : 0
  source = source.slice(0, offset) + imports + source.slice(offset)
  try { parse(source, { sourceType: 'module', ecmaVersion: 'latest' }) }
  catch { throw billionCompatibilityError('patched_syntax_changed') }
  return { source, capabilities }
}
