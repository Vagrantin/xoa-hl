#!/bin/sh
set -eu

STATUS_FILE=${XOA_HL_CHECK_STATUS_FILE:-/run/xoa-hl/status}
LOCK_FILE=${XOA_HL_DNF_LOCK_FILE:-/run/xoa-hl/dnf.lock}
DNF_COMMAND=${DNF_COMMAND:-dnf}

mkdir -p "$(dirname "$STATUS_FILE")" "$(dirname "$LOCK_FILE")"

# CHANNEL=testing in update.conf adds the candidate repo; anything else is stable.
if [ "$(sed -n 's/^CHANNEL=//p' "${XOA_HL_CONFIG_DIR:-/etc/xoa-hl}/update.conf" 2>/dev/null | head -n 1)" = testing ]; then
    set -- --enablerepo=xoa-hl-testing
else
    set --
fi

now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

write_status() {
    tmp="$STATUS_FILE.$$"
    cat > "$tmp"
    mv -f "$tmp" "$STATUS_FILE"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    {
        echo ERROR
        echo "checkedAt=$now"
        echo 'message=another update operation is already running'
    } | write_status
    exit 0
fi

out=$("$DNF_COMMAND" -y --refresh --color=never "$@" check-update 2>&1) && rc=0 || rc=$?

if [ "$rc" -eq 100 ]; then
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
    msg=$(printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -n 1) || msg=''
    [ -n "$msg" ] || msg="dnf check-update failed with exit code $rc"
    {
        echo ERROR
        echo "checkedAt=$now"
        printf 'message=%s\n' "$msg"
    } | write_status
fi
