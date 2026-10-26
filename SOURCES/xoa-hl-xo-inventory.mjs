// XO 5.113.2/e281c536 adapter. These are XAPI reads through XO's existing
// connections; no service token, browser-supplied facts or mutation method.
const TABLES = ['host', 'host_metrics', 'SR', 'PBD', 'network', 'PIF', 'VM', 'VBD', 'VDI']
const MIB = 1024 ** 2, GIB = 1024 ** 3
const fail = () => { throw new Error('inventory_unavailable') }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : fail()
function amount(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) fail()
  const result = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(result) || result < 0) fail()
  return result
}
function flag(value) { if (typeof value !== 'boolean') fail(); return value }
function entries(value) { if (!record(value)) fail(); return Object.entries(value) }
function refs(value) { if (!Array.isArray(value) || value.some(ref => typeof ref !== 'string') || new Set(value).size !== value.length) fail(); return value }
function lookup(table, ref) { if (!Object.hasOwn(table, ref) || !record(table[ref])) fail(); return table[ref] }
const present = ref => typeof ref === 'string' && ref !== 'OpaqueRef:NULL'

// Public for deterministic tests. Input is private adapter data, never an API
// parameter. IDs come from XO's own mapping (including pool-scoped defaults).
export function normalizePool({ poolId, tables, freeMemory, xoObjects }) {
  text(poolId)
  for (const table of TABLES) for (const [, value] of entries(tables[table])) if (!record(value)) fail()
  const { host, host_metrics: metrics, SR, PBD, network, PIF, VM, VBD, VDI } = tables
  const ids = new Map()
  for (const object of Object.values(xoObjects)) {
    if (object.$pool !== poolId || !present(object._xapiRef)) continue
    if (ids.has(object._xapiRef)) fail()
    ids.set(object._xapiRef, text(object.id))
  }
  const id = ref => ids.get(ref) ?? fail()
  const hostIds = entries(host).map(([ref]) => id(ref))
  if (new Set(hostIds).size !== hostIds.length) fail()
  const hosts = entries(host).map(([ref, item]) => {
    const running = flag(lookup(metrics, item.metrics).live)
    const cpus = amount(item.cpu_info?.cpu_count)
    if (cpus < 1) fail()
    return { id: id(ref), name: text(item.name_label), cpus, enabled: flag(item.enabled), running,
      memory_free_mb: running ? amount(freeMemory[ref]) / MIB : 0 }
  })
  const storageHosts = new Map()
  for (const [ref, item] of entries(SR)) {
    const eligible = []
    for (const pbdRef of refs(item.PBDs)) {
      const pbd = lookup(PBD, pbdRef)
      if (pbd.SR !== ref) fail()
      lookup(host, pbd.host)
      if (flag(pbd.currently_attached)) eligible.push(id(pbd.host))
    }
    storageHosts.set(ref, [...new Set(eligible)].sort())
  }
  const srs = entries(SR).filter(([, item]) => item.content_type === 'user' && item.other_config?.['xo:maintenanceState'] === undefined).map(([ref, item]) => {
    const size = amount(item.physical_size), physical = amount(item.physical_utilisation), allocated = amount(item.virtual_allocation)
    // Conservative: do not promise thin-provisioned space already allocated.
    return { id: id(ref), name: text(item.name_label), free_gb: Math.max(0, size - Math.max(physical, allocated)) / GIB,
      eligible_hosts: storageHosts.get(ref) }
  })
  const networks = entries(network).map(([ref, item]) => {
    const eligible = []
    for (const pifRef of refs(item.PIFs)) {
      const pif = lookup(PIF, pifRef)
      if (pif.network !== ref) fail()
      lookup(host, pif.host)
      if (flag(pif.currently_attached)) eligible.push(id(pif.host))
    }
    // Internal networks have no proven attachment here and remain ineligible.
    return { id: id(ref), name: text(item.name_label), eligible_hosts: [...new Set(eligible)].sort() }
  })
  const templates = [], vms = []
  for (const [ref, item] of entries(VM)) {
    const name = text(item.name_label)
    flag(item.is_a_template); flag(item.is_a_snapshot); flag(item.is_control_domain)
    // Include halted/old VMs, controllers, snapshots and templates for collision
    // checks; recent history cannot establish uniqueness.
    vms.push({ name })
    if (!item.is_a_template || item.is_a_snapshot || item.is_control_domain) continue
    let eligible = new Set(hostIds)
    for (const vbdRef of refs(item.VBDs)) {
      const vbd = lookup(VBD, vbdRef)
      if (vbd.VM !== ref || !['CD', 'Disk'].includes(vbd.type)) fail()
      if (vbd.type !== 'Disk') continue
      const vdi = lookup(VDI, vbd.VDI)
      const reachable = storageHosts.get(vdi.SR) ?? fail()
      if (flag(vdi.missing)) eligible.clear()
      eligible = new Set([...eligible].filter(value => reachable.includes(value)))
    }
    templates.push({ id: id(ref), name, eligible_hosts: [...eligible].sort() })
  }
  return { hosts, srs, networks, templates, vms }
}

function requireAdmin(xo) {
  if (xo.apiContext?.user?.permission !== 'admin' || xo.apiContext.permission !== 'admin') fail()
}

export async function readInventory(xo, { clock = () => Date.now() / 1000, timeoutMs = 20000 } = {}) {
  requireAdmin(xo)
  const observed_at = clock()
  const data = { hosts: [], srs: [], networks: [], templates: [], vms: [] }
  let timer, expired = false
  const checkDeadline = () => { if (expired || clock() - observed_at > timeoutMs / 1000) fail() }
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('inventory_unavailable')) }, timeoutMs) })
  try {
    return await Promise.race([timeout, (async () => {
      const initial = xo.getObjects(), pools = Object.values(initial).filter(object => object.type === 'pool')
      const poolIds = pools.map(pool => text(pool.id)).sort()
      const servers = await xo.getAllXenServers()
      // A disconnected registered pool could hide old VMs/name collisions.
      // Multiple registered endpoints for a pool are allowed if one is healthy.
      if (!Array.isArray(servers) || servers.some(server => server.status !== 'connected' && !poolIds.includes(server.poolId))) fail()
      for (const pool of pools) {
        const xapi = xo.getXapi(pool)
        if (!xapi || xapi.status !== 'connected') fail()
        const tables = Object.create(null), freeMemory = Object.create(null)
        for (const table of TABLES) {
          checkDeadline()
          tables[table] = await xapi.call(table + '.get_all_records')
        }
        for (const [ref, item] of entries(tables.host)) {
          checkDeadline()
          if (flag(lookup(tables.host_metrics, item.metrics).live)) freeMemory[ref] = await xapi.call('host.compute_free_memory', ref)
        }
        requireAdmin(xo)
        const normalized = normalizePool({ poolId: pool.id, tables, freeMemory, xoObjects: xo.getObjects() })
        for (const key of Object.keys(data)) data[key].push(...normalized[key])
      }
      const current = Object.values(xo.getObjects()).filter(object => object.type === 'pool').map(pool => pool.id).sort()
      if (JSON.stringify(current) !== JSON.stringify(poolIds)) fail()
      checkDeadline()
      requireAdmin(xo)
      const snapshot = { version: 2, complete: true, observed_at, data }
      if (Buffer.byteLength(JSON.stringify(snapshot)) > 8 * 1024 * 1024) fail()
      return snapshot
    })()])
  } catch { fail() } finally { clearTimeout(timer) }
}
