// Translate an approved create_vm proposal into XO 5.113.2 vm.create params.
// Pure function: no XO call, no I/O. Mapping rationale: docs/assistant-vm-create-mapping.md.
const MIB = 1024 ** 2, GIB = 1024 ** 3
const SPEC_FIELDS = new Set(['name', 'template', 'vcpus', 'memory_mb', 'disk_gb', 'sr', 'network', 'host', 'tags'])
const BINDINGS = ['host', 'template', 'sr', 'network']

export class VmCreateRejected extends Error {
  constructor(reason) { super(reason); this.reason = reason }
}
const reject = reason => { throw new VmCreateRejected(reason) }
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : reject('invalid_binding')
const positive = (value, max) => Number.isSafeInteger(value) && value >= 1 && value <= max ? value : reject('invalid_spec')

// templateDisks: Disk VBDs of the template, read live: { userdevice, size_bytes, sr_id }.
export function buildVmCreateParams({ proposalId, spec, bindings, templateDisks }) {
  if (spec === null || typeof spec !== 'object' || Object.keys(spec).some(key => !SPEC_FIELDS.has(key))) reject('invalid_spec')
  if (bindings === null || typeof bindings !== 'object' || Object.keys(bindings).length !== BINDINGS.length) reject('invalid_binding')
  for (const key of BINDINGS) id(bindings[key])
  id(proposalId)
  const name = typeof spec.name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(spec.name) ? spec.name : reject('invalid_spec')
  const vcpus = positive(spec.vcpus, 64)
  const memoryBytes = positive(spec.memory_mb, 262144) * MIB
  const diskBytes = positive(spec.disk_gb, 4096) * GIB
  const tags = spec.tags ?? []
  if (!Array.isArray(tags) || tags.length > 32 || new Set(tags).size !== tags.length ||
      tags.some(tag => typeof tag !== 'string' || tag.length < 1 || tag.length > 128)) reject('invalid_spec')

  // The schema has no install media, so only a template carrying one disk image yields a bootable VM.
  if (!Array.isArray(templateDisks)) reject('template_disks_unavailable')
  if (templateDisks.length === 0) reject('template_without_disk')
  if (templateDisks.length > 1) reject('template_multiple_disks')
  const [disk] = templateDisks
  if (typeof disk?.userdevice !== 'string' || !/^\d{1,3}$/.test(disk.userdevice) || !Number.isSafeInteger(disk.size_bytes) || disk.size_bytes < 0) {
    reject('template_disks_unavailable')
  }
  id(disk.sr_id)
  // XO refuses to shrink a template disk; reject here rather than fail mid-creation.
  if (diskBytes < disk.size_bytes) reject('disk_smaller_than_template')

  const params = {
    name_label: name,
    name_description: `Created by the XOA-HL assistant, proposal ${proposalId}`,
    template: bindings.template,
    // Fast clone. Copy (clone=false) duplicates every template disk before any edit.
    clone: true,
    CPUs: vcpus,
    memory: memoryBytes,
    affinityHost: bindings.host,
    // vm.create destroys the template's VIFs, so this list is the VM's complete network set.
    VIFs: [{ network: bindings.network }],
    // Size only when growing: XO resizes on any given size. Same SR makes moveVdi a no-op.
    existingDisks: { [disk.userdevice]: { $SR: bindings.sr, ...(diskBytes > disk.size_bytes ? { size: diskBytes } : {}) } },
    tags: [...tags],
    bootAfterCreate: false,
    createVtpm: false,
  }
  return {
    method: 'vm.create',
    params,
    // A different SR makes XO move the cloned disk: a full copy, slower and space-consuming.
    disk_copy_required: disk.sr_id !== bindings.sr,
  }
}
