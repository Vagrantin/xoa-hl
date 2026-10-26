# Authenticated proposal lifecycle

`patches/xoa-hl-assistant-api.patch` adds the `xoaAssistant` namespace against
XO 5.113.2/e281c536. XO's own WebSocket and API authentication protect these
methods. No new listener, cookie handler, token or public approval URL is added.
This bridge is independent of #83's pending goose transport choice.

The API lazy-loads the optional assistant package from its fixed installed path.
Absent or disabled packages report `enabled: false`; ordinary XO startup does
not depend on Python or assistant modules. All methods require a logged-in XO
user; proposal operations additionally require an administrator. The bridge
rechecks the current user record, permission and connection identity around
asynchronous work, including inventory collection. Non-admin ACL support needs
a separate reviewed policy because the pin's object collection is global.

| API | Browser parameters | Result |
| --- | --- | --- |
| `xoaAssistant.getState` | none | Package enabled state; `chat_available: false`, `live_execution_available: false` |
| `xoaAssistant.getProposal` | `id` | A plan owned by this authenticated user and XO connection |
| `xoaAssistant.decideProposal` | `id`, `decision` (`approve`/`reject`) | Authoritative updated propose-only state |
| `xoaAssistant.cancel` | none | Acknowledgment after durable revocation and worker cleanup |

No public endpoint accepts a specification, inventory, owner/session, private
turn ID or state-file path. Approve reads [fresh inventory](assistant-xo-adapter.md)
through XO, then applies the store's immutable plan checks. It still records
`approved_dry_run`, `created: false`. Reject needs no platform read. Reconcile a
lost decision response with `getProposal`; never automatically retry a decision.

## Private supervisor contract

`conversation(xo)` in `SOURCES/xoa-hl-xo-bridge.mjs` binds a random private session
to XO's current user and connection. The agent supervisor calls `begin(request)`
before a turn and supplies the returned trusted context plus its private
`inventory_socket` to the creation MCP worker. Do not send this context to the
browser or model. The socket/engine supervisor and goose approval exchange remain
pending; the new API does not claim to start a connected chat.

Register awaited worker cleanup with `attachWorker(context.turn_id, stop)`.
`stop` must stop and reap the actual process group, rejecting if that cannot be
confirmed. Call `workerFinished(turn_id)` after normal completion. Late completion
from an older turn cannot detach its replacement. Decisions remain blocked while
a worker runs.

Each connection serializes lifecycle operations. New turns revoke previous ones
before replacement. Cancellation commits revocation, stops the worker, then
acknowledges. Database and cleanup failures remain retryable and cannot become a
success. Close triggers the same cleanup; close during configuration I/O prevents
later conversation creation. Reconnection cannot approve the previous socket's
plans. SQLite turn deadlines bound orphaned work after an XO process crash.

Disabling configuration blocks new work. Existing conversations revoke on their
next API acquisition or disconnect; no polling watcher is installed. An immediate
all-session on/off UI and the measured engine transport still need integration.
The UI remains unmounted and the package stays disabled by default. Up to 64
connection states and two concurrent inventory collections are permitted.

The fixed Python command receives one bounded private JSON input and operates on
`/var/lib/xoa-hl/assistant/proposals.sqlite`. It has no shell, network or path
override, and receives no XO/model credentials. Errors are redacted. The store
retains the request, immutable spec, user, session and decision audit.

## Validation and remaining acceptance

Node tests cover authentication, identity binding, concurrency, role changes,
disconnects, disable, cancellation ordering, retryable failures, replacement
workers and API shape. Python tests exercise the actual subprocess, durable state,
Unicode, approval audit, wrong sessions and malformed protocol. CI builds/installs
the optional RPM and applies the full patch series against the exact XO pin.
These are synthetic integration checks.

Connected chat, the private socket/engine supervisor, optional image/update
integration, real appliance/model measurements, the goose approval exchange and
human-approved live creations remain pending. No live endpoint or model was
available. #80/#86/#87 remain open until their acceptance conditions are met.
