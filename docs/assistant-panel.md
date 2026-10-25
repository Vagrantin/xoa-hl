# Propose-only assistant panel (#87)

This increment supplies an unmounted, transport-independent browser component
and its English/French/Japanese strings. It is packaged as local assets under
`/usr/share/xoa-hl/assistant-ui`, but no XO menu, route, service or feature switch
is activated. The default feature configuration remains disabled.

`docs/assistant-preview.html` is a synthetic component preview. It has no XO,
model, credential or VM connection. Its decision callback only changes fixture
state. It is not the XOA-HL application or an appliance acceptance test.

## Component boundary

`createAssistantPanel` takes an explicit boolean `enabled`, the current UI locale,
a document and an authenticated host `onDecision` callback. Without `enabled: true`
it creates no element. It has no fetch calls, embedded endpoint, service secret,
provider configuration or VM action. The selected bridge from #83 is deliberately
not hard-coded into these assets.

The host supplies streamed reply text via `appendAssistantText`, user text via
`appendUserText`, and a **server-validated** full proposal via `showProposal`.
Only #86's propose-only records are accepted: an opaque ID, immutable digest,
server expiry, known status and the complete resolved specification. Hidden extra
spec fields, incomplete records and live-execution flags cannot be approved.
Text, resource labels and model output use DOM text nodes, never HTML injection.

The panel shows name, template, vCPU, memory, disk, host, SR, network and tags,
with a prominent statement that approval records a proposal and creates no VM.
It uses explicit Approve/Reject buttons; double-clicks are suppressed while a
decision is pending. Expiry and terminal states disable further decisions. A new
user turn removes the old proposal from view, and late replies for an older
proposal cannot overwrite a newer one. Network errors never become success.

The callback receives only `{id, decision}`. It does not receive an owner,
session identity, editable specification or bearer/service key from the panel.
The authenticated server must bind that ID to its own user/session and immutable
stored plan, revalidate live facts, enforce expiry/quota/one-shot behavior and
return authoritative updated state. A pending client state after a lost response
must be reconciled with server state; the UI is not an authorization boundary.

When a user edits or cancels a proposal, the host bridge must invalidate/supersede
the server record as well as clear the visible panel. Hiding a card alone cannot
revoke a server-side approval. Disconnect/cancellation handling, CSRF, session
ownership and the full goose approval exchange still need integration tests.

## Language and accessibility

Locale variants such as `fr-FR` and `ja_JP` map to the matching dictionary;
unsupported locales fall back to English. All status, decision and field labels
are included in EN/FR/JA, consistent with #80/#85. The component uses native
buttons, a live log/status region, a full-spec definition list, visible focus
styles and wrapping layout for smaller screens. It does not change global user
language preferences or replace existing XO locale handling.

## Validation and remaining integration

15 DOM interaction tests cover every language, disabled state, full-spec display,
unsafe text rendering, approval payloads/double clicks, rejection, expiry,
replacement races, new requests, malformed/hidden specs, changed decision results,
connection errors and dictionary completeness. The only DOM dependency is for
tests (`linkedom@0.18.12`); the browser assets use standard DOM APIs only.

A separate CI Chromium job checks the synthetic preview in all three languages,
records screenshots and checks a 375px layout and approval state. Local browser
installation was unavailable (the runtime CDN download did not yield an archive);
CI provides that browser validation.

These tests do not establish real application routing, model quality,
stream/approval round trips, XO identity mapping, target footprint or VM creation.
The production mounting/bridge work remains gated on #83's choice and the live
read/write acceptance checks. No issue is closed by this component preparation.
