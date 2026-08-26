#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"
require_safe_env

mkdir -p data/backups
chmod 700 data/backups
timestamp="$(date +%Y%m%d_%H%M%S)"
database_file="data/backups/four_department_tracker_${timestamp}.backup"
kdos_database_file="data/backups/kdos_${timestamp}.backup"
uploads_file="data/backups/uploads_${timestamp}.tar.gz"
database_tmp="${database_file}.tmp"
kdos_database_tmp="${kdos_database_file}.tmp"
uploads_tmp="${uploads_file}.tmp"

"${COMPOSE[@]}" exec -T postgres pg_dump \
  -U "$(env_value DATABASE_USER)" -d "$(env_value DATABASE_NAME)" -Fc > "$database_tmp"
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$database_tmp" >/dev/null
mv "$database_tmp" "$database_file"
chmod 600 "$database_file"

kdos_database_name="$(env_value KDOS_DATABASE_NAME)"
kdos_database_name="${kdos_database_name:-kdos}"
"${COMPOSE[@]}" exec -T postgres pg_dump \
  -U "$(env_value DATABASE_USER)" -d "$kdos_database_name" -Fc > "$kdos_database_tmp"
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$kdos_database_tmp" >/dev/null
mv "$kdos_database_tmp" "$kdos_database_file"
chmod 600 "$kdos_database_file"

mkdir -p data/uploads
tar -C data -czf "$uploads_tmp" uploads
mv "$uploads_tmp" "$uploads_file"
chmod 600 "$uploads_file"

echo "数据库备份：$PROJECT_ROOT/$database_file"
echo "KDOS 数据库备份：$PROJECT_ROOT/$kdos_database_file"
echo "上传目录备份：$PROJECT_ROOT/$uploads_file"
sha256sum "$database_file" "$kdos_database_file" "$uploads_file"
