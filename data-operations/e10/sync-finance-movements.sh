#!/usr/bin/env bash
set -Eeuo pipefail
cd /data/automation/code/work/PMC/knweb
# A n8n SSH node invokes this entry; existing timers, credentials and six PMC flags are unchanged.
exec 9>/tmp/kdos-finance-movements.lock
flock -n 9 || { echo 'Finance movement synchronization already running' >&2; exit 75; }
exec docker compose --env-file .env -f compose.yaml exec -T api node /app/data-operations/e10/run-finance-movements-sync.cjs "${1:-INCREMENTAL}"
