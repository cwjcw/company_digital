#!/usr/bin/env bash
set -Eeuo pipefail
cd /data/automation/code/work/PMC/knweb
exec 9>/tmp/kdos-finance-monthly-summary.lock
flock -n 9 || { echo 'Finance monthly summary already running' >&2; exit 75; }
exec docker compose --env-file .env -f compose.yaml exec -T api node /app/data-operations/e10/run-finance-monthly-summary.cjs "${1:---dispatch}"
