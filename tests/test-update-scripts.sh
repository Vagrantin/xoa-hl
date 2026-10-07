#!/bin/sh
set -eu

repo_dir=${REPO_DIR:-$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)}
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

fake_dnf="$tmp_dir/dnf"
cat > "$fake_dnf" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" > "$FAKE_DNF_ARGS"
printf '%s\n' "${FAKE_DNF_OUTPUT:-}"
exit "${FAKE_DNF_RC:-0}"
EOF
chmod +x "$fake_dnf"

status_file="$tmp_dir/run/status"
lock_file="$tmp_dir/run/dnf.lock"
state_dir="$tmp_dir/state"
export DNF_COMMAND="$fake_dnf"
export FAKE_DNF_ARGS="$tmp_dir/dnf.args"
export XOA_HL_CHECK_STATUS_FILE="$status_file"
export XOA_HL_DNF_LOCK_FILE="$lock_file"
export XOA_HL_STATE_DIR="$state_dir"
export XOA_HL_UPDATE_LOG="$state_dir/update.log"

# Check results: available, current, and repository failure.
FAKE_DNF_RC=100 FAKE_DNF_OUTPUT='xoa-hl.x86_64 1:5.113.2 repo' \
    sh "$repo_dir/SOURCES/xoa-hl-check-update.sh"
[ "$(sed -n '1p' "$status_file")" = AVAILABLE ]
grep -F 'xoa-hl' "$status_file" >/dev/null

FAKE_DNF_RC=0 FAKE_DNF_OUTPUT='' sh "$repo_dir/SOURCES/xoa-hl-check-update.sh"
[ "$(sed -n '1p' "$status_file")" = UP_TO_DATE ]

FAKE_DNF_RC=1 FAKE_DNF_OUTPUT='repository unavailable' \
    sh "$repo_dir/SOURCES/xoa-hl-check-update.sh"
[ "$(sed -n '1p' "$status_file")" = ERROR ]
grep -F 'message=repository unavailable' "$status_file" >/dev/null

# Successful manual update keeps Node.js on its supported major.
FAKE_DNF_RC=0 FAKE_DNF_OUTPUT='updated' sh "$repo_dir/SOURCES/xoa-hl-update.sh"
grep -F -- '--exclude=nodejs update' "$FAKE_DNF_ARGS" >/dev/null
grep -F 'finished successfully' "$state_dir/update.log" >/dev/null

# A failed transaction is returned and retained in the log.
if FAKE_DNF_RC=23 FAKE_DNF_OUTPUT='transaction failed' sh "$repo_dir/SOURCES/xoa-hl-update.sh"; then
    fail 'a failed DNF transaction returned success'
else
    [ "$?" -eq 23 ] || fail 'the DNF exit status was not preserved'
fi
grep -F 'failed with exit code 23' "$state_dir/update.log" >/dev/null

# A scheduled/manual collision never starts a second DNF process.
(
    exec 8>"$lock_file"
    flock -x 8
    : > "$tmp_dir/lock-ready"
    sleep 2
) &
lock_holder=$!
while [ ! -e "$tmp_dir/lock-ready" ]; do sleep 0.01; done

sh "$repo_dir/SOURCES/xoa-hl-check-update.sh"
[ "$(sed -n '1p' "$status_file")" = ERROR ]
grep -F 'another update operation is already running' "$status_file" >/dev/null

if sh "$repo_dir/SOURCES/xoa-hl-update.sh"; then
    fail 'a concurrent update returned success'
else
    [ "$?" -eq 75 ] || fail 'lock contention did not return EX_TEMPFAIL'
fi
grep -F 'another update operation is already running' "$state_dir/update.log" >/dev/null
wait "$lock_holder"

fake_systemctl="$tmp_dir/auto-systemctl"
cat > "$fake_systemctl" <<'EOF'
#!/bin/sh
case "$*" in
    'start xoa-hl-check-update.service')
        mkdir -p "$(dirname "$XOA_HL_CHECK_STATUS_FILE")"
        printf '%s\n' "${FAKE_CHECK_VERDICT:-AVAILABLE}" > "$XOA_HL_CHECK_STATUS_FILE"
        ;;
    'start xoa-hl-update.service')
        exit "${FAKE_UPDATE_RC:-0}"
        ;;
    *)
        exit 1
        ;;
esac
EOF
chmod +x "$fake_systemctl"

export SYSTEMCTL_COMMAND="$fake_systemctl"
export XOA_HL_AUTO_STATUS_FILE="$state_dir/auto-update.status"

FAKE_CHECK_VERDICT=AVAILABLE FAKE_UPDATE_RC=0 sh "$repo_dir/SOURCES/xoa-hl-auto-update.sh"
grep -F 'result=succeeded' "$state_dir/auto-update.status" >/dev/null

FAKE_CHECK_VERDICT=UP_TO_DATE sh "$repo_dir/SOURCES/xoa-hl-auto-update.sh"
grep -F 'result=up_to_date' "$state_dir/auto-update.status" >/dev/null

# Configuration helper: validate all three modes and generated calendars.
fake_bin="$tmp_dir/bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/systemctl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SYSTEMCTL_LOG"
EOF
cat > "$fake_bin/systemd-analyze" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SYSTEMD_ANALYZE_LOG"
[ "$1" = calendar ]
EOF
cat > "$fake_bin/needs-restarting" <<'EOF'
#!/bin/sh
exit "${FAKE_REBOOT_RC:-0}"
EOF
chmod +x "$fake_bin/systemctl" "$fake_bin/systemd-analyze" "$fake_bin/needs-restarting"

export PATH="$fake_bin:$PATH"
export SYSTEMCTL_LOG="$tmp_dir/systemctl.log"
export SYSTEMD_ANALYZE_LOG="$tmp_dir/systemd-analyze.log"
export XOA_HL_CONFIG_DIR="$tmp_dir/etc/xoa-hl"
export XOA_HL_SYSTEMD_DIR="$tmp_dir/etc/systemd/system"
export XOA_HL_CONFIG_LOCK="$tmp_dir/configure.lock"

: > "$SYSTEMCTL_LOG"
sh "$repo_dir/SOURCES/xoa-hl-configure-updates.sh" check daily Sun 04:15 15
grep -Fx 'MODE=check' "$XOA_HL_CONFIG_DIR/update.conf" >/dev/null
grep -Fx 'OnCalendar=*-*-* 04:15:00' "$XOA_HL_SYSTEMD_DIR/xoa-hl-check-update.timer.d/schedule.conf" >/dev/null
grep -Fx 'enable --now xoa-hl-check-update.timer' "$SYSTEMCTL_LOG" >/dev/null

: > "$SYSTEMCTL_LOG"
sh "$repo_dir/SOURCES/xoa-hl-configure-updates.sh" install weekly Fri 02:30 30
grep -Fx 'MODE=install' "$XOA_HL_CONFIG_DIR/update.conf" >/dev/null
grep -Fx 'OnCalendar=Fri *-*-* 02:30:00' "$XOA_HL_SYSTEMD_DIR/xoa-hl-auto-update.timer.d/schedule.conf" >/dev/null
grep -Fx 'RandomizedDelaySec=30m' "$XOA_HL_SYSTEMD_DIR/xoa-hl-auto-update.timer.d/schedule.conf" >/dev/null
grep -Fx 'disable --now xoa-hl-check-update.timer' "$SYSTEMCTL_LOG" >/dev/null
grep -Fx 'enable --now xoa-hl-auto-update.timer' "$SYSTEMCTL_LOG" >/dev/null

: > "$SYSTEMCTL_LOG"
sh "$repo_dir/SOURCES/xoa-hl-configure-updates.sh" manual daily Sun 03:00 0
grep -Fx 'MODE=manual' "$XOA_HL_CONFIG_DIR/update.conf" >/dev/null
grep -Fx 'disable --now xoa-hl-check-update.timer xoa-hl-auto-update.timer' "$SYSTEMCTL_LOG" >/dev/null

config_checksum=$(cksum "$XOA_HL_CONFIG_DIR/update.conf")
if sh "$repo_dir/SOURCES/xoa-hl-configure-updates.sh" install weekly Fri 25:00 30 2>/dev/null; then
    fail 'an invalid time was accepted'
fi
[ "$(cksum "$XOA_HL_CONFIG_DIR/update.conf")" = "$config_checksum" ] || fail 'invalid input changed the configuration'

# Update channel: testing adds the candidate repo to check and update, and a
# schedule change keeps the choice.
sh "$repo_dir/SOURCES/xoa-hl-configure-updates.sh" channel testing
grep -Fx 'CHANNEL=testing' "$XOA_HL_CONFIG_DIR/update.conf" >/dev/null
grep -Fx 'MODE=manual' "$XOA_HL_CONFIG_DIR/update.conf" >/dev/null
FAKE_DNF_RC=0 FAKE_DNF_OUTPUT='' sh "$repo_dir/SOURCES/xoa-hl-check-update.sh"
grep -F -- '--enablerepo=xoa-hl-testing' "$FAKE_DNF_ARGS" >/dev/null
FAKE_DNF_RC=0 FAKE_DNF_OUTPUT='updated' sh "$repo_dir/SOURCES/xoa-hl-update.sh"
grep -F -- '--enablerepo=xoa-hl-testing' "$FAKE_DNF_ARGS" >/dev/null
grep -F 'channel: testing' "$state_dir/update.log" >/dev/null
sh "$repo_dir/SOURCES/xoa-hl-configure-updates.sh" install weekly Fri 02:30 30
grep -Fx 'CHANNEL=testing' "$XOA_HL_CONFIG_DIR/update.conf" >/dev/null
sh "$repo_dir/SOURCES/xoa-hl-configure-updates.sh" channel stable
[ "$(grep -c '^CHANNEL=' "$XOA_HL_CONFIG_DIR/update.conf")" -eq 1 ] || fail 'the channel line was duplicated'
grep -Fx 'CHANNEL=stable' "$XOA_HL_CONFIG_DIR/update.conf" >/dev/null
grep -Fx 'MODE=install' "$XOA_HL_CONFIG_DIR/update.conf" >/dev/null
FAKE_DNF_RC=0 FAKE_DNF_OUTPUT='' sh "$repo_dir/SOURCES/xoa-hl-check-update.sh"
if grep -F -- 'xoa-hl-testing' "$FAKE_DNF_ARGS" >/dev/null; then fail 'stable channel enabled the testing repo'; fi
FAKE_DNF_RC=0 FAKE_DNF_OUTPUT='updated' sh "$repo_dir/SOURCES/xoa-hl-update.sh"
if grep -F -- 'xoa-hl-testing' "$FAKE_DNF_ARGS" >/dev/null; then fail 'stable channel enabled the testing repo'; fi
if sh "$repo_dir/SOURCES/xoa-hl-configure-updates.sh" channel beta 2>/dev/null; then
    fail 'an unknown channel was accepted'
fi
grep -Fx 'CHANNEL=stable' "$repo_dir/SOURCES/xoa-hl-update.conf" >/dev/null
grep -Fx 'enabled=0' "$repo_dir/SOURCES/xoa-hl-testing.repo" >/dev/null

# An automatic failure remains durable, keeps the real exit status, and records
# the reboot requirement reported by needs-restarting.
if FAKE_CHECK_VERDICT=AVAILABLE FAKE_UPDATE_RC=42 FAKE_REBOOT_RC=1 \
    sh "$repo_dir/SOURCES/xoa-hl-auto-update.sh"; then
    fail 'a failed automatic update returned success'
else
    [ "$?" -eq 42 ] || fail 'automatic update lost the service exit status'
fi
grep -F 'result=failed' "$state_dir/auto-update.status" >/dev/null
grep -F 'exitCode=42' "$state_dir/auto-update.status" >/dev/null
grep -F 'rebootNeeded=yes' "$state_dir/auto-update.status" >/dev/null
grep -F "logPath=$state_dir/update.log" "$state_dir/auto-update.status" >/dev/null

# Packaging defaults: no unattended opt-in and no replay of a missed install.
grep -Fx 'MODE=manual' "$repo_dir/SOURCES/xoa-hl-update.conf" >/dev/null
grep -Fx 'AUTO_REBOOT=no' "$repo_dir/SOURCES/xoa-hl-update.conf" >/dev/null
grep -Fx 'Persistent=false' "$repo_dir/SOURCES/xoa-hl-auto-update.timer" >/dev/null
grep -Fx 'Persistent=true' "$repo_dir/SOURCES/xoa-hl-check-update.timer" >/dev/null
# NodeSource ships nodejs as epoch 2: an epoch-less bound can never be satisfied.
grep -F 'Requires:       (nodejs >= 2:24 with nodejs < 2:25)' "$repo_dir/SPECS/xoa-hl.spec" >/dev/null
if grep -E '^Requires:.*nodejs [<>=]+ [0-9]+[^0-9:]' "$repo_dir/SPECS/xoa-hl.spec" >/dev/null; then
    echo 'nodejs requirement without an epoch' >&2
    exit 1
fi

echo 'update acceptance tests passed'
