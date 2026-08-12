#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"
require_env
if (( $# > 0 )); then
  "${COMPOSE[@]}" logs --tail "${LOG_TAIL:-200}" -f "$@"
else
  "${COMPOSE[@]}" logs --tail "${LOG_TAIL:-200}" -f
fi
