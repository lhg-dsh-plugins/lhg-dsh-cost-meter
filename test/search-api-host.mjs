// The actual new upstream Search/Fetch providers, real DSH registry and a local
// transport. No production key, account or paid request is used.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { installNativeSearchBilling } from '../lib/native-search-billing.js'
import { nativeSearchRecordsFor } from '../lib/native-search-history.js'
import { Ledger, sanitizeConfig } from '../lib/store.js'

const source = resolve(process.argv[2] ?? '.tmp-search-api-source')
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__search_api.cjs'))
const load = name => import(pathToFileURL(req.resolve(name)).href)
await build({ stdin: { contents: "export {DeepSeekSearchApiProvider} from './search.ts';export {DeepSeekFetchApiProvider} from './fetch.ts'", resolveDir: source },
  outfile: join(source, 'providers.mjs'), bundle: true, platform: 'node', format: 'esm',
  plugins: [{ name: 'actual-host', setup(build) { build.onResolve({ filter: /^@deepseek-ai\// }, args => ({ path: pathToFileURL(req.resolve(args.path)).href, external: true })) } }] })
const [{ DeepSeekSearchApiProvider, DeepSeekFetchApiProvider }, { Context }, { default: Web }, { Agent, getGlobalDispatcher, setGlobalDispatcher }] = await Promise.all([
  import(pathToFileURL(join(source, 'providers.mjs')).href), load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-web'), load('undici')])
const root = mkdtempSync(join(tmpdir(), 'cm-new-search-host-')), ctx = new Context(), session = { id: 'search-api-host' }
const ledger = new Ledger(sanitizeConfig({ exchangeRate: 7.2 }), {}, join(root, 'ledger.json'))
let status = 200, empty = false
const seen = []
const server = createServer((request, response) => {
  request.resume();seen.push(request.url)
  assert.ok(['/v1/tools/search', '/v1/tools/fetch'].includes(request.url))
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(status !== 200 ? { error:{message:'synthetic failure'} } : request.url.endsWith('/search') ? { results: empty ? [] : [
    {title:'Fixture',url:'https://example.test/result',snippet:'Snippet',summary:'Summary',content:'',rerank_score:2,site_name:null,site_icon:null,date:null,authority:2},
  ] } : { title:'Fixture',content:empty?'':'# Synthetic page' }))
})
server.listen(0,'127.0.0.1');await once(server,'listening')
const previous = getGlobalDispatcher(), dispatcher = new Agent({ connect(options, callback) {
  assert.equal(options.hostname,'api.deepseek.com')
  const socket=connect(server.address().port,'127.0.0.1');socket.once('connect',()=>callback(null,socket));socket.once('error',callback)
} })
setGlobalDispatcher(dispatcher)
try {
  ctx.provide('agents',{currentInitiator:()=>({session})})
  await ctx.plugin(Web)
  const selection={searchProvider:'deepseek-search-api',fetchProvider:'deepseek-fetch-api'}
  ctx.provide('settings',{get:namespace=>{assert.equal(namespace,'web');return selection}})
  const options=()=>({apiKey:'synthetic-key',baseURL:'https://api.deepseek.com/v1/tools',count:5})
  ctx.web.registerSearchProvider(new DeepSeekSearchApiProvider(options))
  ctx.web.registerFetchProvider(new DeepSeekFetchApiProvider(options))
  await ctx.plugin(installNativeSearchBilling,ledger)
  const search=await ctx.web.search({query:'synthetic query'})
  assert.equal(search.sources.length,1)
  const page=await ctx.web.fetch({url:'https://example.test/result'})
  assert.match(JSON.stringify(page),/Synthetic page/)
  assert.ok(Math.abs(ledger.sumDays().costCny-.01)<1e-10)
  assert.equal(ledger.sumDays().input,0)
  const records=await nativeSearchRecordsFor(ledger.path,session.id)
  assert.deepEqual(records.map(row=>row.data.webSource).sort(),['fetch-api','search-api'])
  assert.deepEqual(records.map(row=>row.data.webSelection).sort(),['deepseek-fetch-api','deepseek-search-api'])
  empty=true;await ctx.web.search({query:'empty'});await ctx.web.fetch({url:'https://example.test/empty'}).catch(()=>{})
  status=429;await ctx.web.search({query:'limited'}).catch(()=>{})
  assert.equal(ledger.sumDays().calls,2,'empty responses and rate limits create no request charge')
  assert.equal(seen.length,5)
  console.log('[ok] pinned upstream new Search/Fetch providers: real DSH registry, settings, loopback transport, request fees, no fake tokens, empty/failure and persistent versions')
} finally {
  await ctx.fiber.dispose();ledger.close();setGlobalDispatcher(previous);await dispatcher.close()
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true})
}
