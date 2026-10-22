// Exact host setting names come from the upstream WebSearchCard controller.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createNativeSearchBilling } from '../lib/native-search-billing.js'
import { SERVER_SEARCH_BILLING_START, WEB_REQUEST_RATE_CNY, nativeServerSearchFees, validRequestFee } from '../lib/web-request-pricing.js'
import { nativeSearchRecordsFor, recordNativeSearchUsage } from '../lib/native-search-history.js'
import { replaySessionRecords } from '../lib/backfill.js'
import { costFromSamples } from '../lib/turn-cost.js'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { turnCostSchema, stateSchema } from '../lib/typert.host.js'

const body = { model:'deepseek-v4.1-flash',usage:{input_tokens:100,output_tokens:20},content:[
  {type:'web_search_tool_result',tool_use_id:'search-1',content:[{type:'web_search_result',url:'https://private.test/one'},{type:'web_search_result',url:'https://private.test/two'}]},
  {type:'web_search_tool_result',tool_use_id:'search-1',content:[{type:'web_search_result',url:'https://private.test/duplicate'}]},
  {type:'web_search_tool_result',tool_use_id:'empty',content:[]},
] }
for (const at of [SERVER_SEARCH_BILLING_START-1,SERVER_SEARCH_BILLING_START]) {
  const fees=nativeServerSearchFees(body,at)
  assert.equal(fees.length,1,'one successful tool invocation, not one fee per returned result')
  assert.equal(fees[0].requestFee.rateCny,at<SERVER_SEARCH_BILLING_START?0:WEB_REQUEST_RATE_CNY)
  assert.equal(validRequestFee(fees[0].requestFee,at),true)
  assert.equal(validRequestFee({...fees[0].requestFee,rateCny:at<SERVER_SEARCH_BILLING_START?WEB_REQUEST_RATE_CNY:0},at),false)
}
let selection={searchProvider:'deepseek-official',fetchProvider:'http'},at=Date.parse('2026-10-19T12:00:00+08:00'),payload=body
const captured=[],root=mkdtempSync(join(tmpdir(),'cm-search-versions-')),path=join(root,'ledger.json'),session={id:'versions'}
const target={fetch:async()=>({ok:true,status:200,json:async()=>payload})}
const monitor=createNativeSearchBilling({now:()=>at,selection:()=>selection,fetchTarget:target,diagnostics:()=>({subscribe(){},unsubscribe(){}}),
  account:event=>captured.push(event),record:(owner,event)=>recordNativeSearchUsage(path,owner.id,event)})
try {
  await monitor.run(async()=>{
    const result=await target.fetch('https://api.deepseek.com/anthropic/v1/messages',{method:'POST'})
    selection={searchProvider:'deepseek-search-api',fetchProvider:'deepseek-fetch-api'}
    await result.json()
  },session)
  assert.equal(captured[0].webSource,'messages')
  assert.equal(captured[0].webSelection,'deepseek-official','in-flight calls retain the setting from their own start')
  assert.equal(captured[1].requestFee.rateCny,0)
  payload={results:[{title:'PRIVATE',url:'https://private.test/query'}]}
  await monitor.run(()=>target.fetch('https://api.deepseek.com/v1/tools/search',{method:'POST'}).then(r=>r.json()),session)
  assert.equal(captured[2].webSource,'search-api')
  assert.equal(captured[2].model,'deepseek-search-api')
  assert.equal(captured[2].webSelection,'deepseek-search-api')
  assert.equal(captured[2].requestFee.rateCny,.005,'direct API uses the standard request fee during the server-tool waiver')
  const rows=await nativeSearchRecordsFor(path,session.id)
  assert.equal(rows.length,3)
  const samples=replaySessionRecords([{type:'session',id:session.id},...rows],sanitizeConfig({}),null,true).samples
  const detail=turnCostSchema.parse(costFromSamples(samples,sanitizeConfig({})))
  assert.deepEqual(detail.calls.map(row=>row.webSource).sort(),['messages','messages','search-api'])
  assert.ok(detail.calls.some(row=>row.rows.some(part=>part.requests===1&&part.rate===0)))
  for (const mode of ['cost','tokens','both']) {
    const patch=applyConfigPatch(sanitizeConfig({}),{sidebarTodayMetric:mode,sidebarOrder:['today','plan:clinepass','balance','models']})
    assert.deepEqual(patch.errors,[]);assert.equal(stateSchema.shape.config.parse(patch.config).sidebarTodayMetric,mode)
  }
  for (const sidebarOrder of [['today','today'],['unknown'],Array(65).fill('today')]) assert.ok(applyConfigPatch(sanitizeConfig({}),{sidebarOrder}).errors.length)
  console.log('[ok] search versions: exact host settings, in-flight snapshots, Messages tokens, direct API fees, Nov 1 boundary, request deduplication, historical wire and sidebar config')
} finally {monitor.dispose();rmSync(root,{recursive:true,force:true})}
