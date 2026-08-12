#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"
require_safe_env

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "用法：scripts/restore.sh <备份文件绝对路径> [期望的SHA256]" >&2
  exit 2
fi

backup_file="$(realpath "$1")"
expected_sha="${2:-}"
[[ -r "$backup_file" ]] || { echo "错误：备份文件不可读：$backup_file" >&2; exit 1; }

actual_sha="$(sha256sum "$backup_file" | awk '{print $1}')"
if [[ -n "$expected_sha" && "${actual_sha,,}" != "${expected_sha,,}" ]]; then
  echo "错误：SHA256 不匹配，未执行恢复。" >&2
  echo "实际值：$actual_sha" >&2
  exit 1
fi
echo "SHA256 校验通过：$actual_sha"

mkdir -p data/postgres data/uploads data/backups data/logs
chmod 711 data/postgres
chmod 2775 data/uploads
chmod 700 data/backups
"${COMPOSE[@]}" up -d postgres
wait_for_postgres

"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$backup_file" >/dev/null
echo "备份格式可由目标 PostgreSQL 工具读取。"

object_count="$("${COMPOSE[@]}" exec -T postgres psql -XAt \
  -U "$(env_value DATABASE_USER)" -d "$(env_value DATABASE_NAME)" \
  -c "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S');")"
if [[ "$object_count" != "0" ]]; then
  echo "错误：目标数据库 public schema 非空（对象数：$object_count），为避免覆盖已停止恢复。" >&2
  echo "请先运行 scripts/backup.sh 并使用新的空数据库恢复。" >&2
  exit 1
fi

restore_log="data/logs/restore_$(date +%Y%m%d_%H%M%S).log"
set +e
"${COMPOSE[@]}" exec -T postgres pg_restore \
  --exit-on-error --no-owner --no-privileges \
  -U "$(env_value DATABASE_USER)" -d "$(env_value DATABASE_NAME)" \
  < "$backup_file" 2>&1 | tee "$restore_log"
restore_status=${PIPESTATUS[0]}
set -e
if (( restore_status != 0 )); then
  echo "错误：恢复失败。没有执行清库；错误已记录在 $PROJECT_ROOT/$restore_log" >&2
  exit "$restore_status"
fi

table_count="$("${COMPOSE[@]}" exec -T postgres psql -XAt \
  -U "$(env_value DATABASE_USER)" -d "$(env_value DATABASE_NAME)" \
  -c "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")"
echo "恢复完成，public schema 表数量：$table_count"
echo "尚未运行 seed 或 migration。"
