#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"
require_safe_env

# Do not recreate a running retained database for network/Compose metadata changes.
if [[ -z "$("${COMPOSE[@]}" ps -q postgres)" ]]; then
  "${COMPOSE[@]}" up -d postgres
fi
wait_for_postgres
"$PROJECT_ROOT/scripts/backup.sh"

echo "当前 migration 状态："
"${COMPOSE[@]}" run --rm --no-deps api node node_modules/typeorm/cli.js -d dist/data-source.js migration:show
echo "开始执行待运行 migration（不会运行 seed）："
"${COMPOSE[@]}" run --rm --no-deps api node node_modules/typeorm/cli.js -d dist/data-source.js migration:run

