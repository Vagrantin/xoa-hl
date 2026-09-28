#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

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

FAKE_DNF_RC=0 FAKE_DNF_OUTPUT='updated' sh "$repo_dir/SOURCES/xoa-hl-update.sh"
grep -F -- '--exclude=nodejs update' "$FAKE_DNF_ARGS" >/dev/null
grep -F 'finished successfully' "$state_dir/update.log" >/dev/null

fake_systemctl="$tmp_dir/systemctl"
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

echo 'update script tests passed'
