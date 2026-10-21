#!/usr/bin/env bash
# One daily orchestration entry. All data writes and delivery remain in KDOS.
set -Eeuo pipefail
cd /data/automation/code/work/PMC/knweb
mode="${1:---run}"
case "$mode" in --run|--update-only) ;; *) echo 'Usage: run-finance-daily.sh [--run|--update-only]' >&2; exit 64 ;; esac
exec 8>/tmp/kdos-finance-daily.lock
flock -n 8 || { echo 'Finance daily orchestration already running' >&2; exit 75; }

validate_result() {
  python3 -c '
import json, sys
try:
    result = json.loads([line for line in sys.stdin.read().splitlines() if line.strip()][-1])
    if result.get("status") != "SUCCESS": raise ValueError("unsuccessful task")
    print(json.dumps({key: result.get(key) for key in ("id", "changedCount", "enqueued", "skipped")}))
except (ValueError, IndexError, AttributeError):
    sys.exit("Finance daily stage did not return SUCCESS; inspect the task run history")
'
}

# Never send a summary after a failed/incomplete update, even if a command exits 0.
update_output="$(bash data-operations/e10/sync-finance-movements.sh INCREMENTAL)"
update_result="$(printf '%s\n' "$update_output" | validate_result)"
if [[ "$mode" == --update-only ]]; then
  summary_result='{"enqueued":0,"skipped":"UPDATE_ONLY_NO_NOTIFICATION"}'
else
  summary_output="$(bash data-operations/e10/push-finance-monthly-summary.sh)"
  summary_result="$(printf '%s\n' "$summary_output" | validate_result)"
fi
python3 - "$update_result" "$summary_result" <<'PY'
import datetime, json, sys
update, summary = map(json.loads, sys.argv[1:])
print(json.dumps({"status": "SUCCESS", "updateRunId": update["id"],
                  "changedCount": update["changedCount"], "enqueued": summary.get("enqueued") or 0,
                  "skipped": summary.get("skipped"),
                  "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}))
PY
