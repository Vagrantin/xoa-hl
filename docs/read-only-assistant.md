# Local read-only assistant preparation (#85)

This increment adds an optional `xoa-hl-assistant` subpackage after #84's runtime
package. It is a **local operator lab entry point**, disabled by default. It is
not the multi-user XO UI/bridge, not a model selection, and not an appliance
performance/compatibility result. The main XO pin and production image remain
unchanged. No service, write extension or model is installed or enabled.

## Capability boundary

The stdio proxy accepts only the inspected upstream `@xen-orchestra/mcp` 1.1.0
metadata/bin path. It exposes seven no-argument reads: connection, pools, hosts,
VMs, SRs, networks and infrastructure summary. Online docs, details/other tools,
resources, prompts, arbitrary arguments and mutation methods are not forwarded.
Tool pagination, missing reviewed reads and unexpected protocol data fail closed.

The child gets a minimal environment with upstream actions explicitly suppressed.
For that audited version's global-fetch client, a preload permits only GETs to
five inventory paths on the configured loopback XO origin. External documentation,
other origins, writes and redirects fail before the network call. This is a
version-scoped fence for that client; it is **not a sandbox for a modified or
arbitrary Node module**. Metadata is checked, not an installed source-tree hash.
Use a trusted, reviewed dependency installation.

The launcher creates fresh private home/work/goose state, uses `--no-profile`
with one explicitly named CLI extension, forces **Approve** mode, permits only
the seven prefixed reads, and denies goose's internal `load_skill`. It does not
inherit cloud/provider credentials or run a developer extension. Request text is
read as an instructions file; it is never templated into an executable recipe.
It requires an explicit local model/context configuration and existing XO
credentials. It does not run npm, download a model or choose a model for #81.

Provider configuration only names loopback endpoints. The future service/twin
must still enforce its external egress policy: an operator-controlled local
inference service could itself be cloud-backed. The selected bridge also needs
XO user/session authorization. This operator command must not be exposed as a
shared privileged browser endpoint.

## Deliberate lab use after dependency review

Install the optional runtime/assistant RPM artifacts on a lab twin, not as an
unvalidated production image change. Provide the reviewed MCP dependency
separately at a known installed absolute path. It is deliberately not downloaded
by the package or launcher. Keep operator XO credentials in the process environment
using your existing secret handling; never put them in the JSON configuration.

The shipped configuration is disabled. An enabled lab configuration must explicitly
supply every local endpoint and measured context, for example:

```json
{
  "enabled": true,
  "provider": "llama",
  "model": "YOUR_INSTALLED_LOCAL_MODEL_ALIAS",
  "endpoint": "http://127.0.0.1:8080",
  "context_limit": 4096,
  "xo_url": "https://127.0.0.1",
  "mcp_package": "/opt/xoa-hl/mcp/node_modules/@xen-orchestra/mcp"
}
```

4096 above is an example, not a chosen deployment setting. Use the context/model
measured by #81. The launcher also supports a configured native local Ollama
provider, without a tool shim in this read-only entry point.

```sh
# XO_TOKEN (or XO_USERNAME and XO_PASSWORD) already set for this operator.
python3 /usr/libexec/xoa-hl/assistant/xoa-hl-run-read-chat.py \
  --request-file /private/platform-question.txt \
  --state-dir /private/read-chat-new-session
```

Disabled config exits 3 and creates no state or process. Enabling with incomplete,
remote or cloud-labelled configuration fails. State directories must be new and
are private; they can contain platform inventory/conversation data. No credential
values are written into their configuration or startup errors.

Restore `enabled: false` to prevent the next invocation. No daemon was installed,
so there is no service lifecycle to guess before #83's final integration selection.
This is per-request operation; conversational UI/session continuity remains #87.

## Checks and limits

Local tests cover proxy filtering, environment scrubbing, the network guard,
configuration and disabled no-op behavior. A separate smoke test runs the actual
checksum-verified goose 1.56.0 and published MCP 1.1.0 against one local scripted
provider/XO fixture. It confirms a host read succeeds while an attempted docs call
never reaches XO and internal `load_skill` is declined by permissions. The provider
is deterministic, **not a real model**; the XO responses are synthetic.

CI runs those checks and builds both optional RPMs in AlmaLinux 9. The installed
assistant helper must exit disabled before looking for a request file, model or
MCP runtime. No package scriptlet enables anything. The assistant subpackage uses
the existing project's AGPLv3 metadata/license text; the upstream runtime keeps
its separate Apache-2.0 metadata/license text.

Still needed for #85 closure: reviewed production dependency packaging, the real
XO compatibility check, #81 model/resource results, the selected authenticated
integration, live EN/FR/JA questions and measured latency/footprint. Template and
capacity coverage beyond this seven-read preparation is still required for VM
proposals. No real platform answer or VM creation is claimed by fixture success.

Source scope: MCP 1.1.0 at
`xen-orchestra/@xen-orchestra/mcp/src/xo-client.mts@04a6fb38050d4e2662ed2e7f59e529f6e8ee4754`;
goose 1.56.0 permission/config/CLI at `aaif-goose/goose@9949cf926cd42f1d128b9991ed23a496ecace896`.
See [Phase 0 in xoa-hl PR #54](https://github.com/Vagrantin/xoa-hl/pull/54) and [runtime package](goose-package.md).
