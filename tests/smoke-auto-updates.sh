#!/bin/sh
set -eu

exercise=false
case "${1:-}" in
    '') ;;
    --exercise-timers) exercise=true ;;
    *)
        echo "usage: $0 [--exercise-timers]" >&2
        exit 2
        ;;
esac

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

pass() {
    echo "PASS: $*"
}

HELPER=/usr/libexec/xoa-hl/configure-updates.sh
CONFIG=/etc/xoa-hl/update.conf
CHECK_TIMER=xoa-hl-check-update.timer
AUTO_TIMER=xoa-hl-auto-update.timer
CHECK_SERVICE=xoa-hl-check-update.service
STATUS=/run/xoa-hl/status

echo '== XOA-HL automatic-update appliance smoke test =='
rpm -q xoa-hl

for path in \
    "$HELPER" \
    /usr/libexec/xoa-hl/auto-update.sh \
    /usr/lib/systemd/system/xoa-hl-check-update.timer \
    /usr/lib/systemd/system/xoa-hl-auto-update.timer \
    /usr/lib/systemd/system/xoa-hl-auto-update.service \
    "$CONFIG"
do
    [ -e "$path" ] || fail "missing packaged file: $path"
done
pass 'all automatic-update files are packaged'

rpm -q --requires xoa-hl | grep -F 'nodejs < 2:25' >/dev/null ||
    fail 'the RPM does not bound the Node.js major version'
grep -F -- '--exclude=nodejs' /usr/libexec/xoa-hl/update.sh >/dev/null ||
    fail 'the system update does not exclude Node.js'
pass 'Node.js major-version protections are present'

[ "$(systemctl show "$CHECK_TIMER" --property=Persistent --value)" = yes ] ||
    fail 'scheduled checks are not persistent'
[ "$(systemctl show "$AUTO_TIMER" --property=Persistent --value)" = no ] ||
    fail 'automatic installation would replay a missed maintenance window'
pass 'timer persistence policies are correct'

grep -Fx 'AUTO_REBOOT=no' "$CONFIG" >/dev/null ||
    fail 'automatic reboot is not disabled'
pass 'automatic reboot remains disabled'

if [ "$exercise" != true ]; then
    cat <<'EOF'

Preflight passed without changing the appliance.
Run again during a maintenance window with:

  sudo ./tests/smoke-auto-updates.sh --exercise-timers

That mode temporarily exercises Manual, Check automatically, and Install
automatically, runs one update check, and restores the original configuration.
It never starts the automatic-install service.
EOF
    exit 0
fi

[ "$(id -u)" -eq 0 ] || fail '--exercise-timers must run as root'

# The file contains only values emitted by the validated helper.
# shellcheck disable=SC1090
. "$CONFIG"
original_mode=${MODE:-manual}
original_frequency=${FREQUENCY:-daily}
original_day=${DAY:-Sun}
original_time=${TIME:-03:00}
original_delay=${RANDOM_DELAY:-15m}
original_delay=${original_delay%m}
changed=false

restore() {
    rc=$?
    trap - EXIT HUP INT TERM
    if [ "$changed" = true ]; then
        echo 'Restoring the original automatic-update configuration...'
        "$HELPER" "$original_mode" "$original_frequency" "$original_day" "$original_time" "$original_delay" ||
            echo 'WARNING: automatic restoration failed; restore the saved values manually.' >&2
    fi
    exit "$rc"
}
trap restore EXIT HUP INT TERM

enabled_state() {
    systemctl is-enabled "$1" 2>/dev/null || true
}

echo 'Testing Manual mode...'
changed=true
"$HELPER" manual daily Sun 03:00 0
[ "$(enabled_state "$CHECK_TIMER")" = disabled ] || fail "$CHECK_TIMER remained enabled in Manual mode"
[ "$(enabled_state "$AUTO_TIMER")" = disabled ] || fail "$AUTO_TIMER remained enabled in Manual mode"
pass 'Manual mode disables both timers'

# Three days ahead ensures the temporary automatic-install timer cannot fire
# while this script verifies it and restores the original configuration.
future_day=$(LC_ALL=C date -d '+3 days' '+%a')

echo 'Testing Check automatically mode...'
"$HELPER" check weekly "$future_day" 03:00 0
[ "$(enabled_state "$CHECK_TIMER")" = enabled ] || fail "$CHECK_TIMER was not enabled"
[ "$(enabled_state "$AUTO_TIMER")" = disabled ] || fail "$AUTO_TIMER was enabled in check-only mode"
systemctl list-timers --all "$CHECK_TIMER" | grep -F "$CHECK_TIMER" >/dev/null ||
    fail "$CHECK_TIMER is absent from systemctl list-timers"
systemctl start "$CHECK_SERVICE"
[ -r "$STATUS" ] || fail 'the scheduled-check service did not write its status'
verdict=$(sed -n '1p' "$STATUS")
case "$verdict" in
    AVAILABLE|UP_TO_DATE|ERROR) ;;
    *) fail "unexpected update-check verdict: $verdict" ;;
esac
pass "Check automatically mode works; check result is $verdict"

echo 'Testing Install automatically scheduling without starting an install...'
"$HELPER" install weekly "$future_day" 03:00 0
[ "$(enabled_state "$CHECK_TIMER")" = disabled ] || fail "$CHECK_TIMER remained enabled in install mode"
[ "$(enabled_state "$AUTO_TIMER")" = enabled ] || fail "$AUTO_TIMER was not enabled"
next_run=$(systemctl show "$AUTO_TIMER" --property=NextElapseUSecRealtime --value)
[ -n "$next_run" ] && [ "$next_run" != n/a ] || fail 'the automatic-install timer has no next run'
[ "$(systemctl is-active xoa-hl-auto-update.service 2>/dev/null || true)" != active ] ||
    fail 'the automatic-install service started during the smoke test'
pass "Install automatically mode is scheduled for $next_run and was not executed"

echo 'Restoring the original configuration...'
"$HELPER" "$original_mode" "$original_frequency" "$original_day" "$original_time" "$original_delay"
changed=false
trap - EXIT HUP INT TERM
pass 'original configuration restored'

cat <<'EOF'

All non-destructive appliance checks passed.

Final reboot-only gate:
1. Configure Install automatically for a time a few minutes in the past.
2. Power the appliance off before that time and boot it afterwards.
3. Confirm xoa-hl-auto-update.service did not run:
     journalctl -b -u xoa-hl-auto-update.service
4. Restore the desired mode in Settings.

This last gate is deliberately manual because the smoke test must never reboot
an appliance or start an unattended DNF transaction on its own.
EOF
