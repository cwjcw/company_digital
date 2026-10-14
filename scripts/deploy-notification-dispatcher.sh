#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy.sh"
unit="kdos-notification-dispatcher.service"
[[ "$RUNTIME_ROOT" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "Unsupported runtime path for systemd release" >&2; exit 1; }
systemctl --user is-active --quiet "$unit" || { echo "Existing Dispatcher is not active; refusing to install an additional service" >&2; exit 1; }
# Uses the same clean-source gate as standard deployment, without touching unrelated runtime edits.
assert_deployable_worktree
release_sha="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
release_dir="$RUNTIME_ROOT/data/notification-dispatcher-releases/$release_sha"
receipt_dir="$RUNTIME_ROOT/data/notification-delivery-receipts"
dropin_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$unit.d"
mkdir -p "$release_dir" "$receipt_dir" "$dropin_dir"
chmod 700 "$release_dir" "$receipt_dir"
install -m 444 "$PROJECT_ROOT/automation/wechat_push_projects/kdos-notification-dispatcher/dispatcher.py" "$release_dir/dispatcher.py"
python3 -m py_compile "$release_dir/dispatcher.py"
[[ ! -f "$dropin_dir/kdos-release.conf" ]] || cp -p "$dropin_dir/kdos-release.conf" "$release_dir/previous-release.conf"
# Existing base unit/environment and polling frequency remain unchanged.
printf '[Service]\nExecStart=\nExecStart=/data/automation/code/work/basci/basic_code/.venv/bin/python %s/dispatcher.py\nEnvironment=KDOS_NOTIFICATION_RECEIPT_DIR=%s\n' "$release_dir" "$receipt_dir" > "$dropin_dir/kdos-release.conf"
chmod 600 "$dropin_dir/kdos-release.conf"
systemctl --user daemon-reload
systemctl --user restart "$unit"
systemctl --user is-active --quiet "$unit"
printf 'Dispatcher release: %s\n' "$release_sha"
sha256sum "$release_dir/dispatcher.py"
