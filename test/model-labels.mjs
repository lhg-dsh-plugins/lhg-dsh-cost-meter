import assert from 'node:assert/strict'
import { createModelLabelReader } from '../lib/model-labels.js'
const read = createModelLabelReader(), calls = []
const llm = { listProviders: () => [{ id: 'qoder', name: 'Qoder' }, { id: 'qoder-global', name: 'Qoder Global' }],
  listModels: async provider => { calls.push(provider); return [{ provider, id: 'dfmodel', name: 'DeepSeek-Flash' }, { provider: 'other', id: 'wrong', name: 'Wrong' }] } }
const keys = ['qoder:dfmodel', 'qoder-global:dfmodel', 'qoder:missing', 'qoder:wrong']
const [a, b] = await Promise.all([read(llm, keys), read(llm, keys)])
assert.deepEqual(a, { 'qoder:dfmodel': 'Qoder:DeepSeek-Flash', 'qoder-global:dfmodel': 'Qoder Global:DeepSeek-Flash' })
assert.deepEqual(a, b); assert.equal(calls.length, 2)
await read(llm, keys); assert.equal(calls.length, 2)
assert.deepEqual(await read({}, keys), {})
assert.deepEqual(await read({ listModels: () => { throw Error('removed') } }, keys), {})
assert.equal((await read({ ...llm, listModels: async provider => [{ provider, id: 'dfmodel', name: 'Renamed' }] }, keys))['qoder:dfmodel'], 'Qoder:Renamed')
console.log('[ok] #335 adapter model/provider display names, route isolation, shared cache, missing metadata and service replacement')
const inventory = createModelLabelReader()
let providers = [{ id: 'current', name: 'Current' }, { id: 'deleted', name: 'Deleted' }], models = [{ id: 'keep', name: 'Keep' }, { id: 'removed', name: 'Removed' }]
const directory = { listProviders: () => providers, listModels: async () => models }
const requested = ['current:keep', 'current:removed', 'deleted:old']
assert.deepEqual((await inventory(directory, requested, true)).availability.missingModels, ['deleted:old'])
providers = providers.slice(0, 1)
let snapshot = await inventory(directory, requested, true)
assert.deepEqual(snapshot.availability.providers, ['current'])
assert.ok(!snapshot.labels['deleted:old'])
models = [models[0]]; inventory.clear()
snapshot = await inventory(directory, requested, true)
assert.deepEqual(snapshot.availability.missingModels, ['current:removed'])
const failed = await inventory({ listProviders: () => [{ id: 'current' }], listModels: async () => { throw Error('offline') } }, requested, true)
assert.deepEqual(failed.availability.missingModels, [], 'failed metadata requests cannot hide every model as if the directory were empty')
assert.ok(!('availability' in await inventory({}, requested, true)), 'old hosts retain the historical list when inventory is unavailable')
console.log('[ok] live provider/model removal, topology invalidation and unavailable directory fallback')
