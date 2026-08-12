#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"
require_safe_env

"${COMPOSE[@]}" up -d postgres
wait_for_postgres
"$PROJECT_ROOT/scripts/backup.sh"

echo "当前 migration 状态："
"${COMPOSE[@]}" run --rm api node node_modules/typeorm/cli.js -d dist/data-source.js migration:show
echo "开始执行待运行 migration（不会运行 seed）："
"${COMPOSE[@]}" run --rm api node node_modules/typeorm/cli.js -d dist/data-source.js migration:run

