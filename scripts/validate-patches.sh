#!/bin/bash
# Validate patches against metadata.toml
# This script can be run standalone to check patch consistency

set -euo pipefail

PATCH_DIR="${1:-$(dirname "$0")/../patches}"
PATCH_METADATA="$PATCH_DIR/metadata.toml"

echo "Validating patches in: $PATCH_DIR"

if [ ! -d "$PATCH_DIR" ]; then
    echo "ERROR: Patch directory not found: $PATCH_DIR"
    exit 1
fi

# Check if metadata file exists
if [ ! -f "$PATCH_METADATA" ]; then
    echo "::warning:: No patch metadata found at $PATCH_METADATA"
    echo "Patches will still be applied, but metadata is recommended for maintainability"
    exit 0
fi

echo "[OK] Patch metadata found"

# Count patches
METADATA_PATCH_COUNT=$(grep -c '^\[\[patches\]\]' "$PATCH_METADATA" || echo "0")
ACTUAL_PATCH_COUNT=$(find "$PATCH_DIR" -maxdepth 1 -name '*.patch' | wc -l)
echo "  Metadata entries: $METADATA_PATCH_COUNT"
echo "  Patch files: $ACTUAL_PATCH_COUNT"

ERRORS=0

# Check each patch file has metadata
for p in "$PATCH_DIR"/*.patch; do
    [ -f "$p" ] || continue
    PATCH_ID=$(basename "$p" .patch)
    if ! grep -q "id = \"$PATCH_ID\"" "$PATCH_METADATA"; then
        echo "[FAIL] Patch file $(basename "$p") has no metadata entry"
        ERRORS=$((ERRORS + 1))
    else
        echo "[OK] $(basename "$p") has metadata"
    fi
done

# Check for missing patch files
while IFS= read -r line; do
    if echo "$line" | grep -q '^id = "'; then
        PATCH_ID=$(echo "$line" | sed 's/.*id = "//;s/"$//')
        if [ ! -f "$PATCH_DIR/${PATCH_ID}.patch" ]; then
            echo "[FAIL] Metadata entry '$PATCH_ID' has no patch file"
            ERRORS=$((ERRORS + 1))
        fi
    fi
done < "$PATCH_METADATA"

# Check for duplicate IDs
DUPLICATE_IDS=$(grep '^id = "' "$PATCH_METADATA" | sed 's/.*id = "//;s/"$//' | sort | uniq -d)
if [ -n "$DUPLICATE_IDS" ]; then
    echo "[FAIL] Duplicate patch IDs: $DUPLICATE_IDS"
    ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -eq 0 ]; then
    echo "[OK] All patches validated successfully"
    exit 0
else
    echo "[FAIL] Validation failed with $ERRORS errors"
    exit 1
fi
