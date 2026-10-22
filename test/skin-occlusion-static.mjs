// Check owned surfaces keep an opaque fallback and preserve skin RGB channels.
// Actual pixel occlusion, including fully transparent skins, is covered by
// skin-opacity-browser.mjs. Build-time CSS decoding is checked byte for byte.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const main = read('src/client/01-open-styles-i18n.js')
const statistics = read('src/statistics/index.js')
const pricing = read('src/pricing/index.js')
assert.ok(main.includes('body{--cm-opaque-base:#fff}'), 'light fallback is opaque')
assert.ok(main.includes('html[data-theme=dark] body{--cm-opaque-base:#151517}'), 'dark fallback is opaque')

for (const [source, selector] of [
  [main, '.cm-section'], [main, '.cm-stat-dialog'], [main, '.cm-qguide'],
  [main, '.cm-peak-alert'], [main, '.cm-footer-stack.simple'], [main, '.cm-simple-summary'],
  [statistics, '.cm-stat'], [statistics, 'dialog.cm-fee-dialog'],
  [statistics, '.cm-context-intro'], [statistics, '.cm-billion-notice'],
  [pricing, '.cm-combo-panel'],
]) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rules = [...source.matchAll(new RegExp(escaped + '(?=[,{])[^{}]*\\{([^{}]+)\\}', 'g'))]
  assert.ok(rules.some(([, body]) => body.includes('background:var(--cm-opaque-base,#fff);background:rgb(from ') && body.includes(' r g b / 1)')),
    selector + ' uses an opaque fallback and opaque skin RGB')
}
console.log('[ok] skin occlusion: all 11 owned surfaces have opaque backgrounds')
