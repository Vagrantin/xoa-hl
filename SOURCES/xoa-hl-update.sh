#!/bin/sh
# Run the transaction and stream it to a file the UI can tail.
#
# Before this the only sink was the journal, and the unit is Type=oneshot, so
# systemd did not report the job done until ExecStart had exited: a UI that
# started the unit and waited got the whole update in one burst at the end.
# /var/lib rather than /run because an update can finish with a pending reboot,
# and a tmpfs log would be gone exactly when someone wants to read it.
set -eu

STATE_DIR=/var/lib/xoa-hl
LOG_FILE="$STATE_DIR/update.log"
RC_FILE="$STATE_DIR/.update.rc"

mkdir -p "$STATE_DIR"

# Truncated, not appended: the pane shows this run, not every run ever. The UI
# keys off the file's mtime to tell this run's log from the previous one's, so
# this has to be the first thing that happens.
: > "$LOG_FILE"
rm -f "$RC_FILE"

stamp() {
    date -u '+%Y-%m-%dT%H:%M:%SZ'
}

printf '=== xoa-hl update started at %s ===\n' "$(stamp)" >> "$LOG_FILE"

# PYTHONUNBUFFERED: dnf is a Python program and block-buffers its stdout when it
# is a pipe, which would keep the pane empty until the transaction ended -- the
# exact symptom this file exists to remove. stdbuf covers the helpers it spawns.
# --color=never: dnf's escape sequences are noise inside the UI's <pre>.
# The exit code travels through a file because $? after a pipeline is tee's, and
# PIPESTATUS is a bashism a /bin/sh script must not rely on.
{
    rc=0
    PYTHONUNBUFFERED=1 stdbuf -oL -eL dnf -y --color=never update 2>&1 || rc=$?
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
