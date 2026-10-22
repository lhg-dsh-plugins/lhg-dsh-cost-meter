import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { javascriptLiteral } from '../scripts/javascript-literal.mjs'

// Injection payloads stay data, including a mixed-case HTML script terminator,
// quotes, backslashes, control characters and JavaScript line separators.
const values = [
  '</script><script>globalThis.injected=true</script>',
  '</ScRiPt><!-- & >',
  'quotes: "\'\\\n\r\t\0\u2028\u2029',
  { zh: '中文', en: '</script>', nested: ['\u0180\u027f', '<>&'], missing: null },
]
for (const value of values) {
  const literal = javascriptLiteral(value)
  assert.doesNotMatch(literal, /[<>&\u2028\u2029]/, 'generated literal cannot terminate an HTML script element')
  const context = {}
  runInNewContext('globalThis.data = ' + literal, context)
  assert.deepEqual(JSON.parse(JSON.stringify(context.data)), value, 'escaping must preserve the complete value')
  assert.equal(context.injected, undefined, 'payload must not execute')
}
console.log('[ok] JavaScript literal escaping preserves values and neutralizes script terminators and line separators')
