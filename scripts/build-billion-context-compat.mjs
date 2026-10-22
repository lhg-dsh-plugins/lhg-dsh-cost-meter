/** Generate a local compatibility build when upstream metering contracts match. */
import { readFileSync, writeFileSync, cpSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { patchBillionRuntime } from './billion-context-patch.mjs'
import { billionVersionSupported, billionCompatibilityError } from '../lib/billion-context-compatibility.js'

const sourceRoot = resolve(import.meta.dirname, '..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function buildBillionCompatibility(input, destination, { pack = true } = {}) {
  const stage = mkdtempSync(join(tmpdir(), 'dsh-billion-compat-')), target = join(stage, 'package')
  if (input.endsWith('.tgz')) {
    const entries = execFileSync('tar', ['-tzf', resolve(input)], { encoding: 'utf8' }).trim().split(/\r?\n/)
    if (entries.some(name => !name.startsWith('package/') || name.includes('\\') || name.includes(':') || name.split('/').includes('..'))) throw Error('Unsafe npm archive paths')
    const listing = execFileSync('tar', ['-tvzf', resolve(input)], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    if (listing.split(/\r?\n/).some(line => /^[lh]/.test(line))) throw Error('Linked entries are unsupported')
    execFileSync('tar', ['-xzf', resolve(input), '-C', stage])
  } else cpSync(resolve(input), target, { recursive: true, filter: path => !['node_modules', '.git'].includes(path.split(/[\\/]/).at(-1)) })
  const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  if (pkg.name !== 'billion-context') throw Error('Expected a billion-context npm package')
  if (billionVersionSupported(pkg.version) !== true) throw billionCompatibilityError('version_too_old')
  if (pkg.dshCostMeterCompatibility) throw billionCompatibilityError('metering_already_present')
  const baseVersion = pkg.version, sourceHashes = {}, capabilities = {}
  const proxyPath = join(target, 'dist/index.js'), nativePath = join(target, 'dist/agent/dsh-native.js')
  for (const [file, kind] of [['dist/index.js', 'proxy'], ['dist/agent/dsh-native.js', 'native']]) {
    const bytes = readFileSync(join(target, file))
    sourceHashes[file] = hash(bytes)
    const result = patchBillionRuntime(bytes.toString('utf8'), kind)
    capabilities[kind] = result.capabilities
    if (kind === 'proxy') writeFileSync(proxyPath, result.source)
    else writeFileSync(nativePath, result.source)
  }
  cpSync(join(sourceRoot, 'lib/billion-context-proxy.js'), join(target, 'dist/cost-meter-proxy.js'))
  cpSync(join(sourceRoot, 'lib/billion-context-native.js'), join(target, 'dist/agent/cost-meter-native.js'))
  for (const file of ['dist/index.js', 'dist/agent/dsh-native.js', 'dist/cost-meter-proxy.js', 'dist/agent/cost-meter-native.js']) execFileSync(process.execPath, ['--check', join(target, file)], { stdio: 'pipe' })
  const base = baseVersion.split('+')[0]
  pkg.version = base + (base.includes('-') ? '.' : '-') + 'cost-meter.1'
  pkg.dshCostMeterCompatibility = { protocol: 1, adapter: 2, baseVersion, sourceHashes, capabilities }
  writeFileSync(join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  if (!pack) return { directory: target, version: pkg.version, baseVersion, capabilities }
  mkdirSync(resolve(destination), { recursive: true })
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  if (!existsSync(npmCli)) throw Error('Set npm_execpath to npm-cli.js to build the local archive')
  const output = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', resolve(destination)], {
    cwd: target, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }))[0]
  return { directory: target, version: pkg.version, baseVersion, capabilities, archive: join(resolve(destination), output.filename), sha256: hash(readFileSync(join(resolve(destination), output.filename))) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2] || !process.argv[3]) throw Error('Usage: node scripts/build-billion-context-compat.mjs <original npm archive or directory> <output directory>')
  console.log(JSON.stringify(await buildBillionCompatibility(process.argv[2], process.argv[3])))
}