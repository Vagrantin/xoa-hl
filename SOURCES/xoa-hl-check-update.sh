#!/bin/sh
set -eu

STATUS_FILE=/run/xoa-hl/status

# Created here rather than with RuntimeDirectory=: systemd deletes a
# RuntimeDirectory when the unit stops, and this Type=oneshot unit stops the
# moment the check ends -- taking the result with it.
mkdir -p /run/xoa-hl

now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# Written through a temp file: the UI reads this one while we write it.
write_status() {
    tmp="$STATUS_FILE.$$"
    cat > "$tmp"
    mv -f "$tmp" "$STATUS_FILE"
}

# -y: otherwise the first run stops to ask approval for the repo GPG key.
# --refresh: force fresh metadata, dnf's cache can hide a just-removed package.
# --color=never: escape sequences would end up inside the status file.
out=$(dnf -y --refresh --color=never check-update 2>&1) && rc=0 || rc=$?

if [ "$rc" -eq 100 ]; then
    # dnf check-update: 100 means updates are available, not an error.
    # One name<TAB>version per line, epoch stripped so it matches what
    # "rpm -q" reports for an installed package. Metadata lines carry a
    # "key=value" shape instead, which is what tells the two apart.
    {
        echo AVAILABLE
        echo "checkedAt=$now"
        printf '%s\n' "$out" | awk '
            NF == 3 && $1 ~ /\./ {
                name = $1
                sub(/\.[^.]*$/, "", name)
                ver = $2
                sub(/^[0-9]+:/, "", ver)
                print name "\t" ver
            }
        '
    } | write_status
elif [ "$rc" -eq 0 ]; then
    {
        echo UP_TO_DATE
        echo "checkedAt=$now"
    } | write_status
else
    # A failed check is a result to show, not a unit failure. Exiting non-zero
    # here would only surface as "systemctl start failed" and would leave the
    # previous verdict on screen -- a stale "Up to date" is the one thing the
    # page must never say. The dnf output stays in this unit's journal.
    msg=$(printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -n 1) || msg=''
    [ -n "$msg" ] || msg="dnf check-update failed with exit code $rc"
    {
        echo ERROR
        echo "checkedAt=$now"
        printf 'message=%s\n' "$msg"
    } | write_status
fi
