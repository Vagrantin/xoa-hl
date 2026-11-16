# create_vm to XO `vm.create` mapping (xcp-hl#80 Open question 3)

Scope: XO 5.113.2 at `e281c536`, the version XOA-HL pins. Read from source only;
nothing here has run against an appliance. Implemented as a pure builder in
`SOURCES/xoa-hl-vm-create-params.mjs` with `tests/test-assistant-vm-create-params.mjs`.
The builder makes no XO call and is not packaged or wired to any route.

## Answer

The write tool wraps xo-server's JSON-RPC **`vm.create`**
(`packages/xo-server/src/api/vm.mjs` L75, params L234), which calls
`xapi.createVm` (`packages/xo-server/src/xapi/mixins/vm.mjs` L33) and then
`_editVm` (L322) for CPU, memory, affinity and tags. Every `create_vm` field maps
onto it. No REST endpoint is needed and no XO patch is needed for creation.

## Field mapping

| `create_vm` | `vm.create` param | Notes |
| --- | --- | --- |
| `name` | `name_label` | |
| (none) | `name_description` | Fixed text naming the proposal ID, for "why does this VM exist". XO also records creator, date and template in the VM's `xo:` data. |
| `template` | `template` | Bound template ID. `clone: true` (fast clone) is sent explicitly. |
| `vcpus` | `CPUs` | Alias of `cpus`; XO raises `VCPUs_max` first when needed. |
| `memory_mb` | `memory` (bytes) | XO picks fixed or dynamic-range memory from the template's current settings. |
| `disk_gb` | `existingDisks[userdevice] = { $SR, size? }` | Resizes the template's disk; see Disks. |
| `sr` | `existingDisks[userdevice].$SR` | Same SR as the template disk: no copy. Different SR: `VDI.pool_migrate`, a full copy. |
| `network` | `VIFs: [{ network }]` | `vm.create` destroys the template's VIFs, so this is the VM's only NIC. |
| `host` | `affinityHost` | **Affinity, not placement.** Preflight always resolves a host, so it is always set. |
| `tags` | `tags` | Replaces the template's tags on the new VM. |
| (none) | `bootAfterCreate: false`, `createVtpm: false` | Sent explicitly. The VM is created halted. |

The builder emits only these twelve keys. This matters: `vm.create.params` has a
`'*'` entry that forwards any other key to `_editVm`, so passing model output
through would let it set arbitrary VM properties. A test pins the key list.

## Disks

`xapi.createVm` removes the template's provisioning disk list, so a stock template
(for example "Other install media") yields a VM with **no disk** unless the
caller supplies one, and the schema has no install media or ISO field. A VM built
that way cannot boot an OS. The builder therefore accepts only templates with
**exactly one disk image**, and:

- rejects `template_without_disk` and `template_multiple_disks`;
- rejects `disk_smaller_than_template`, because XO throws on shrinking, after the
  VM was already cloned;
- sends `size` only when growing the disk;
- reports `disk_copy_required` when the chosen SR differs from the template disk's.

## Permissions

Without a resource set, `vm.create` checks `administrate` on the template's pool.
This matches the current administrator-only adapter. On failure, `vm.create`
destroys the half-created VM and its disks.

## Gaps this exposes

1. **Inventory lacks template disks.** Contract v2 (`docs/assistant-inventory-contract.md`)
   gives templates only `id`, `name`, `eligible_hosts`. To reject the three disk
   cases *before* approval, as #86 requires, templates need
   `disks: [{ userdevice, size_bytes, sr_id }]` (a v3 contract) and preflight must
   call the same rules. Today they could only fail at execution time.
2. **Capacity for a disk copy.** When `disk_copy_required`, the target SR needs the
   full `disk_gb`. Preflight should count the full size in that case.
3. **Affinity and start.** The VM is created halted and `host` is only a
   preference. Host memory checked at proposal time is advisory until the first
   start. Whether the assistant should also start the VM is a product decision.
4. **Stock templates are out of scope for v1.** Supporting them needs an install
   media or cloud-init field in the schema and a matching dataset category in #81.

## A finding for Open question 8

XO 5.113.2 **resource sets** already constrain a non-admin `vm.create`: allowed
templates, SRs and networks, plus CPU, memory, disk and VM-count limits charged
at creation (`checkResourceSetConstraints`, `allocateLimitsInResourceSet` in
`api/vm.mjs`). That is a candidate for letting non-admin users use the assistant
without XO 6.4 RBAC. Not evaluated further here.
