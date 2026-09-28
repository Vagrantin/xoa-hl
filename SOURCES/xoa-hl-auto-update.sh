#!/bin/sh
set -eu

STATE_DIR=${XOA_HL_STATE_DIR:-/var/lib/xoa-hl}
STATUS_FILE=${XOA_HL_AUTO_STATUS_FILE:-$STATE_DIR/auto-update.status}
CHECK_STATUS_FILE=${XOA_HL_CHECK_STATUS_FILE:-/run/xoa-hl/status}
SYSTEMCTL_COMMAND=${SYSTEMCTL_COMMAND:-systemctl}
UPDATE_LOG=${XOA_HL_UPDATE_LOG:-$STATE_DIR/update.log}

mkdir -p "$STATE_DIR"
started_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

write_state() {
    result=$1
    exit_code=$2
    reboot_needed=$3
    finished_at=$4
    tmp="$STATUS_FILE.$$"
    {
        printf 'startedAt=%s\n' "$started_at"
        printf 'finishedAt=%s\n' "$finished_at"
        printf 'result=%s\n' "$result"
        printf 'exitCode=%s\n' "$exit_code"
        printf 'rebootNeeded=%s\n' "$reboot_needed"
        printf 'logPath=%s\n' "$UPDATE_LOG"
    } > "$tmp"
    mv -f "$tmp" "$STATUS_FILE"
}

finish() {
    result=$1
    exit_code=$2
    reboot_needed=$3
    write_state "$result" "$exit_code" "$reboot_needed" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    exit "$exit_code"
}

write_state running 0 unknown ''

# Always check fresh inside the maintenance window. The check and update
# scripts share a lock, so a manual transaction wins cleanly rather than
# starting a second DNF process.
if ! "$SYSTEMCTL_COMMAND" start xoa-hl-check-update.service; then
    finish check_failed 1 unknown
fi

if [ ! -r "$CHECK_STATUS_FILE" ]; then
    finish check_failed 1 unknown
fi

verdict=$(sed -n '1p' "$CHECK_STATUS_FILE")
case "$verdict" in
    UP_TO_DATE)
        finish up_to_date 0 no
        ;;
    AVAILABLE)
        ;;
    *)
        finish check_failed 1 unknown
        ;;
esac

if "$SYSTEMCTL_COMMAND" start xoa-hl-update.service; then
    update_rc=0
else
    update_rc=$?
fi

reboot_needed=unknown
if [ -e /run/reboot-required ]; then
    reboot_needed=yes
elif command -v needs-restarting >/dev/null 2>&1; then
    if needs-restarting -r >/dev/null 2>&1; then
        reboot_needed=no
    else
        needs_rc=$?
        if [ "$needs_rc" -eq 1 ]; then
            reboot_needed=yes
        fi
    fi
fi

if [ "$update_rc" -eq 0 ]; then
    finish succeeded 0 "$reboot_needed"
fi
finish failed "$update_rc" "$reboot_needed"
