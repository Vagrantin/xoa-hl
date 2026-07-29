# XOA HL — patch and build

Builds **Xen Orchestra HomeLab Edition** (`xoa-hl`): the full open-source [xen-orchestra](https://github.com/vatesfr/xen-orchestra) server + XO 5 web UI, patched for home-lab use and packaged for XCP-ng.

## How it works

- `container/Containerfile` — AlmaLinux 9 build container with Node.js 24, yarn, and RPM tooling.
- `scripts/build-xo.sh` — the build itself: shallow-fetches xen-orchestra at a pinned commit (currently `e281c536` = **5.113.2**, the last XO 5.x release), applies the patches, builds with yarn, and produces a versioned tarball (`xoa-hl-<version>.tar.gz`) plus a `VERSION` file in `/build/out`.
- `patches/menu-hide-items.patch` — hides menu items that only make sense with a Vates subscription.
- `SPECS/xoa-hl.spec` — thin noarch RPM: it ships only the systemd unit and, in `%post`, downloads the release tarball from GitHub Releases into `/opt/xo`, installs the TLS key/cert, and bootstraps `/root/.config/xo-server/config.toml` on first install (left untouched on upgrade to preserve operator changes). Runtime deps: nodejs ≥ 24, redis, plus mount helpers (nfs-utils, cifs-utils, ntfs-3g, lvm2).
- `SOURCES/xo-server.service` — systemd unit running xo-server from `/opt/xo`.

## Build

Builds run exclusively on GitHub Actions (`.github/workflows/build-xoa.yml`) — there is no local build workflow. On every push (or manual `workflow_dispatch`), CI:

1. builds the AlmaLinux 9 image from `container/Containerfile` with Docker,
2. runs `scripts/build-xo.sh` in it to produce the versioned tarball,
3. builds the thin noarch RPM with `rpmbuild` in the same image,
4. publishes both as a GitHub Release tagged `v<version>` — the URL the RPM's `%post` downloads from.

## Related

- `../build-xoa-hl-vm` — packs this into the deployable XVA appliance.
- `../xolite-ce` — the XO Lite build whose deploy button installs that appliance.
