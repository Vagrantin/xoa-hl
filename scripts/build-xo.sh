#!/bin/bash
set -euo pipefail

XO_REPO="https://github.com/vatesfr/xen-orchestra.git"
# Upstream pin lives in the repo root file UPSTREAM_XO, bind-mounted by CI.
PIN_FILE="${PIN_FILE:-/build/UPSTREAM_XO}"
[ -f "$PIN_FILE" ] || { echo "ERROR: pin file $PIN_FILE not found"; exit 1; }
# shellcheck disable=SC1090
. "$PIN_FILE"
: "${XO_COMMIT:?XO_COMMIT missing from $PIN_FILE}"
: "${XO_VERSION:?XO_VERSION missing from $PIN_FILE}"
XO_SRC="/build/xen-orchestra"
PATCH_DIR="/build/patches"
OUT_DIR="/build/out"

mkdir -p "$OUT_DIR"

echo "==> Fetching xen-orchestra at ${XO_VERSION} (${XO_COMMIT:0:8})"
# --depth 1 against a bare SHA requires init+fetch; GitHub supports this.
# Avoids pulling the full history (~1 GB) while still pinning reproducibly.
mkdir -p "$XO_SRC"
git -C "$XO_SRC" init -q
git -C "$XO_SRC" remote add origin "$XO_REPO"
git -C "$XO_SRC" fetch --depth 1 origin "$XO_COMMIT"
git -C "$XO_SRC" checkout FETCH_HEAD
cd "$XO_SRC"

XO_SHORT_SHA="${XO_COMMIT:0:8}"
VERSION="${XO_VERSION}_${XO_SHORT_SHA}"
echo "$VERSION" > "$OUT_DIR/VERSION"

echo "==> Validating patch metadata"
PATCH_METADATA="$PATCH_DIR/metadata.toml"
if [ -f "$PATCH_METADATA" ]; then
    echo "  Found patch metadata: $PATCH_METADATA"
    echo "  Validating patches against metadata..."
    
    # Count patches in metadata
    METADATA_PATCH_COUNT=$(grep -c '^\[\[patches\]\]' "$PATCH_METADATA" || echo "0")
    ACTUAL_PATCH_COUNT=$(find "$PATCH_DIR" -maxdepth 1 -name '*.patch' | wc -l)
    
    echo "  Metadata entries: $METADATA_PATCH_COUNT, Actual patch files: $ACTUAL_PATCH_COUNT"
    
    if [ "$METADATA_PATCH_COUNT" -ne "$ACTUAL_PATCH_COUNT" ]; then
        echo "::warning:: Patch count mismatch: metadata has $METADATA_PATCH_COUNT entries but $ACTUAL_PATCH_COUNT .patch files exist"
    fi
    
    # Validate each patch file has a corresponding metadata entry
    for p in "$PATCH_DIR"/*.patch; do
        [ -f "$p" ] || continue
        PATCH_ID=$(basename "$p" .patch)
        if ! grep -q "id = \"$PATCH_ID\"" "$PATCH_METADATA"; then
            echo "::warning:: Patch file $(basename "$p") has no corresponding metadata entry"
        fi
    done
    
    # Validate each metadata entry has a corresponding patch file
    while IFS= read -r line; do
        if echo "$line" | grep -q '^id = "'; then
            PATCH_ID=$(echo "$line" | sed 's/.*id = "//;s/"$//')
            if [ ! -f "$PATCH_DIR/${PATCH_ID}.patch" ]; then
                echo "::warning:: Metadata entry for '$PATCH_ID' has no corresponding .patch file"
            fi
        fi
    done < "$PATCH_METADATA"
else
    echo "::warning:: No patch metadata found at $PATCH_METADATA"
    echo "  Consider adding metadata.toml to document patches"
fi

echo "==> Applying patches"
for p in "$PATCH_DIR"/*.patch; do
    [ -f "$p" ] || continue
    echo "  - $(basename "$p")"
    git apply --verbose "$p"
done

echo "==> Configuring sample.config.toml (XO5 UI + Redis)"
# Target sample.config.toml, this is what %post copies to the user config
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

# Hard verification, sed exits 0 even on no-match, so confirm the lines
# actually changed. CI must fail loudly rather than ship a broken tarball.
#grep -q "^'/' = '../xo-web/dist/'" packages/xo-server/sample.config.toml || \
#    { echo "ERROR: XO5 UI sed did not apply, check line format in sample.config.toml"; exit 1; }

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
