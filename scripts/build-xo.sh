#!/bin/bash
set -euo pipefail

XO_REPO="https://github.com/vatesfr/xen-orchestra.git"
XO_SRC="/build/xen-orchestra"
PATCH_DIR="/build/patches"
OUT_DIR="/build/out"

mkdir -p "$OUT_DIR"

echo "==> Cloning xen-orchestra master (shallow)"
git clone --depth 1 "$XO_REPO" "$XO_SRC"
cd "$XO_SRC"

XO_SHORT_SHA=$(git rev-parse --short HEAD)
VERSION="$(date +%Y%m%d)_${XO_SHORT_SHA}"
echo "$VERSION" > "$OUT_DIR/VERSION"

echo "==> Applying patches"
for p in "$PATCH_DIR"/*.patch; do
    [ -f "$p" ] || continue
    echo "  - $(basename "$p")"
    git apply --verbose "$p"
done

echo "==> Install + build (all workspaces)"
yarn --network-timeout 300000
yarn --network-timeout 300000 build

echo "==> Pruning: drop test/dev/cloud packages, keep everything else"
rm -rf .git .github .changesets docs
rm -rf packages/xo-server-test*
rm -rf packages/xo-server-cloud   # licensing/phone-home plugin — excluded like ronivay's "all"

echo "==> Stripping devDependencies (workspace symlinks preserved)"
yarn workspaces focus --production 2>/dev/null || \
  yarn install --production --ignore-scripts --prefer-offline

echo "==> Packaging tarball (whole pruned monorepo)"
tar czf "$OUT_DIR/xoa-hl-${VERSION}.tar.gz" \
    --exclude='**/*.map' \
    -C /build xen-orchestra

echo "==> Done: $OUT_DIR/xoa-hl-${VERSION}.tar.gz"
