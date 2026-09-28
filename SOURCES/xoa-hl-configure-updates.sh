#!/bin/sh
set -eu

usage() {
    echo "usage: $0 {manual|check|install} {daily|weekly} {Mon|Tue|Wed|Thu|Fri|Sat|Sun} HH:MM {0|5|10|15|30|60}" >&2
    exit 2
}

[ "$#" -eq 5 ] || usage
mode=$1
frequency=$2
day=$3
run_time=$4
random_minutes=$5

case "$mode" in manual|check|install) ;; *) usage ;; esac
case "$frequency" in daily|weekly) ;; *) usage ;; esac
case "$day" in Mon|Tue|Wed|Thu|Fri|Sat|Sun) ;; *) usage ;; esac
case "$random_minutes" in 0|5|10|15|30|60) ;; *) usage ;; esac

case "$run_time" in
    [0-1][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]) ;;
    *) usage ;;
esac

if [ "$frequency" = daily ]; then
    calendar="*-*-* $run_time:00"
else
    calendar="$day *-*-* $run_time:00"
fi

# Validate with systemd before changing any persistent file or enabled unit.
systemd-analyze calendar "$calendar" >/dev/null

CONFIG_DIR=${XOA_HL_CONFIG_DIR:-/etc/xoa-hl}
SYSTEMD_DIR=${XOA_HL_SYSTEMD_DIR:-/etc/systemd/system}
CONFIG_FILE="$CONFIG_DIR/update.conf"
CHECK_DROPIN_DIR="$SYSTEMD_DIR/xoa-hl-check-update.timer.d"
AUTO_DROPIN_DIR="$SYSTEMD_DIR/xoa-hl-auto-update.timer.d"
LOCK_FILE=${XOA_HL_CONFIG_LOCK:-/run/xoa-hl-configure-updates.lock}

exec 9>"$LOCK_FILE"
flock -x 9

mkdir -p "$CONFIG_DIR" "$CHECK_DROPIN_DIR" "$AUTO_DROPIN_DIR"
config_tmp=$(mktemp "$CONFIG_DIR/.update.conf.XXXXXX")
check_tmp=$(mktemp "$CHECK_DROPIN_DIR/.schedule.conf.XXXXXX")
auto_tmp=$(mktemp "$AUTO_DROPIN_DIR/.schedule.conf.XXXXXX")
trap 'rm -f "$config_tmp" "$check_tmp" "$auto_tmp"' EXIT HUP INT TERM

{
    printf 'MODE=%s\n' "$mode"
    printf 'FREQUENCY=%s\n' "$frequency"
    printf 'DAY=%s\n' "$day"
    printf 'TIME=%s\n' "$run_time"
    printf 'RANDOM_DELAY=%sm\n' "$random_minutes"
    printf 'AUTO_REBOOT=no\n'
} > "$config_tmp"

write_dropin() {
    target=$1
    {
        echo '[Timer]'
        echo 'OnCalendar='
        printf 'OnCalendar=%s\n' "$calendar"
        printf 'RandomizedDelaySec=%sm\n' "$random_minutes"
    } > "$target"
}

write_dropin "$check_tmp"
write_dropin "$auto_tmp"
chmod 0644 "$config_tmp" "$check_tmp" "$auto_tmp"
mv -f "$config_tmp" "$CONFIG_FILE"
mv -f "$check_tmp" "$CHECK_DROPIN_DIR/schedule.conf"
mv -f "$auto_tmp" "$AUTO_DROPIN_DIR/schedule.conf"
trap - EXIT HUP INT TERM

systemctl daemon-reload
case "$mode" in
    manual)
        systemctl disable --now xoa-hl-check-update.timer xoa-hl-auto-update.timer
        ;;
    check)
        systemctl disable --now xoa-hl-auto-update.timer
        systemctl enable --now xoa-hl-check-update.timer
        ;;
    install)
        systemctl disable --now xoa-hl-check-update.timer
        systemctl enable --now xoa-hl-auto-update.timer
        ;;
esac
