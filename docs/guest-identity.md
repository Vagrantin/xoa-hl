# Guest-reported appliance versions

The optional guest view in XO Lite reads `VM_guest_metrics.other` for the selected
VM. The publisher writes one bounded JSON value to the guest's own
`control/xoa-hl-identity` XenStore key. XCP-ng's existing guest-agent conversion
copies `control/*` values into that map; no XAPI credentials, host plugin,
management IP or arbitrary guest-file access is added.

Schema 1 identifies product `xoa-hl` and carries the installed application RPM
version, the exact `/etc/xoa-hl-image-tag` when present (otherwise the validated
legacy `/etc/xoa-hl-vm-release` stamp), and UTC `reported_at`. Only these fixed
nonsecret values are published; input files and payload size are bounded. A
single XenStore value keeps the report coherent. The domain must be a nonzero
Xen guest. Removal clears only this package's key.

A oneshot runs after installation/upgrade and a timer refreshes at boot and every
five minutes. This timer reports identity only; both update timers remain off by
default. The service needs the image's existing XenStore tools. A missing image
stamp remains unknown; it is never filled from the newest available release.

XO Lite treats the value as display-only guest data. It rejects unexpected
schemas, malformed/bounded fields, offline metrics, reports older than fifteen
minutes and implausibly future timestamps. A one-minute view clock expires a
report even if no further metrics events arrive. These reports must never grant
permissions, verify image integrity, or satisfy release QA.

Source contract: `xcp-ng/xen-api/ocaml/xapi/xapi_guest_agent.ml` at
`3c70994a729cc45d22e434263abbb3c38c4627f2` (8.3 branch), `let other all_control`
and `get_initial_guest_metrics`. The XO Lite pin already exposes `other` and
`live` in `XenApiVmGuestMetrics`.

Validation on a released image still needs a real XCP-ng 8.3 host: inspect the
VM's guest-metrics map, compare both displayed versions to the guest, upgrade the
RPM and confirm the report changes, then test an old stamped image, stopped VM,
expired report and package removal. The exact image-tag stamp is supplied by the
companion buildorchestration #44 change; legacy images remain supported.
