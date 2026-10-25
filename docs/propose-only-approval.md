# Propose-only approval state (#86)

This is the deterministic state component for #80 Phase 3: record a validated
proposal, present it, then record approval or rejection. **It has no VM execution
path**, XO client, network client or creation callback. `approved_dry_run` always
returns `created: false` and `live_execution_available: false`.

It is packaged as an importable component alongside the optional assistant, but
the read-only launcher does not load it as an MCP extension or expose it to a
model. No web/API route or live write tool is enabled. The eventual authenticated
bridge can use the component regardless of which transport #83 selects.

## Trusted boundary

The caller must derive the owner and session from authenticated XO server state.
Never take those identities from model output, request JSON supplied by a browser,
or the approval text. A model supplies only an untrusted proposed specification;
it does not supply authoritative platform facts, timestamps, quotas or approval.

The caller must obtain a fresh, user-authorized normalized snapshot from live XO
reads. The module accepts the envelope `{"observed_at": <server epoch seconds>,
"data": <normalized platform>}`. Its current normalized fields match the frozen
QA task contract: hosts (name, cpus, memory_free_mb), SRs (name, host, shared,
free_gb), networks/templates (name), recent VMs (name). Duplicate resource names
fail closed. This is not an implementation of the live XO adapter: production
must use unambiguous authorized identifiers, active/reachable resources, actual
network/storage relationships and the target version's quota/capacity semantics.

The database directory and file must be private and owned by the process user.
SQLite serializes state/quota changes with `BEGIN IMMEDIATE`, WAL and full sync.
The audit table contains request text and resolved specs; protect and retain it
as private operational data. Restart does not clear approvals or quotas.

## State contract

`propose(owner, session, request, spec, snapshot)`:

- Checks the frozen VM schema with strict JSON integer types, field bounds,
  required/extra fields and tags, plus snapshot freshness, existence, collisions,
  host CPU/RAM, disk capacity and local-SR reachability.
- Resolves an omitted host before display and freezes the canonical specification.
- Issues a random opaque ID, SHA-256 specification digest, server expiry and a
  private audit record tying the request to the resolved plan.
- Rejects invalid proposals before an approval can be displayed.

`decide(owner, session, id, decision, snapshot)`:

- Accepts only an existing pending plan owned by that exact actor/session.
- Uses the stored specification; there is no argument to replace it during approval.
- Rejects replay, expiry, changed capacity, stale facts or exhausted per-user/day
  quota. Approval validation uses a new trusted snapshot at decision time.
- Records `approved_dry_run` or `rejected`. It never starts a VM or calls another
  tool. Default quota is ten dry-run approvals per UTC day; policy is explicit
  and configurable by the trusted caller. At most ten unexpired pending plans
  are allowed per owner.

`propose(..., replaces=old_id)` cancels the old pending plan and creates a new ID
for a valid correction. Even an invalid correction invalidates the old pending
plan. A stale client cannot approve the superseded ID. No previous approval is
silently reused for a changed specification.

`get(owner, session, id)` returns only the public proposal state for that identity.
Cross-user/session lookups and decisions use the same unavailable response, without
revealing the real owner or state. Queries and audit storage use parameter binding.

## What remains before live creation

This component does not establish XO authentication, CSRF/session ownership in a
web bridge, authoritative resource discovery, a production `create_vm` API wrapper,
Goose's interactive approval exchange, retention/rate-limit policy or target fit.
Those must be integrated and tested before a live extension is introduced. Do not
execute an `approved_dry_run` record as if it were a live authorization token.

Live creation must still use the independent narrow write extension in Approve
mode, revalidate deterministically immediately before acting, bind the exact
approved specification and identity, and record the actual XO result. No deletion,
power, backup or host-configuration capability should be added to this component.

## Validation

`python3 tests/test-assistant-proposals.py`: 12 tests passed locally. They cover
preflight/schema/grounding rejection and audit, ambiguous names, immutable host
resolution, identity/session mismatch, replay, expiry, changed capacity, valid and
invalid corrections, durable audit/state, private files and concurrent quota use
through independent SQLite connections. Every approval test is a dry run; no XO
or model was contacted. CI repeats these tests and verifies the package payload.

Schema origin: `Vagrantin/QA/model-bakeoff/schema/create_vm.schema.json@dd161b079ec536c60f359749b51e796a6de97f75`.
This implements the preflight/state portion of #86; the issue remains open for
live adapter/integration/approval and creation acceptance checks.
