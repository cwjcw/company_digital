#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"
require_safe_env

target_database="$(env_value KDOS_DATABASE_NAME)"
if [[ -z "$target_database" ]]; then
  target_database="kdos"
fi
if [[ ! "$target_database" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "错误：KDOS_DATABASE_NAME 不是安全的 PostgreSQL 数据库名。" >&2
  exit 1
fi

"${COMPOSE[@]}" up -d postgres
wait_for_postgres
exists="$("${COMPOSE[@]}" exec -T postgres psql -XAt -U "$(env_value DATABASE_USER)" -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$target_database'")"
if [[ "$exists" == "1" ]]; then
  echo "KDOS 数据库已存在：$target_database"
else
  "${COMPOSE[@]}" exec -T postgres createdb -U "$(env_value DATABASE_USER)" "$target_database"
  echo "已创建 KDOS 数据库：$target_database"
fi
