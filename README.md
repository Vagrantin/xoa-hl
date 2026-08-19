# XOA HL — patch and build

Builds **Xen Orchestra HomeLab Edition** (`xoa-hl`): the full open-source [xen-orchestra](https://github.com/vatesfr/xen-orchestra) server + XO 5 web UI, patched for home-lab use and packaged for XCP-ng.

## How it works

- `container/Containerfile` — AlmaLinux 9 build container with Node.js 24, yarn, and RPM tooling.
- `UPSTREAM_XO`: the upstream pin, shell-sourceable (`XO_COMMIT`, `XO_VERSION`). Builds only move when this file is deliberately bumped.
- `scripts/build-xo.sh`: shallow-fetches xen-orchestra at the pinned commit (currently `e281c536` = **5.113.2**, the last XO 5.x release), applies the patches, builds with yarn, and produces a versioned tarball (`xoa-hl-<version>.tar.gz`) plus a `VERSION` file in `/build/out`. The tarball is a build input for `rpmbuild`, it is not published.
- `patches/menu-hide-items.patch` — hides menu items that only make sense with a Vates subscription.
- `SPECS/xoa-hl.spec`: fat `x86_64` RPM (the shipped tree contains native node addons, so it is not `noarch`), the whole built Xen Orchestra tree ships inside the package and is installed at `/opt/xo`, together with the TLS key/cert, the `xo-cli` symlinks, the systemd units, the sudoers drop-in and the yum repo config (`xoa-hl.repo`). `%post` only bootstraps `/root/.config/xo-server/config.toml` on first install (left untouched on upgrade to preserve operator changes) and enables/restarts the services. Every other file under `/opt/xo` is replaced outright on upgrade, this is an appliance, not a host package. Runtime deps: nodejs ≥ 24, redis, plus mount helpers (nfs-utils, cifs-utils, ntfs-3g, lvm2).
- `SOURCES/xo-server.service` — systemd unit running xo-server from `/opt/xo`.
- `SOURCES/xoa-hl.repo` — yum repo config installed at `/etc/yum.repos.d/xoa-hl.repo`, pointing at the repo below. This is what makes `dnf update` on the appliance pick up new xoa-hl releases.

## Build

Builds run exclusively on GitHub Actions (`.github/workflows/build-xoa.yml`), there is no local build workflow. A build is triggered by pushing a release tag matching `v*-ce[0-9]*` (or manually via `workflow_dispatch`, which synthesises a fallback tag). CI:

1. builds the AlmaLinux 9 image from `container/Containerfile` with Docker,
2. runs `scripts/build-xo.sh` in it to produce the versioned tarball,
3. stages that tarball as `Source0` and builds the fat `x86_64` RPM with `rpmbuild` in the same image,
4. publishes the RPM, and only the RPM, as a GitHub Release on the pushed tag.

### Release tagging

One GitHub release per build, tagged `v<version>-ce<N>`, for example
`v5.113.2_e281c536-ce1`. `<version>` is `${XO_VERSION}_${XO_COMMIT:0:8}` from
`UPSTREAM_XO`; `<N>` is the ce counter, which becomes the leading number of the
RPM `Release` field (`<N>.g<shortcommit>.xcpng8.3`). Bump `<N>` for a new build
of the same upstream pin, so every build has a distinct, upgradeable NEVRA.

## Updating

Once installed, the RPM is upgradable in place: the package payload replaces
`/opt/xo`, then `%post` restarts `xo-server`. Operator config at
`/root/.config/xo-server/config.toml` is left alone.

`.github/workflows/pages-repo.yml` republishes the RPMs from the most recent
releases as a signed yum repository at
[vagrantin.github.io/xoa-hl/8.3/x86_64/](https://vagrantin.github.io/xoa-hl/8.3/x86_64/)
after every successful build, so an appliance with `xoa-hl.repo` installed can
just run:

```bash
dnf update
```

The XOA-HL Updates settings page in the web UI drives the same check and
update system-wide, not just for xoa-hl: it reports every AlmaLinux package
with a pending update and applies all of them via `dnf -y --refresh update`,
not a package-scoped update.

## Related

- `../build-xoa-hl-vm` — packs this into the deployable XVA appliance.
- `../xolite-ce` — the XO Lite build whose deploy button installs that appliance.
