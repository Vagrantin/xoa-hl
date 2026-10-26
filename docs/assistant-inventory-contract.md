# Authoritative inventory contract

The proposal component in `SOURCES/xoa-hl-proposals.py` uses version 2 snapshots.
It still has **no creation path**. This contract supersedes the original
history-only fixture in the initial propose-only PR (#57).

A trusted adapter supplies `version: 2`, `complete: true`, `observed_at` in Unix
seconds, and `data` containing these arrays:

| Array | Required fields |
| --- | --- |
| `hosts` | `id`, `name`, integer `cpus`, finite nonnegative `memory_free_mb`, boolean `enabled`, boolean `running` |
| `srs` | `id`, `name`, finite nonnegative `free_gb`, `eligible_hosts` |
| `networks` | `id`, `name`, `eligible_hosts` |
| `templates` | `id`, `name`, `eligible_hosts` |
| `vms` | `name` for **every VM**, including old/halted VMs |

`eligible_hosts` contains host IDs, resolved by the adapter from pool, network,
attachment and template constraints. A shared SR is not available on every host
by implication. Missing placement information fails closed. Duplicate resource
names are ambiguous and rejected; IDs must be unique within each collection.
Resource names are bounded, and tags are bounded and unique.

Set completeness only after all authorized reads succeed. Stamp observation time
before the read sequence, so its duration counts toward the 30-second freshness
window. A paginated/truncated read, authorization error or missing capacity is an
error, never an empty list or zero. Do not construct this object from model/browser
input or ask a model to assert its completeness. `recent_vms` may separately enrich
history but cannot establish name uniqueness.

Preflight resolves an omitted host and stores the immutable specification plus
the selected resources' IDs. Approval rechecks freshness, complete inventory,
placement, capacity, collisions and IDs. Recreating an SR/network/template under
the same name invalidates the proposal. Upgraded databases acquire a nullable ID
column; an older pending proposal has no bindings and cannot pass approval.

The trusted conversation owner calls `invalidate_pending(owner, session, reason)`
before a new request, cancellation, disconnect or disable action. This prevents an
old approval remaining actionable while a correction is being processed. The
method only invalidates pending proposals belonging to that authenticated owner
and session. It does not revoke or change another conversation.

An adapter against the actual pinned XO, the goose approval exchange and the
human-approved live acceptance remain requirements of xcp-hl#86. Unit fixtures
validate this contract; they do not establish real appliance compatibility.
