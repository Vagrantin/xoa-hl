# Natural-language VM creation: Phase 0

Tracking: [xcp-hl#80](https://github.com/Vagrantin/xcp-hl/issues/80).
This change supplies a repeatable compatibility probe. It installs nothing in
the appliance payload and does not select an agent integration or model.

## Findings, 2026-10-25

Scope: XOA-HL `41858869c622e3ade9f0558dc05104f246896ef1`, with
`UPSTREAM_XO` pinning XO 5.113.2 at
`e281c536d3b1e97ccfb3b0826f91b7dbb6c4478c`.
MCP sources inspected: 1.1.0 at `04a6fb38050d4e2662ed2e7f59e529f6e8ee4754`
and 1.4.3 at `d2ffe1ad5640b55ecdd869f5891571b295bf37bf` in
`vatesfr/xen-orchestra`. These findings do not apply to every MCP release.

| Question | Finding | Evidence |
| --- | --- | --- |
| Does REST already exist at the XO pin? | Yes: `/rest/v0`, inventory routes and OpenAPI are present. This alone does not establish MCP compatibility. | [REST registration at the XO pin](https://github.com/vatesfr/xen-orchestra/blob/e281c536d3b1e97ccfb3b0826f91b7dbb6c4478c/@xen-orchestra/rest-api/src/index.mts), [host controller](https://github.com/vatesfr/xen-orchestra/blob/e281c536d3b1e97ccfb3b0826f91b7dbb6c4478c/@xen-orchestra/rest-api/src/hosts/host.controller.mts) |
| Does MCP 1.4.3 start on this API contract? | It requires `/rest/v0/mcp/status` at startup. That route is absent from the pinned source. Upstream documents XO 6.5+ as required. | [startup](https://github.com/vatesfr/xen-orchestra/blob/d2ffe1ad5640b55ecdd869f5891571b295bf37bf/@xen-orchestra/mcp/src/index.mts), [status check](https://github.com/vatesfr/xen-orchestra/blob/d2ffe1ad5640b55ecdd869f5891571b295bf37bf/@xen-orchestra/mcp/src/xo-client.mts), [requirements](https://github.com/vatesfr/xen-orchestra/blob/d2ffe1ad5640b55ecdd869f5891571b295bf37bf/@xen-orchestra/mcp/README.md) |
| Can an older package avoid that startup requirement? | MCP 1.1.0 has no status gate and uses explicit inventory REST reads. It is a candidate for the live compatibility test, not a supported production choice yet. | [1.1.0 startup](https://github.com/vatesfr/xen-orchestra/blob/04a6fb38050d4e2662ed2e7f59e529f6e8ee4754/@xen-orchestra/mcp/src/index.mts), [REST client](https://github.com/vatesfr/xen-orchestra/blob/04a6fb38050d4e2662ed2e7f59e529f6e8ee4754/@xen-orchestra/mcp/src/xo-client.mts) |
| Is upstream MCP always read-only? | 1.1.0 registers read tools. 1.4.3 can expose actions when `XO_MCP_ENABLE_ACTIONS=1`. The original design's blanket read-only assertion is stale. Keep the separate, narrow creation tool and explicitly suppress upstream actions. | [1.1.0 tool registration](https://github.com/vatesfr/xen-orchestra/blob/04a6fb38050d4e2662ed2e7f59e529f6e8ee4754/@xen-orchestra/mcp/src/server.mts), [1.4.3 environment overrides](https://github.com/vatesfr/xen-orchestra/blob/d2ffe1ad5640b55ecdd869f5891571b295bf37bf/@xen-orchestra/mcp/src/server.mts) |
| Is it offline without further restrictions? | Both inspected versions expose `search_documentation`, which fetches `docs.xen-orchestra.com`. Exclude that tool from the agent and enforce local egress for the offline feature. A prompt instruction is insufficient. | [1.1.0 docs fetch](https://github.com/vatesfr/xen-orchestra/blob/04a6fb38050d4e2662ed2e7f59e529f6e8ee4754/@xen-orchestra/mcp/src/tools/utility/search-docs.mts), [1.4.3 docs fetch](https://github.com/vatesfr/xen-orchestra/blob/d2ffe1ad5640b55ecdd869f5891571b295bf37bf/@xen-orchestra/mcp/src/tools/utility/search-docs.mts) |

Decision for this increment: keep `UPSTREAM_XO` unchanged. Do not select an XO
upgrade, backport the status gate, or declare an old MCP release supported from
source inspection or a fixture result. First record the live 1.1.0 result and
assess the maintenance/security cost of retaining an older dependency. An XO
line change remains a separate maintainer decision if that path is unsuitable.

## What was actually run

`tests/test-mcp-probe.mjs` drives the **unmodified published npm binaries**
through MCP stdio, against a synthetic localhost HTTP server with five legacy
inventory routes. It returns small nonempty synthetic arrays, requires a token
cookie, and returns 404 for the newer MCP status endpoint. It is a contract
fixture, not a running XO or a captured production response.

Local result on Node v24.22.1: **10 tests passed, 0 skipped**.

| Package | Fixture observation |
| --- | --- |
| `@xen-orchestra/mcp@1.1.0` | All 7 checks pass: connection, pools, hosts, VMs, SRs, networks, infrastructure summary. Invalid token receives errors on all 7 checks. |
| `@xen-orchestra/mcp@1.4.3` | Stops at startup with HTTP 404; no MCP tool is called. |

The remaining tests cover changed/mutating tool surfaces (even with a claimed
read-only hint), pagination, repeated cursors, malformed JSON-RPC, process
failure, timeout and credential redaction. No test invokes a write or the
online documentation tool. CI repeats these tests with both releases.

Published package tarball integrity recorded by npm for this run:

```text
1.1.0 sha512-0qKVqrA7AYlXNv9tcHSVAl4WQuNmopxlU4wBCJCjVaVXh+LpEGIKahE9AqWBX0M8Uwn6xVpqeoRMsjC1ri62Kw==
1.4.3 sha512-NqA7r52ZNWWfLVemBczLlbAzXee0caNkAZqXCiIJ3D3Y94KlfOLa+EWzUFSMgwafniEzY+zJhk1qhVsu3/qrng==
```

No real appliance, goose, model, memory budget or latency was measured here.
The fixture cannot establish RBAC, real response-field correctness, template
coverage, host/SR capacity, or a VM creation API contract.

## Running the live Phase 0 check

Use a test appliance running the expected pin, with a representative lab pool.
Record its installed `xoa-hl` RPM version and `/opt/xo` build/version provenance
separately. The report labels the repository pin as **expected** and always
sets `target_version_verified: false`; it cannot attest what a remote server
actually runs. Keep the report together with that provenance and any access
restrictions on the test account.

Install the test dependency in a separate evaluation directory on a lab machine
that can reach the appliance. This needs registry access once; it is not a
production/offline installation method. Run each package separately:

```sh
npm install --prefix /tmp/mcp-110 --ignore-scripts --no-audit --no-fund @xen-orchestra/mcp@1.1.0
npm install --prefix /tmp/mcp-143 --ignore-scripts --no-audit --no-fund @xen-orchestra/mcp@1.4.3

# Set XO_URL and XO_TOKEN in the environment using your usual secret handling.
# Alternatively set XO_USERNAME and XO_PASSWORD. Never put credentials in a report.
node scripts/probe-xo-mcp.mjs \
  --mcp-package /tmp/mcp-110/node_modules/@xen-orchestra/mcp \
  --target-kind appliance --output phase0-mcp-110.json
node scripts/probe-xo-mcp.mjs \
  --mcp-package /tmp/mcp-143/node_modules/@xen-orchestra/mcp \
  --target-kind appliance --output phase0-mcp-143.json
```

The probe accepts only the two inspected package versions and their expected
binary path. It verifies package metadata, not the installed code's hash; use
trusted npm installations. It forces `XO_MCP_ENABLE_ACTIONS=0`, uses a minimal
child environment, and only calls the seven explicit read tools above. It
lists other known tools as skipped; any unexpected tool blocks all calls.
It never invokes `search_documentation`. This is a bounded test client, not
an egress sandbox for an agent or an untrusted MCP binary.

Reports contain tool names, status and error categories, not responses,
credentials, server URLs, inventory names or raw stderr. `--output` creates a
new mode-0600 file and refuses to overwrite an existing file. Exit codes:
0 = the tested read subset passed, 1 = tool/startup incompatibility or error,
2 = invalid setup. `--timeout-ms` bounds the complete probe (default 30000).
An empty pool can pass; manually verify representative real data and permissions
before treating the result as sufficient for the assistant.

To reproduce the fixture suite after the separate npm installs:

```sh
XO_MCP_110_ROOT=/tmp/mcp-110/node_modules/@xen-orchestra/mcp \
XO_MCP_143_ROOT=/tmp/mcp-143/node_modules/@xen-orchestra/mcp \
node --test tests/test-mcp-probe.mjs
```

Without those variables the eight protocol tests run and the two published
binary tests are explicitly skipped.

## Remaining gates in #80

1. Run the probe on the real pinned appliance; record which reads and account
   permissions work, plus template and live capacity coverage still absent
   from this basic probe. Do not translate fixture success into compatibility.
2. Complete #82's headless goose/mock setup and #81's baseline/model measurements.
   No model, knowledge store or integration surface is chosen before them.
3. In #83/#85, enforce an explicit read-tool allowlist, suppress upstream actions,
   exclude online docs, and verify local-only egress before loading the extension
   into an agent. Keep goose Approve mode and the independent creation tool.
4. Settle identity, approval binding, live revalidation and the write API before
   #86/#87. A correction to an approved specification must need fresh approval.

The parent and #81–#87 remain open; this increment does not deliver the chat UI
or VM creation and does not meet their acceptance criteria.
