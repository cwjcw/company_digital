#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"
require_safe_env

"$PROJECT_ROOT/scripts/backup.sh"
"${COMPOSE[@]}" build
"${COMPOSE[@]}" stop web api
"${COMPOSE[@]}" run --rm api node node_modules/typeorm/cli.js -d dist/data-source.js migration:run
"${COMPOSE[@]}" up -d
"$PROJECT_ROOT/scripts/healthcheck.sh"

