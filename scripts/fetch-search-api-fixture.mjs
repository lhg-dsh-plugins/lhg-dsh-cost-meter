// Fetch public upstream sources at an immutable commit; never a mutable branch.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
export const commit = '687f282e8625c6b8d11ff58211a90524be2e4317'
const destination = resolve(process.argv[2] ?? '.tmp-search-api-source')
await mkdir(destination, { recursive: true })
for (const file of ['search.ts', 'fetch.ts', 'transport.ts']) {
  const response = await fetch(`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${commit}/packages/web/web-deepseek-api/src/${file}`, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Upstream ${file}: HTTP ${response.status}`)
  const source = await response.text()
  if (source.length > 100000) throw new Error('Unexpected upstream source size')
  await writeFile(resolve(destination, file), source, 'utf8')
}
console.log(`Pinned DeepSeek Search/Fetch source ${commit} -> ${destination}`)
