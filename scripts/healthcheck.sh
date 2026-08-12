#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"
require_safe_env

base_url="http://127.0.0.1:$(env_value WEB_PORT)"
"${COMPOSE[@]}" ps
"${COMPOSE[@]}" exec -T postgres pg_isready \
  -U "$(env_value DATABASE_USER)" -d "$(env_value DATABASE_NAME)"
for attempt in $(seq 1 30); do
  if curl --fail --silent "$base_url/api/v1/health" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "30" ]]; then
    echo "等待 API 健康检查超时（60 秒）" >&2
    exit 1
  fi
  sleep 2
done
curl --fail --silent --show-error "$base_url/health" >/dev/null
curl --fail --silent --show-error "$base_url/api/v1/health" >/dev/null
curl --fail --silent --show-error "$base_url/api/docs" >/dev/null
curl --fail --silent --show-error "$base_url/api/openapi.json" >/dev/null
curl --fail --silent --show-error "$base_url/" >/dev/null
echo "Web、API、Swagger、OpenAPI 与 PostgreSQL 健康检查通过。"
