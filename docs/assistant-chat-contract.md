# Chat controller and authenticated host contract

`SOURCES/assistant-ui/chat.mjs` adds request input, incremental replies and Stop
to the existing EN/FR/JA propose-only panel. The synthetic preview exercises the
form and full-specification decisions. Assets are packaged, but no XO route is
mounted and the assistant stays disabled by default.

The host injects one authenticated, caller-scoped `bridge`:

| Method | Contract |
| --- | --- |
| `send({text, locale}, {signal, onEvent})` | Resolve only after the stream completes. Emit `{type:'text', text}`, `{type:'proposal', proposal}`, then `{type:'done'}`. |
| `cancel()` | Resolve only when the server has cancelled the turn and invalidated its pending proposals. Idempotent when no turn is active. |
| `decide({id, decision})` | Return the stored immutable proposal after the server verifies the authenticated owner/session and records approve/reject. |

The bridge must derive identity/session from XO, never payload fields. It must
invalidate plans on logout, disconnection, disable and request cancellation,
even if the browser disappeared before sending cleanup. It must enforce limits,
authorization, process cleanup and proposal expiry independently of UI checks.
The controller is not an authorization boundary or an implementation of that
server. It does not select #83's transport or bypass goose's approval exchange.

Every send first awaits server cancellation/invalidation of the previous turn.
Local abort alone cannot satisfy this barrier. Failed cancellation locks input
until Stop receives an acknowledgement. Replaced/cancelled/destroyed streams
cannot append late text or replace a newer proposal. Approval is unavailable
while a stream is incomplete, and a missing terminal event is an error. Replies
and request sizes are bounded; all content uses text nodes. The proposal panel
continues to reject live/created records and says approval creates no VM.

Public Chromium CI exercises EN/FR/JA submission, incremental component state,
full-spec decisions and the 375px Japanese layout. The authenticated XO mount,
actual goose stream/approval round trip, admin enable switch and real creation
remain the integration acceptance in xcp-hl#83/#85/#86/#87.
