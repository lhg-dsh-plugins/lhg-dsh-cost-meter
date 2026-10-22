// dsh-pocket 手机端适配静态门禁(W3):不启动浏览器,只检查构建产物里的响应式标记。
// 主包 CSS 经 scripts/build.mjs 的 cssPhrases token 打包,`max-width:` 在 lib/client.js
// 里显示为 `Ɛ`(运行时展开为 `max-width:`),所以用 `1023px` 子串判定,不要匹配
// `max-width: 1023px`;按需 chunk 内是字面形式。另一判据 `data-dsh-pocket-layout`
// 覆盖 dsh-pocket 的宽屏强制移动模式(body[data-dsh-pocket-layout="mobile"])。
// 同时复核 lib/client.js 的 DSH STORE 单文件字节门禁(< 262144)。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bundles = [
  '../lib/client.js',
  '../lib/client.codex.js',
  '../lib/client.statistics.js',
  '../lib/client.openrouter.js',
  '../lib/client.community.js',
  '../lib/client.pricing.js',
  '../lib/client.display.js',
]
const markers = ['1023px', 'data-dsh-pocket-layout']

for (const bundle of bundles) {
  const text = readFileSync(new URL(bundle, import.meta.url), 'utf8')
  const bytes = Buffer.byteLength(text, 'utf8')
  const matched = markers.filter(marker => text.includes(marker))
  assert.ok(matched.length > 0, `${bundle} 缺少 dsh-pocket 手机端适配标记(1023px / data-dsh-pocket-layout)`)
  if (bundle === '../lib/client.js') {
    assert.ok(bytes < 262144, `lib/client.js ${bytes} bytes 必须 < 262144 (DSH STORE per-file bound)`)
  }
  console.log(`[ok] dsh-pocket 手机端静态断言: ${bundle} (${bytes} bytes, 命中 ${matched.join(' + ')})`)
}
console.log('[ok] dsh-pocket 手机端适配:主包 + 6 个按需 chunk 均含窄屏/media 标记,lib/client.js 字节门禁通过')
