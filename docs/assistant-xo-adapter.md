# XO inventory adapter

`SOURCES/xoa-hl-xo-inventory.mjs` implements the version-2 proposal inventory
contract against XO **5.113.2, e281c536d3b1e97ccfb3b0826f91b7dbb6c4478c**.
It is installed with the optional assistant RPM. It has no network listener,
credentials, model or mutation API, and is not invoked when the assistant is off.

The supervising XO API must supply its own current authenticated context.
The initial adapter requires an XO administrator: the pinned `getObjects()`
collection is global, and silently treating it as a caller-filtered inventory
would disclose other users' resources. Non-admin use requires a separate reviewed
authorization policy. No shared service account is introduced.

For each connected pool it reads complete XAPI records for hosts, host metrics,
SRs, PBDs, networks, PIFs, VMs, VBDs and VDIs through XO's existing XAPI
connection. It reads `host.compute_free_memory` for each running host. Neither
request arguments nor the model provide these facts. The timestamp precedes all
reads; a twenty-second overall deadline, missing records, disconnection,
unrepresented registered servers, changed pool set or an eight-MiB response limit
fail the whole inventory. Failed reads never become a partial complete snapshot.
In-flight XAPI reads cannot be interrupted by this adapter, but no additional
read starts after its deadline. No mutation or XAPI scan is requested.

Storage eligibility comes from attached PBDs, network eligibility from attached
PIFs, and template eligibility intersects the hosts that can reach its source
disks. Shared storage does not imply attachment to every host. Internal networks
without PIFs remain ineligible in this first adapter. ISO and maintenance storage
are excluded; free capacity is conservative against both physical use and
virtual allocation. Names for every VM record (including old/halted VMs) take
part in collision checks. XO's own object mapping supplies IDs, preserving its
pool-scoped default-template IDs. Missing event-cache mappings fail closed.

This is source-backed integration code plus synthetic tests. It is not a measured
appliance compatibility result, proof that a particular template boots on a
particular CPU, a selected goose transport or a live creation adapter. The
thirty-second preflight freshness check still applies after collection. Reads
across multiple XAPI calls are not an atomic platform snapshot; live creation
will need final checks at the execution boundary.

Source evidence at the pin:

- `packages/xo-server/src/xo.mjs`: `getObjects` returns the global collection.
- `packages/xo-server/src/xo-mixins/api.mjs`: `apiContext` binds user and permission.
- `packages/xo-server/src/xo-mixins/xen-servers.mjs`: `getXapi` and server status.
- `packages/xo-server/src/xapi-object-to-xo.mjs`: raw record fields, PBD/PIF links,
  host metrics and pool-scoped template IDs.
- `packages/xo-server/src/xapi/utils.mjs`: host running state uses metrics `live`.

Run `node --test tests/test-assistant-inventory.mjs` for deterministic adapter
tests. GitHub Actions also includes these tests in optional RPM validation.
