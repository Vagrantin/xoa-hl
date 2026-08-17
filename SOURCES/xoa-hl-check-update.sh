#!/bin/sh
set -eu

mkdir -p /run/xoa-hl

out=$(dnf check-update xoa-hl 2>&1) && rc=0 || rc=$?

if [ "$rc" -eq 100 ]; then
    # dnf check-update: 100 means updates are available, not an error.
    version=$(printf '%s\n' "$out" | awk '/^xoa-hl\./ {print $2; exit}')
    printf 'AVAILABLE %s\n' "$version" > /run/xoa-hl/status
    exit 0
elif [ "$rc" -eq 0 ]; then
    printf 'UP_TO_DATE\n' > /run/xoa-hl/status
    exit 0
else
    exit "$rc"
fi
