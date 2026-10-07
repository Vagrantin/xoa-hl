#!/bin/sh
# Run the transaction and stream it to a file the UI can tail.
set -eu

STATE_DIR=${XOA_HL_STATE_DIR:-/var/lib/xoa-hl}
LOG_FILE=${XOA_HL_UPDATE_LOG:-$STATE_DIR/update.log}
RC_FILE="$STATE_DIR/.update.rc"
LOCK_FILE=${XOA_HL_DNF_LOCK_FILE:-/run/xoa-hl/dnf.lock}
DNF_COMMAND=${DNF_COMMAND:-dnf}

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

{
    rc=0
    # Node.js is supplied by NodeSource. Keep the supported major pinned until
    # a deliberately tested XOA-HL release raises the RPM dependency bound.
    PYTHONUNBUFFERED=1 stdbuf -oL -eL "$DNF_COMMAND" -y --refresh --color=never --exclude=nodejs "$@" update 2>&1 || rc=$?
    printf '%s\n' "$rc" > "$RC_FILE"
} | tee -a "$LOG_FILE"

rc=$(cat "$RC_FILE" 2>/dev/null) || rc=1
rm -f "$RC_FILE"

if [ "$rc" -eq 0 ]; then
    printf '=== xoa-hl update finished successfully at %s ===\n' "$(stamp)" >> "$LOG_FILE"
else
    printf '=== xoa-hl update failed with exit code %s at %s ===\n' "$rc" "$(stamp)" >> "$LOG_FILE"
fi

exit "$rc"
