#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"
require_safe_env
mkdir -p data/postgres data/uploads data/backups data/logs
chmod 711 data/postgres
chmod 2775 data/uploads
chmod 700 data/backups
"${COMPOSE[@]}" up -d
"${COMPOSE[@]}" ps
