#!/bin/bash
# Validate patches against metadata.toml
set -euo pipefail

PATCH_DIR="${1:-$(dirname "$0")/../patches}"
PATCH_METADATA="$PATCH_DIR/metadata.toml"

echo "Validating patches in: $PATCH_DIR"

if [ ! -d "$PATCH_DIR" ]; then
    echo "ERROR: Patch directory not found: $PATCH_DIR"
    exit 1
fi

if [ ! -f "$PATCH_METADATA" ]; then
    echo "::warning:: No patch metadata found at $PATCH_METADATA"
    exit 0
fi

echo "[OK] Patch metadata found"
bash "$(dirname "$0")/list-patches.sh" "$PATCH_DIR" >/dev/null

# Parse TOML and require a complete, well-formed table for every patch.
# Grep-only checks can miss fields accidentally split into anonymous tables.
python3 - "$PATCH_METADATA" <<'PY'
import sys
import re
from pathlib import Path
import tomllib

path = sys.argv[1]
with open(path, "rb") as stream:
    document = tomllib.load(stream)

entries = document.get("patches")
if not isinstance(entries, list):
    raise SystemExit("[FAIL] metadata.toml must contain [[patches]] tables")

required = {
    "id": str,
    "description": str,
    "target": str,
    "upstream_commit": str,
    "applies_to": list,
    "maintainer": str,
    "status": str,
    "dependencies": list,
}
errors = []
ids = []
for index, entry in enumerate(entries, 1):
    missing = [key for key in required if key not in entry]
    wrong = [key for key, kind in required.items() if key in entry and not isinstance(entry[key], kind)]
    if missing:
        errors.append(f"entry {index}: missing {', '.join(missing)}")
    if wrong:
        errors.append(f"entry {index}: invalid type for {', '.join(wrong)}")
    if isinstance(entry.get("id"), str):
        ids.append(entry["id"])

known = set(ids)
if len(known) != len(ids):
    errors.append("duplicate patch IDs")
files = sorted(Path(path).parent.glob("*.patch"))
series = Path(path).with_name("series").read_text().splitlines()
order = {Path(name).stem: index for index, name in enumerate(series)}
legacy = {"menu-hide-items.patch", "xcp-hl-updates.patch", "xoa-hl-update-api.patch"}
for patch in files:
    if patch.name not in legacy and not re.fullmatch(r"[0-9]{3}-[a-z0-9]+(?:-[a-z0-9]+)*\.patch", patch.name):
        errors.append(f"invalid patch filename {patch.name!r}; use NNN-descriptive-name.patch")
numbered = [patch for patch in files if patch.name not in legacy]
if len({patch.name[:3] for patch in numbered}) != len(numbered):
    errors.append("patch numeric prefixes must be unique")
for index, entry in enumerate(entries, 1):
    for dependency in entry.get("dependencies", []):
        if dependency not in known:
            errors.append(f"entry {index}: unknown dependency {dependency!r}")
        elif dependency in order and entry.get("id") in order and order[dependency] >= order[entry["id"]]:
            errors.append(f"entry {index}: dependency {dependency!r} must apply first")

if errors:
    for error in errors:
        print(f"[FAIL] {error}")
    raise SystemExit(1)
print(f"[OK] Parsed {len(entries)} complete metadata entries")
PY

METADATA_PATCH_COUNT=$(grep -c '^\[\[patches\]\]' "$PATCH_METADATA" || true)
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
