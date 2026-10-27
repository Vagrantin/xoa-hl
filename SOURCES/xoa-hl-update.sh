#!/bin/sh
# Run the transaction and stream it to a file the UI can tail.
set -eu

STATE_DIR=${XOA_HL_STATE_DIR:-/var/lib/xoa-hl}
LOG_FILE=${XOA_HL_UPDATE_LOG:-$STATE_DIR/update.log}
RC_FILE="$STATE_DIR/.update.rc"
LOCK_FILE=${XOA_HL_DNF_LOCK_FILE:-/run/xoa-hl/dnf.lock}
DNF_COMMAND=${DNF_COMMAND:-dnf}
RPM_COMMAND=${RPM_COMMAND:-rpm}
CHECK_STATUS_FILE=${XOA_HL_CHECK_STATUS_FILE:-/run/xoa-hl/status}
CHECK_SCRIPT=${XOA_HL_CHECK_SCRIPT:-/usr/libexec/xoa-hl/check-update.sh}

# CHANNEL=testing in update.conf adds the candidate repo; anything else is stable.
if [ "$(sed -n 's/^CHANNEL=//p' "${XOA_HL_CONFIG_DIR:-/etc/xoa-hl}/update.conf" 2>/dev/null | head -n 1)" = testing ]; then
    set -- --enablerepo=xoa-hl-testing
else
    set --
fi

mkdir -p "$STATE_DIR" "$(dirname "$LOCK_FILE")"
: > "$LOG_FILE"
rm -f "$RC_FILE"

stamp() {
    date '+%Y-%m-%d %H:%M:%S %Z'
}

printf '=== xoa-hl update started at %s ===\n' "$(stamp)" >> "$LOG_FILE"
[ "$#" -eq 0 ] || printf '=== channel: testing ===\n' >> "$LOG_FILE"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    printf '=== another update operation is already running ===\n' >> "$LOG_FILE"
    exit 75
fi

# A pre-transaction package list must never survive this transaction.
rm -f "$CHECK_STATUS_FILE"

{
    rc=0
    # A successful DNF exit alone does not prove that a previous interrupted
    # transaction left a usable RPM database or complete kernel payloads.
    verify_packages() {
        "$DNF_COMMAND" --color=never "$@" check || return $?
        kernels=$("$RPM_COMMAND" -qa --qf '%{NAME}-%{VERSION}-%{RELEASE}.%{ARCH}\n' \
            'kernel-core' 'kernel-modules' 'kernel-modules-core') || return $?
        for kernel in $kernels; do
            "$RPM_COMMAND" -V "$kernel" || return $?
        done
    }
    if ! verify_packages "$@"; then
        echo 'Package integrity preflight failed; repair the interrupted transaction before retrying.'
        rc=1
    fi
    # Node.js is supplied by NodeSource. Keep the supported major pinned until
    # a deliberately tested XOA-HL release raises the RPM dependency bound.
    if [ "$rc" -eq 0 ]; then
        PYTHONUNBUFFERED=1 stdbuf -oL -eL "$DNF_COMMAND" -y --refresh --color=never --exclude=nodejs "$@" update 2>&1 || rc=$?
        if [ "$rc" -eq 0 ] && ! verify_packages "$@"; then
            echo 'Package integrity verification failed; update is not considered successful.'
            rc=1
        fi
    fi
    printf '%s\n' "$rc" > "$RC_FILE"
} 2>&1 | tee -a "$LOG_FILE"

rc=$(cat "$RC_FILE" 2>/dev/null) || rc=1
rm -f "$RC_FILE"

if [ "$rc" -eq 0 ]; then
    printf '=== xoa-hl update finished successfully at %s ===\n' "$(stamp)" >> "$LOG_FILE"
else
    printf '=== xoa-hl update failed with exit code %s at %s ===\n' "$rc" "$(stamp)" >> "$LOG_FILE"
fi

# Release the shared DNF lock before refreshing the stored package verdict.
flock -u 9
if [ "$rc" -eq 0 ] && [ -r "$CHECK_SCRIPT" ]; then
    sh "$CHECK_SCRIPT" || rm -f "$CHECK_STATUS_FILE"
fi

exit "$rc"
