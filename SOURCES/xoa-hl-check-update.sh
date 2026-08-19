#!/bin/sh
set -eu

mkdir -p /run/xoa-hl

# -y: otherwise the first run stops to ask approval for the repo GPG key.
# --refresh: force fresh metadata, dnf's cache can hide a just-removed package.
out=$(dnf -y --refresh check-update xoa-hl 2>&1) && rc=0 || rc=$?

if [ "$rc" -eq 100 ]; then
    # dnf check-update: 100 means updates are available, not an error.
    # Strip the epoch prefix: the xo-server API reports the installed
    # version without it, the two must stay comparable.
    version=$(printf '%s\n' "$out" \
        | awk '/^xoa-hl\./ {v=$2; sub(/^[0-9]+:/, "", v); print v; exit}')
    printf 'AVAILABLE %s\n' "$version" > /run/xoa-hl/status
    exit 0
elif [ "$rc" -eq 0 ]; then
    printf 'UP_TO_DATE\n' > /run/xoa-hl/status
    exit 0
else
    exit "$rc"
fi
