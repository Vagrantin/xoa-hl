import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizePool, readInventory } from '../SOURCES/xoa-hl-xo-inventory.mjs'

const GIB = 1024 ** 3
function fixture() {
  const tables = {
    host: { h1: { name_label: 'one', cpu_info: { cpu_count: '4' }, enabled: true, metrics: 'hm1' }, h2: { name_label: 'two', cpu_info: { cpu_count: '8' }, enabled: false, metrics: 'hm2' } },
    host_metrics: { hm1: { live: true }, hm2: { live: false } },
    SR: { sr: { name_label: 'local', content_type: 'user', physical_size: String(100 * GIB), physical_utilisation: String(20 * GIB), virtual_allocation: String(40 * GIB), PBDs: ['pbd'], other_config: {} } },
    PBD: { pbd: { SR: 'sr', host: 'h1', currently_attached: true } },
    network: { net: { name_label: 'LAN', PIFs: ['pif'] } }, PIF: { pif: { network: 'net', host: 'h1', currently_attached: true } },
    VM: { tpl: { name_label: 'Alma', is_a_template: true, is_a_snapshot: false, is_control_domain: false, VBDs: ['vbd'] },
      old: { name_label: 'old-halted-vm', is_a_template: false, is_a_snapshot: false, is_control_domain: false, VBDs: [] } },
    VBD: { vbd: { VM: 'tpl', type: 'Disk', VDI: 'vdi' } }, VDI: { vdi: { SR: 'sr', missing: false } },
  }
  const xoObjects = Object.fromEntries(['h1', 'h2', 'sr', 'net', 'tpl', 'old'].map(ref => [ref, { id: 'id-' + ref, _xapiRef: ref, $pool: 'pool' }]))
  xoObjects.tpl.id = 'pool-scoped-default-template'
  return { poolId: 'pool', tables, freeMemory: { h1: String(6 * GIB) }, xoObjects }
}
function context(f = fixture()) {
  let calls = []
  const pool = { type: 'pool', id: 'pool' }
  const xo = {
    apiContext: { user: { id: 'admin', permission: 'admin' }, permission: 'admin' },
    getObjects: () => ({ pool, ...f.xoObjects }),
    getAllXenServers: async () => [{ status: 'connected', poolId: 'pool' }],
    getXapi: () => ({ status: 'connected', call: async (method, ref) => {
      calls.push([method, ref])
      return method === 'host.compute_free_memory' ? f.freeMemory[ref] : f.tables[method.split('.')[0]]
    } }),
  }
  return { xo, calls, f }
}

test('raw pinned-XAPI fields normalize units, scoped IDs and all VM names', () => {
  const data = normalizePool(fixture())
  assert.equal(data.hosts[0].memory_free_mb, 6144)
  assert.equal(data.hosts[1].running, false)
  assert.equal(data.hosts[1].memory_free_mb, 0)
  assert.equal(data.srs[0].free_gb, 60)
  assert.equal(data.templates[0].id, 'pool-scoped-default-template')
  assert.deepEqual(data.vms.map(vm => vm.name), ['Alma', 'old-halted-vm'])
})
test('sharing never implies attachment; template source disks restrict placement', () => {
  const f = fixture(); f.tables.SR.sr.shared = true
  const data = normalizePool(f)
  for (const array of [data.srs, data.networks, data.templates]) assert.deepEqual(array[0].eligible_hosts, ['id-h1'])
  f.tables.PBD.pbd.currently_attached = false
  assert.deepEqual(normalizePool(f).templates[0].eligible_hosts, [])
})
test('internal/unplugged networks never claim connectivity', () => {
  const f = fixture(); f.tables.PIF.pif.currently_attached = false
  assert.deepEqual(normalizePool(f).networks[0].eligible_hosts, [])
  f.tables.network.net.PIFs = []
  assert.deepEqual(normalizePool(f).networks[0].eligible_hosts, [])
})
test('missing source disk, maintenance and ISO storage cannot be selected', () => {
  const f = fixture(); f.tables.VDI.vdi.missing = true
  assert.deepEqual(normalizePool(f).templates[0].eligible_hosts, [])
  f.tables.SR.sr.other_config['xo:maintenanceState'] = 'maintenance'
  assert.deepEqual(normalizePool(f).srs, [])
  delete f.tables.SR.sr.other_config['xo:maintenanceState']; f.tables.SR.sr.content_type = 'iso'
  assert.deepEqual(normalizePool(f).srs, [])
})
test('truncated relationships and mismatched backlinks fail closed', () => {
  for (const change of [f => delete f.tables.VDI.vdi, f => delete f.tables.host_metrics.hm1,
    f => { f.tables.PBD.pbd.SR = 'other' }, f => { f.tables.PIF.pif.network = 'other' },
    f => { f.tables.VBD.vbd.VM = 'other' }, f => delete f.xoObjects.tpl,
    f => { f.tables.network.net.PIFs = ['pif', 'pif'] }]) {
    const f = fixture(); change(f); assert.throws(() => normalizePool(f), /inventory_unavailable/)
  }
})
test('unknown/nonfinite/malformed capacity is never coerced to zero', () => {
  for (const value of [NaN, Infinity, -1, true, null, undefined, '', '1e3', ' 99', 'NaN', String(2 ** 55)]) {
    const f = fixture(); f.freeMemory.h1 = value
    assert.throws(() => normalizePool(f), /inventory_unavailable/, String(value))
  }
})
test('authoritative adapter uses only complete read methods and stamps before reads', async () => {
  const { xo, calls } = context()
  const result = await readInventory(xo, { clock: () => 100 })
  assert.equal(result.observed_at, 100); assert.equal(result.complete, true); assert.equal(result.version, 2)
  assert.equal(calls.length, 10)
  assert(calls.every(([method]) => method.endsWith('.get_all_records') || method === 'host.compute_free_memory'))
  assert.deepEqual(calls.at(-1), ['host.compute_free_memory', 'h1'])
})
test('caller authentication and admin restriction run before inventory access', async () => {
  for (const auth of [undefined, {}, { user: { id: 'a', permission: 'read' }, permission: 'read' }]) {
    const { xo, calls } = context(); xo.apiContext = auth
    await assert.rejects(readInventory(xo), /inventory_unavailable/); assert.equal(calls.length, 0)
  }
})
test('disconnect, unrepresented registered pool and API failure fail closed/redacted', async () => {
  for (const change of [xo => { xo.getXapi = () => ({ status: 'disconnected' }) },
    xo => { xo.getAllXenServers = async () => [{ status: 'disconnected' }] },
    xo => { xo.getXapi = () => ({ status: 'connected', call: async () => { throw new Error('secret-token') } }) }]) {
    const { xo } = context(); change(xo)
    await assert.rejects(readInventory(xo), { message: 'inventory_unavailable' })
  }
})
test('timeout never returns a partial complete snapshot', async () => {
  const { xo } = context(); xo.getXapi = () => ({ status: 'connected', call: () => new Promise(() => {}) })
  await assert.rejects(readInventory(xo, { timeoutMs: 10 }), { message: 'inventory_unavailable' })
})
test('changed pool set, elapsed freshness and lost privilege cannot pass completeness', async () => {
  const { xo } = context(); let count = 0
  const get = xo.getObjects
  xo.getObjects = () => count++ === 0 ? get() : { ...get(), other: { id: 'other', type: 'pool' } }
  await assert.rejects(readInventory(xo), /inventory_unavailable/)
  const c = context(); let now = 100
  c.xo.getAllXenServers = async () => { now = 131; return [{ status: 'connected', poolId: 'pool' }] }
  await assert.rejects(readInventory(c.xo, { clock: () => now }), /inventory_unavailable/)
  const d = context(); d.xo.getAllXenServers = async () => { d.xo.apiContext.permission = 'read'; return [] }
  await assert.rejects(readInventory(d.xo), /inventory_unavailable/)
})
