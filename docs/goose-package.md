# Optional goose runtime package (#84)

This first packaging increment supplies `xoa-hl-goose` independently of the
main XO payload. It does not install a service, model or agent extension, does
not start anything, and does not change `UPSTREAM_XO` or the normal appliance
image/update workflow. The feature configuration ships with `enabled: false`.
Production integration, image inclusion and update/restart policy remain gated
on #81/#83's measurements and selection.

## Package contract

- Runtime: goose 1.56.0, upstream source commit
  `9949cf926cd42f1d128b9991ed23a496ecace896`, matching QA's evaluation pin.
- Upstream released `x86_64-unknown-linux-musl` archive; exact URL and SHA-256
  recorded in `GOOSE_RUNTIME.json`. The fetcher rejects checksum mismatches,
  links, traversal paths, extra files and oversized downloads.
- Installed executable: `/usr/libexec/xoa-hl/goose`; no generic `goose` command
  or service name is claimed. The package requires XOA-HL but carries its own
  runtime version, so a future runtime bump is independent of the XO pin.
- Runtime manifest: `/usr/share/xoa-hl/goose/runtime.json`.
- Preserved operator configuration: `/etc/xoa-hl/assistant.json`, disabled by
  default. There are no model weights, API credentials, service secrets, RPM
  scriptlets or systemd units in this package.
- Upstream Apache-2.0 project license text is packaged with `%license` and its
  pinned Git blob is checked. This package does not replace XOA-HL's license.
- RPM payload uses xz; the binary is not stripped or rebuilt by RPM scripts.

## CI-only build and checks

`.github/workflows/check-goose-package.yml` builds this optional RPM inside
AlmaLinux 9 in GitHub Actions. It verifies the download, RPM compression and
absence of scriptlets/services/models, installs the payload in a fresh container,
runs `--version` and checks that the released musl executable has no ELF interpreter.
It checks the installed disabled default and uploads a test RPM artifact.

The payload-only container install uses `--nodeps` because the multi-gigabyte
XOA-HL application is not installed in that test. A passing container check is
an observation for that binary/container combination, not an appliance fit,
CPU-instruction-set, approval, chat or update-path validation. Do not close #84
on that evidence alone. No release tag, production publication or image build
is triggered by this PR workflow.

Local validation is limited to Python syntax and
`python3 tests/test-goose-package.py`; no local RPM build is provided.

## Remaining before appliance inclusion

1. Record #83's measured transport choice and its lifecycle requirements.
2. Validate the released executable on the actual AlmaLinux 9 target CPU and
   under its 2 GB / 2 vCPU resource constraint, alongside XO/Redis.
3. Add the selected service/bridge and explicit enable/disable action, with
   runtime-only secrets where applicable. The package must remain disabled
   until complete configuration and those checks pass.
4. Add optional image inclusion and deliberate update behavior through the
   existing CI/repository path, then verify install, upgrade and removal on a twin.

The binary route is used for this optional preparation because a released,
checksum-pinned artifact exists and can be tested without introducing a Rust
build toolchain into the appliance. This does not choose the integration shape.

Evidence: [upstream release](https://github.com/aaif-goose/goose/releases/tag/v1.56.0),
[license at the source pin](https://github.com/aaif-goose/goose/blob/9949cf926cd42f1d128b9991ed23a496ecace896/LICENSE),
[CLI at the source pin](https://github.com/aaif-goose/goose/blob/9949cf926cd42f1d128b9991ed23a496ecace896/crates/goose-cli/src/cli.rs).
XOA-HL packaging baseline: `xoa-hl/SPECS/xoa-hl.spec@41858869c622e3ade9f0558dc05104f246896ef1`.
