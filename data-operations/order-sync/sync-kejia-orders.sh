#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/data/automation/code/work/PMC/knweb"
PYTHON_BIN="/data/automation/code/work/basci/basic_code/.venv/bin/python"
LOCK_FILE="/tmp/kdos-erp-order-sync-tplus-kejia.lock"
# KN-MPS-LIVE-002：N8N 唯一入口只允许同步科加账套。
# 允许用环境变量覆盖，但除了 tplus-kejia 之外的任何来源都必须fail closed，防止误同步其他账套。
ALLOWED_SOURCE="tplus-kejia"
SOURCE_KEY="${KNPLAN_ALLOWED_SOURCE:-$ALLOWED_SOURCE}"
if [[ "$SOURCE_KEY" != "$ALLOWED_SOURCE" ]]; then
  printf '拒绝执行：本入口只允许同步 %s（收到 KNPLAN_ALLOWED_SOURCE=%s）\n' "$ALLOWED_SOURCE" "$SOURCE_KEY" >&2
  exit 1
fi

cd "$PROJECT_ROOT"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf '%s\n' '{"event":"erp_sync_skipped","source":"tplus-kejia","reason":"already_running"}'
  exit 0
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  printf 'Python 运行环境不存在或不可执行：%s\n' "$PYTHON_BIN" >&2
  exit 1
fi

export PYTHONPATH="/data/automation/code/work/basci/basic_code${PYTHONPATH:+:$PYTHONPATH}"

"$PYTHON_BIN" data-operations/order-sync/sync.py run --source "$SOURCE_KEY"
"$PYTHON_BIN" data-operations/order-sync/project.py --consumer sales-orders-v1
