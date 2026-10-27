#!/bin/sh
set -eu

STATE_DIR=${XOA_HL_STATE_DIR:-/var/lib/xoa-hl}
STATUS_FILE=${XOA_HL_AUTO_STATUS_FILE:-$STATE_DIR/auto-update.status}
CHECK_STATUS_FILE=${XOA_HL_CHECK_STATUS_FILE:-/run/xoa-hl/status}
SYSTEMCTL_COMMAND=${SYSTEMCTL_COMMAND:-systemctl}
UPDATE_LOG=${XOA_HL_UPDATE_LOG:-$STATE_DIR/update.log}
POLL_INTERVAL=${XOA_HL_POLL_INTERVAL:-2}
HISTORY_HELPER=${XOA_HL_HISTORY_HELPER:-/usr/libexec/xoa-hl/update-history.py}
RPM_COMMAND=${RPM_COMMAND:-rpm}
DNF_COMMAND=${DNF_COMMAND:-dnf}

mkdir -p "$STATE_DIR"
started_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
# Reference point: only a log newer than this belongs to the current run.
run_ref=$(mktemp "$STATE_DIR/.auto-update.XXXXXX")
before_file="$run_ref.before"
after_file="$run_ref.after"
trap 'rm -f "$run_ref" "$before_file" "$after_file"' EXIT

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
    finished_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    write_state "$result" "$exit_code" "$reboot_needed" "$finished_at"
    if [ -r "$HISTORY_HELPER" ]; then
        if [ -f "$before_file" ]; then
            "$RPM_COMMAND" -qa --qf '%{NAME}.%{ARCH}\t%{EPOCHNUM}:%{VERSION}-%{RELEASE}\n' > "$after_file" || rm -f "$after_file"
        fi
        python3 "$HISTORY_HELPER" --path "$STATE_DIR/auto-update-history.json" \
            --before "$before_file" --after "$after_file" --startedAt "$started_at" \
            --finishedAt "$finished_at" --result "$result" --exitCode "$exit_code" \
            --rebootNeeded "$reboot_needed" || echo 'Could not save automatic update history' >&2
    fi
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

# Print the exit code update.sh logged for this run, or nothing if none yet.
logged_update_rc() {
    [ -n "$(find "$UPDATE_LOG" -newer "$run_ref" 2>/dev/null)" ] || return 0
    last=$(tail -n 1 "$UPDATE_LOG" 2>/dev/null) || return 0
    case "$last" in
        '=== xoa-hl update finished successfully'*) echo 0 ;;
        '=== xoa-hl update failed with exit code '*)
            rc=${last#'=== xoa-hl update failed with exit code '}
            echo "${rc%% *}"
            ;;
        '=== another update operation is already running'*) echo 75 ;;
    esac
}

"$RPM_COMMAND" -qa --qf '%{NAME}.%{ARCH}\t%{EPOCHNUM}:%{VERSION}-%{RELEASE}\n' > "$before_file" || rm -f "$before_file"
if "$SYSTEMCTL_COMMAND" start xoa-hl-update.service; then
    update_rc=0
else
    update_rc=$?
    # Upgrading glibc can reset the D-Bus link under systemctl while the
    # update goes on. Wait for it and trust the log, not the client status.
    idle=0
    while [ "$idle" -lt 5 ]; do
        logged=$(logged_update_rc)
        if [ -n "$logged" ]; then
            update_rc=$logged
            break
        fi
        if "$SYSTEMCTL_COMMAND" is-active --quiet xoa-hl-update.service; then
            idle=0
        else
            idle=$((idle + 1))
        fi
        sleep "$POLL_INTERVAL"
    done
fi

reboot_needed=unknown
if [ -e /run/reboot-required ]; then
    reboot_needed=yes
else
    # EL9 supplies the command as a DNF plugin rather than a standalone tool.
    if command -v needs-restarting >/dev/null 2>&1; then
        set -- needs-restarting -r
    else
        set -- "$DNF_COMMAND" needs-restarting -r
    fi
    if "$@" >/dev/null 2>&1; then
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
