#!/usr/bin/env bash
# What "checked" means for this repo (xcp-hl#148). Jenkins dev/xoa-hl runs it on every PR; run it locally too.
# Contract: exit 0 when clean; results under $CI_RESULTS; on failure $CI_RESULTS/current-step names the failed check.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${CI_RESULTS:-ci-results}"
mkdir -p "$OUT"
step() { echo "==> $1"; echo "$1" > "$OUT/current-step"; }

step "sh -n (SOURCES and tests)"
for s in SOURCES/*.sh tests/*.sh; do sh -n "$s"; done

step "shellcheck (warnings and errors)"
git ls-files -z '*.sh' | xargs -0 shellcheck -S warning

# The same test the test-update-scripts workflow runs.
step "update scripts test"
sh tests/test-update-scripts.sh

rm -f "$OUT/current-step"
echo "all checks passed"
