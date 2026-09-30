#!/usr/bin/env bash
set -Eeuo pipefail

# 生产环境 E10 研发中心物料每日增量同步入口。
# token 只从当前环境或项目根目录 .env 读取，禁止写入脚本和 Git。
PROJECT_ROOT="/data/automation/code/work/PMC/knweb"
ENV_FILE="${KDOS_ENV_FILE:-$PROJECT_ROOT/.env}"
LOCK_FILE="/tmp/kdos-rd-items-incremental-sync.lock"

dotenv_value() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi
  if [[ -r "$ENV_FILE" ]]; then
    sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
  fi
}

internal_token="$(dotenv_value KDOS_RD_INTERNAL_TOKEN)"
tenant_id="$(dotenv_value KDOS_DEFAULT_TENANT_CODE)"
web_port="$(dotenv_value WEB_PORT)"
api_base_url="$(dotenv_value KDOS_RD_API_BASE_URL)"

if [[ -z "$internal_token" ]]; then
  printf '错误：未找到 KDOS_RD_INTERNAL_TOKEN，请检查生产环境 .env 或运行环境变量。\n' >&2
  exit 1
fi
if [[ -z "$tenant_id" ]]; then
  tenant_id="KAINAN"
fi
if [[ -z "$web_port" ]]; then
  web_port="15172"
fi
if [[ -z "$api_base_url" ]]; then
  api_base_url="http://127.0.0.1:${web_port}"
fi
api_base_url="${api_base_url%/}"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf '错误：已有研发中心 E10 增量同步正在执行。\n' >&2
  exit 1
fi

response_file="$(mktemp)"
cleanup() {
  rm -f -- "$response_file"
}
trap cleanup EXIT

set +e
http_code="$(curl \
  --silent \
  --show-error \
  --max-time 600 \
  --connect-timeout 15 \
  --request POST \
  --header "X-KDOS-Internal-Token: ${internal_token}" \
  --header "X-KDOS-Tenant-Id: ${tenant_id}" \
  --header 'Content-Type: application/json' \
  --data '{"mode":"INCREMENTAL"}' \
  --output "$response_file" \
  --write-out '%{http_code}' \
  "${api_base_url}/api/v1/internal/rd/items/sync")"
curl_exit=$?
set -e

if (( curl_exit != 0 )); then
  printf '错误：研发中心 E10 增量同步请求失败（curl exit=%s）。\n' "$curl_exit" >&2
  if [[ -s "$response_file" ]]; then
    cat "$response_file" >&2
    printf '\n' >&2
  fi
  exit "$curl_exit"
fi

cat "$response_file"
printf '\n'

if [[ ! "$http_code" =~ ^2[0-9][0-9]$ ]]; then
  printf '错误：研发中心 E10 增量同步返回 HTTP %s。\n' "$http_code" >&2
  exit 1
fi

if ! jq -e '
  .status == "SUCCESS"
  and ((.duplicateScan // {}).status != "FAILED")
  and ((.duplicateScan // {}).status != "RULE_MISMATCH")
' "$response_file" >/dev/null; then
  printf '错误：研发中心 E10 增量同步未返回成功状态。\n' >&2
  exit 1
fi

exit 0
