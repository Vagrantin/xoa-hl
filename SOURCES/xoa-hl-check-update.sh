#!/bin/sh
set -eu

mkdir -p /run/xoa-hl

# -y: otherwise the first run stops to ask approval for the repo GPG key.
# --refresh: force fresh metadata, dnf's cache can hide a just-removed package.
out=$(dnf -y --refresh check-update 2>&1) && rc=0 || rc=$?

if [ "$rc" -eq 100 ]; then
    # dnf check-update: 100 means updates are available, not an error.
    # One name<TAB>version per line, epoch stripped so it matches what
    # "rpm -q" reports for an installed package.
    {
        echo AVAILABLE
        printf '%s\n' "$out" | awk '
            NF == 3 && $1 ~ /\./ {
                name = $1
                sub(/\.[^.]*$/, "", name)
                ver = $2
                sub(/^[0-9]+:/, "", ver)
                print name "\t" ver
            }
        '
    } > /run/xoa-hl/status
    exit 0
elif [ "$rc" -eq 0 ]; then
    printf 'UP_TO_DATE\n' > /run/xoa-hl/status
    exit 0
else
    exit "$rc"
fi
