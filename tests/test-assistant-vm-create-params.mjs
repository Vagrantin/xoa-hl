import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildVmCreateParams, VmCreateRejected } from '../SOURCES/xoa-hl-vm-create-params.mjs'

const GIB = 1024 ** 3
const spec = () => ({ name: 'rpm-build-02', template: 'almalinux9-build', vcpus: 4, memory_mb: 16384, disk_gb: 60, sr: 'Local storage', network: 'LAN', host: 'xcp-hl-02', tags: ['build'] })
const bindings = () => ({ host: 'host-id', template: 'tpl-id', sr: 'sr-id', network: 'net-id' })
const disks = (size = 20 * GIB, sr = 'sr-id') => [{ userdevice: '0', size_bytes: size, sr_id: sr }]
const build = overrides => buildVmCreateParams({ proposalId: 'p-1', spec: spec(), bindings: bindings(), templateDisks: disks(), ...overrides })
const rejects = (overrides, reason) => assert.throws(() => build(overrides), error => error instanceof VmCreateRejected && error.reason === reason)

test('maps every schema field onto vm.create params', () => {
  const { method, params, disk_copy_required } = build()
  assert.equal(method, 'vm.create')
  assert.deepEqual(params, {
    name_label: 'rpm-build-02',
    name_description: 'Created by the XOA-HL assistant, proposal p-1',
    template: 'tpl-id', clone: true, CPUs: 4, memory: 16384 * 1024 ** 2, affinityHost: 'host-id',
    VIFs: [{ network: 'net-id' }],
    existingDisks: { 0: { $SR: 'sr-id', size: 60 * GIB } },
    tags: ['build'], bootAfterCreate: false, createVtpm: false,
  })
  assert.equal(disk_copy_required, false)
})

test('uses bound IDs, never spec names', () => {
  const text = JSON.stringify(build().params)
  for (const name of ['almalinux9-build', 'Local storage', 'LAN', 'xcp-hl-02']) assert.ok(!text.includes(name), name)
})

test('omits size when equal to the template disk', () => {
  assert.deepEqual(build({ templateDisks: disks(60 * GIB) }).params.existingDisks, { 0: { $SR: 'sr-id' } })
})

test('flags a disk copy when the SR differs from the template disk', () => {
  assert.equal(build({ templateDisks: disks(20 * GIB, 'other-sr') }).disk_copy_required, true)
})

test('defaults missing tags to an empty list', () => {
  const s = spec(); delete s.tags
  assert.deepEqual(build({ spec: s }).params.tags, [])
})

test('rejects templates it cannot turn into a bootable VM', () => {
  rejects({ templateDisks: [] }, 'template_without_disk')
  rejects({ templateDisks: [...disks(), { userdevice: '1', size_bytes: GIB, sr_id: 'sr-id' }] }, 'template_multiple_disks')
  rejects({ templateDisks: undefined }, 'template_disks_unavailable')
  rejects({ templateDisks: [{ userdevice: 'xvda', size_bytes: GIB, sr_id: 'sr-id' }] }, 'template_disks_unavailable')
})

test('rejects shrinking the template disk', () => {
  rejects({ templateDisks: disks(80 * GIB) }, 'disk_smaller_than_template')
})

test('rejects unknown or out-of-range spec fields', () => {
  rejects({ spec: { ...spec(), bootAfterCreate: true } }, 'invalid_spec')
  rejects({ spec: { ...spec(), cloudConfig: '#cloud-config' } }, 'invalid_spec')
  rejects({ spec: { ...spec(), vcpus: 0 } }, 'invalid_spec')
  rejects({ spec: { ...spec(), memory_mb: 1.5 } }, 'invalid_spec')
  rejects({ spec: { ...spec(), name: 'Bad Name' } }, 'invalid_spec')
  rejects({ spec: { ...spec(), tags: ['a', 'a'] } }, 'invalid_spec')
})

test('rejects incomplete or extra bindings and a missing proposal ID', () => {
  rejects({ bindings: { ...bindings(), host: '' } }, 'invalid_binding')
  rejects({ bindings: { ...bindings(), vm: 'x' } }, 'invalid_binding')
  rejects({ proposalId: undefined }, 'invalid_binding')
})

test('emits only allowlisted vm.create keys', () => {
  assert.deepEqual(Object.keys(build().params).sort(), ['CPUs', 'VIFs', 'affinityHost', 'bootAfterCreate', 'clone', 'createVtpm', 'existingDisks', 'memory', 'name_description', 'name_label', 'tags', 'template'])
})
