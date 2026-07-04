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

echo "==> Configuring sample.config.toml (XO5 UI + Redis)"
# Target sample.config.toml — this is what %post copies to the user config
# location (~/.config/xo-server/config.toml), which is the file xo-server
# actually reads at runtime. Modifying config.toml instead is a no-op for
# any install that has a user config present.
#sed -i '/^\[http\.mounts\]$/a '\''/'\'' = '\''../xo-web/dist/'\''' \
#    packages/xo-server/sample.config.toml
#cat packages/xo-server/sample.config.toml
cat > packages/xo-server/xoahl.config.toml << 'EOF'
#Sample config is available at /opt/xo/packages/xo-server/sample.config.toml
[http]
  [[http.listen]]
  port = 443
  cert = '/opt/xo/xoahl.crt'
  key = '/opt/xo/xoahl.key'

[http.mounts]
'/' = '../xo-web/dist/'

[redis]
uri = 'redis://127.0.0.1:6379/0'
EOF

echo "==> Generating self-signed TLS certificate"
openssl req -x509 -newkey rsa:4096 \
  -keyout packages/xo-server/xoahl.key \
  -out packages/xo-server/xoahl.crt \
  -days 3650 -nodes \
  -subj '/CN=xoa.local'
chmod 600 packages/xo-server/xoahl.key
chmod 644 packages/xo-server/xoahl.crt

# Hard verification — sed exits 0 even on no-match, so confirm the lines
# actually changed. CI must fail loudly rather than ship a broken tarball.
#grep -q "^'/' = '../xo-web/dist/'" packages/xo-server/sample.config.toml || \
#    { echo "ERROR: XO5 UI sed did not apply — check line format in sample.config.toml"; exit 1; }

echo "==> Install + build (all workspaces)"
yarn --network-timeout 300000
yarn --network-timeout 300000 build

echo "==> Pruning: drop test/dev/cloud packages, keep everything else"
rm -rf .git .github .changesets docs
rm -rf packages/xo-server-test*
rm -rf packages/xo-server-cloud

echo "==> Stripping devDependencies (workspace symlinks preserved)"
yarn workspaces focus --production 2>/dev/null || \
  yarn install --production --ignore-scripts --prefer-offline

echo "==> Packaging tarball (whole pruned monorepo)"
tar czf "$OUT_DIR/xoa-hl-${VERSION}.tar.gz" \
    --exclude='**/*.map' \
    -C /build xen-orchestra

echo "==> Done: $OUT_DIR/xoa-hl-${VERSION}.tar.gz"
