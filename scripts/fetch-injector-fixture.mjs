// Public upstream reload code at an immutable commit, used only by isolated tests.
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const commit = 'e2fca6e2dc5d926bb33fbd1376780bb5e93f4974'
const destination = resolve('.tmp-injector-fixture')
const response = await fetch(`https://raw.githubusercontent.com/yjh051108/dsh-super-injector/${commit}/src/index.ts`, { redirect: 'error', signal: AbortSignal.timeout(30000) })
if (!response.ok) throw Error('Injector fixture HTTP ' + response.status)
const chunks = []; let size = 0
for await (const chunk of response.body) {
  size += chunk.length
  if (size > 262144) throw Error('Injector fixture exceeds size limit')
  chunks.push(chunk)
}
const bytes = Buffer.concat(chunks)
if (createHash('sha256').update(bytes).digest('hex') !== '188ef74a3b507be3fab437f2e442f23bad9172068fe972d19fb9303f2900cdbd') throw Error('Injector fixture integrity mismatch')
await mkdir(destination, { recursive: true })
await writeFile(resolve(destination, 'index.ts'), bytes)
console.log('Pinned super-injector reload fixture: ' + commit)
