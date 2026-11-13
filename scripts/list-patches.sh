#!/usr/bin/env bash
# Emit a complete validated series; build, source checks and notes share this order.
set -euo pipefail
patch_dir=${1:?patch directory required}
[[ -f "$patch_dir/series" ]] || { echo "Missing patch series" >&2; exit 1; }
declare -A seen=()
patches=()
while IFS= read -r name || [[ -n "$name" ]]; do
  [[ "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*\.patch$ ]] || { echo "Invalid series filename: $name" >&2; exit 1; }
  case "$name" in
    menu-hide-items.patch|xcp-hl-updates.patch|xoa-hl-update-api.patch) ;;
    *) [[ "$name" =~ ^[0-9]{3}-[a-z0-9]+(-[a-z0-9]+)*\.patch$ ]] || {
         echo "Use NNN-descriptive-name.patch: $name" >&2; exit 1;
       } ;;
  esac
  [[ -z "${seen[$name]:-}" && -f "$patch_dir/$name" ]] || { echo "Duplicate or missing patch: $name" >&2; exit 1; }
  seen[$name]=1
  patches+=("$patch_dir/$name")
done < "$patch_dir/series"
[[ ${#patches[@]} -gt 0 ]] || { echo 'Empty patch series' >&2; exit 1; }
for patch in "$patch_dir"/*.patch; do
  name=${patch##*/}
  [[ -n "${seen[$name]:-}" ]] || { echo "Unlisted patch: $name" >&2; exit 1; }
done
printf '%s\n' "${patches[@]}"
