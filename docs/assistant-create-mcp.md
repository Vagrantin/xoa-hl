# Propose-only creation extension

`SOURCES/xoa-hl-create-mcp.py` provides a real newline-framed MCP stdio server
with exactly one tool, `create_vm`. The tool validates the complete specification
against fresh, complete inventory and records an immutable **propose-only** plan.
It cannot approve, create, boot, delete or modify a VM. This delivers the narrow
extension boundary for xcp-hl#86 Phase 3; it does not complete live Phase 4.

The future authenticated bridge starts it with `--context-fd N`. The inherited
private descriptor carries one JSON object: `owner`, `session`, original `request`,
absolute private `database` path, absolute `inventory_socket` path and opaque
`turn_id` returned by the store’s `begin_turn(owner, session, request)`. This is
server-supplied context, never an MCP argument or browser assertion. Do not expose
this operator helper as a public endpoint. The descriptor must be seekable or its
writer closed before launch. No credentials go in command-line arguments.

The inventory adapter owns a Unix socket in a private directory, with both owned
by the process UID and inaccessible to other users. For each attempted tool call,
the extension sends `{"method":"inventory","version":2}` and expects one JSON
line conforming to [the inventory contract](assistant-inventory-contract.md).
Its caller-scoped adapter must authorize resources and perform all real XO reads;
the extension never takes an inventory, owner or approval from the model. The
socket has a five-second timeout and an eight-MiB response bound. This private
socket protects a local boundary; it does not replace XO authentication/RBAC.

The trusted supervisor calls `begin_turn` before spawning any worker, including
for a correction that may never call a tool. Only this call mints a turn ID; the
MCP process cannot start or reactivate a turn. An ID is bound to the authenticated
owner, session, original request and deadline in SQLite. New turns invalidate old
plans. Each replacement attempt clears its earlier plans only if its turn is
still current. Adapter errors and incomplete/stale inventories fail closed.
Six tool attempts are allowed per process; invalid calls count.

On cancellation, disconnect or disable, the supervisor must first commit
`revoke_turn(owner, session, turn_id, reason)` and then stop the worker process
group. It must not acknowledge cancellation before revocation commits. A late
inventory response cannot publish a plan: `propose(..., turn_id=...)` rechecks the
turn inside the same transaction that records the plan. Late cleanup for an old
turn cannot revoke a newer one. Revocation survives process restart. The
supervisor still owns cancellation of the actual goose/inference processes; a
revoked database turn does not kill them. The store’s decision method also checks
that the plan belongs to the current active turn. Legacy unscoped pending plans
fail closed. These methods remain separate from the model-facing surface.

When wiring into goose, use Approve mode and explicitly put
`xocreate__create_vm` in `user.ask_before`; never Auto or SmartApprove. Keep the
seven reviewed read tools in `always_allow` and `load_skill` in `never_allow`.
Only the authenticated bridge may return human decisions. A valid MCP result
has `mode=propose_only`, `created=false`, `live_execution_available=false`.
Any UI wording must continue to explain that approving only records a proposal.

This RPM includes the module without enabling it or adding it to the read-only
launcher. Unit and actual subprocess/socket tests exercise protocol, schema,
redaction and state isolation using synthetic trusted inventory. The live XO
inventory/creation adapters, full goose approval exchange, selected transport and
appliance acceptance remain pending. No appliance/model result is claimed.
