#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/data/automation/code/work/PMC/knweb"
PYTHON_BIN="/data/automation/code/work/basci/basic_code/.venv/bin/python"
LOCK_FILE="/tmp/kdos-erp-order-sync-tplus-kejia.lock"

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

"$PYTHON_BIN" data-operations/order-sync/sync.py run --source tplus-kejia
"$PYTHON_BIN" data-operations/order-sync/project.py --consumer sales-orders-v1
