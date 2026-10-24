#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# shellcheck source=../UPSTREAM_XO
. ./UPSTREAM_XO
version="${XO_VERSION}_${XO_COMMIT:0:8}"
rpm="$tmp/xoa-hl-${version}-42.gtest.xcpng8.3.x86_64.rpm"
printf 'fixture RPM' > "$rpm"
scripts/release-notes.sh "v${version}-ce42" "$version" "$rpm" "$tmp/notes.md"
grep -Fq "Release tag: \`v${version}-ce42\`" "$tmp/notes.md"
grep -Fq "$(basename "$rpm")" "$tmp/notes.md"
grep -Fq "$XO_COMMIT" "$tmp/notes.md"
grep -Fq "$(git rev-parse HEAD)" "$tmp/notes.md"
grep -Fq '## Changes since the previous release' "$tmp/notes.md"
count=$(find patches -maxdepth 1 -name '*.patch' -type f | wc -l)
grep -Fq "Patch set: $count files" "$tmp/notes.md"
if scripts/release-notes.sh "v${version}-ce42" wrong-version "$rpm" "$tmp/wrong.md"; then
  echo 'mismatched upstream version was accepted' >&2
  exit 1
fi
echo 'release notes fixture passed'
