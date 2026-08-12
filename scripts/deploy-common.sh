#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose --project-directory "$PROJECT_ROOT" --env-file "$PROJECT_ROOT/.env")

cd "$PROJECT_ROOT"

require_env() {
  if [[ ! -f .env ]]; then
    echo "错误：未找到 $PROJECT_ROOT/.env，请先运行 scripts/init-env.sh。" >&2
    exit 1
  fi
}

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" .env | tail -n 1
}

require_safe_env() {
  require_env
  local key value
  for key in DATABASE_NAME DATABASE_USER DATABASE_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
    value="$(env_value "$key")"
    if [[ -z "$value" || "$value" == replace* ]]; then
      echo "错误：.env 中的 $key 尚未安全配置。" >&2
      exit 1
    fi
  done
  if [[ "$(env_value JWT_ACCESS_SECRET)" == "$(env_value JWT_REFRESH_SECRET)" ]]; then
    echo "错误：两个 JWT 密钥不能相同。" >&2
    exit 1
  fi
}

wait_for_postgres() {
  local attempts=40
  while (( attempts > 0 )); do
    if "${COMPOSE[@]}" exec -T postgres pg_isready \
      -U "$(env_value DATABASE_USER)" -d "$(env_value DATABASE_NAME)" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done
  echo "错误：PostgreSQL 未在预期时间内通过健康检查。" >&2
  return 1
}

