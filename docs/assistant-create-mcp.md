# Propose-only creation extension

`SOURCES/xoa-hl-create-mcp.py` provides a real newline-framed MCP stdio server
with exactly one tool, `create_vm`. The tool validates the complete specification
against fresh, complete inventory and records an immutable **propose-only** plan.
It cannot approve, create, boot, delete or modify a VM. This delivers the narrow
extension boundary for xcp-hl#86 Phase 3; it does not complete live Phase 4.

The future authenticated bridge starts it with `--context-fd N`. The inherited
private descriptor carries one JSON object: `owner`, `session`, original `request`,
absolute private `database` path and absolute `inventory_socket` path. This is
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

Every new authenticated turn and replacement attempt invalidates the conversation's
older pending plans. Adapter errors and incomplete/stale inventories fail closed.
Six tool attempts are allowed per process; invalid calls count. Cancellation and
disconnect must also invalidate plans in the supervising bridge, including when
goose never calls the extension. The existing store supplies the owner/session
decision method, separate from this model-facing surface.

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
