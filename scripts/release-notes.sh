#!/usr/bin/env bash
# A reproducible, release-specific summary prepended to GitHub's generated PR notes.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: $0 TAG VERSION RPM_PATH OUTPUT_PATH" >&2
  exit 2
fi
tag=$1
version=$2
rpm=$3
output=$4
repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"

# shellcheck source=../UPSTREAM_XO
. ./UPSTREAM_XO
: "${XO_VERSION:?}"
: "${XO_COMMIT:?}"
[[ "$XO_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid upstream commit" >&2; exit 1; }
[[ "$version" == "${XO_VERSION}_${XO_COMMIT:0:8}" ]] || {
  echo "built version does not match UPSTREAM_XO" >&2; exit 1;
}
[[ -f "$rpm" ]] || { echo "RPM asset not found: $rpm" >&2; exit 1; }
[[ "$(basename "$rpm")" == xoa-hl-"$version"-*.rpm ]] || {
  echo "RPM asset name does not match built version" >&2; exit 1;
}
source_sha=$(git rev-parse HEAD)
rpm_name=$(basename "$rpm")
rpm_sha=$(sha256sum "$rpm" | cut -d ' ' -f 1)
patch_list=$(bash "$(dirname "$0")/list-patches.sh" patches)
mapfile -t patches <<< "$patch_list"
mkdir -p "$(dirname "$output")"
cat > "$output" <<EOF
## XOA-HL candidate build

- Release tag: \`$tag\`
- Built RPM: \`$rpm_name\` (SHA-256: \`$rpm_sha\`)
- Upstream Xen Orchestra: \`$XO_VERSION\` at [\`$XO_COMMIT\`](https://github.com/vatesfr/xen-orchestra/commit/$XO_COMMIT)
- XOA-HL source: [\`$source_sha\`](https://github.com/Vagrantin/xoa-hl/commit/$source_sha)
- Patch set: ${#patches[@]} files from [this source revision](https://github.com/Vagrantin/xoa-hl/tree/$source_sha/patches):
EOF
for patch in "${patches[@]}"; do
  printf '  - `%s`\n' "${patch#patches/}" >> "$output"
done
printf '\n## Changes since the previous release\n\n' >> "$output"
