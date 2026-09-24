#!/usr/bin/env bash
set -Eeuo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"

usage() {
  echo "用法：$0 {web|api|all|check}" >&2
}

assert_deployable_worktree() {
  local record path
  local -a blocked=()
  while IFS= read -r record; do
    [[ -z "$record" ]] && continue
    path="${record:3}"
    [[ "$path" == *" -> "* ]] && path="${path##* -> }"
    path="${path#\"}"; path="${path%\"}"
    [[ "$path" == outputs/* ]] || blocked+=("$record")
  done < <(git status --porcelain=v1 --untracked-files=all)
  if (( ${#blocked[@]} > 0 )); then
    echo "错误：工作区存在未提交的源码或配置修改，拒绝部署；只允许 outputs/** 记录文件有修改。" >&2
    printf '  %s\n' "${blocked[@]}" >&2
    return 1
  fi
}

wait_for_url() {
  local name="$1" url="$2"
  local attempt
  for attempt in $(seq 1 60); do
    if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "错误：等待 $name 健康检查超时：$url" >&2
  return 1
}

json_field() {
  local field="$1"
  node -e '
    const field = process.argv[1].split(".");
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        let value = JSON.parse(input);
        for (const key of field) value = value?.[key];
        if (typeof value !== "string" || value.length === 0) process.exit(2);
        process.stdout.write(value);
      } catch { process.exit(2); }
    });
  ' "$field"
}

read_web_commit() {
  curl --fail --silent --show-error --max-time 10 "$BASE_URL/build-info.json?deploy-check=$(date +%s)" | json_field commit
}

read_api_commit() {
  curl --fail --silent --show-error --max-time 10 "$BASE_URL/api/v1/health" | json_field version.commit
}

display_commit() {
  local value="$1"
  if [[ "$value" =~ ^[0-9a-f]{40}$ ]]; then printf '%s' "${value:0:7}"; else printf '%s' "$value"; fi
}

check_versions() {
  local scope="${1:-all}"
  local web_commit="not-checked" api_commit="not-checked" consistent=true
  if [[ "$scope" == "all" || "$scope" == "web" ]]; then web_commit="$(read_web_commit 2>/dev/null || echo unavailable)"; fi
  if [[ "$scope" == "all" || "$scope" == "api" ]]; then api_commit="$(read_api_commit 2>/dev/null || echo unavailable)"; fi

  printf 'Repository HEAD : %s\n' "$(display_commit "$REPOSITORY_HEAD")"
  if [[ "$scope" == "all" || "$scope" == "web" ]]; then
    printf 'Web Build       : %s\n' "$(display_commit "$web_commit")"
    [[ "$web_commit" == "$REPOSITORY_HEAD" ]] || consistent=false
  fi
  if [[ "$scope" == "all" || "$scope" == "api" ]]; then
    printf 'API Build       : %s\n' "$(display_commit "$api_commit")"
    [[ "$api_commit" == "$REPOSITORY_HEAD" ]] || consistent=false
  fi
  if [[ "$consistent" == true ]]; then
    printf '\nSTATUS          : CONSISTENT\n'
    return 0
  fi
  printf '\nSTATUS          : MISMATCH\n' >&2
  return 1
}

build_services() {
  "${COMPOSE[@]}" build --build-arg "KDOS_BUILD_SHA=$REPOSITORY_HEAD" "$@"
}

deploy_web() {
  build_services web
  "${COMPOSE[@]}" up -d --no-deps web
  wait_for_url Web "$BASE_URL/health"
  wait_for_url "Web build info" "$BASE_URL/build-info.json"
  check_versions web
}

deploy_api() {
  build_services api
  "${COMPOSE[@]}" up -d --no-deps api
  wait_for_url API "$BASE_URL/api/v1/health"
  check_versions api
}

deploy_all() {
  build_services api web
  "${COMPOSE[@]}" up -d --no-deps api
  wait_for_url API "$BASE_URL/api/v1/health"
  "${COMPOSE[@]}" up -d --no-deps web
  wait_for_url Web "$BASE_URL/health"
  wait_for_url "Web build info" "$BASE_URL/build-info.json"
  wait_for_url API "$BASE_URL/api/v1/health"
  check_versions all
}

main() {
  local command="${1:-}" web_port
  [[ "$command" =~ ^(web|api|all|check)$ ]] || { usage; return 2; }
  require_safe_env
  assert_deployable_worktree
  REPOSITORY_HEAD="$(git rev-parse HEAD)"
  web_port="${WEB_PORT_OVERRIDE:-$(env_value WEB_PORT)}"
  BASE_URL="http://127.0.0.1:${web_port:-15172}"
  case "$command" in
    web) deploy_web ;;
    api) deploy_api ;;
    all) deploy_all ;;
    check)
      wait_for_url Web "$BASE_URL/health"
      wait_for_url API "$BASE_URL/api/v1/health"
      check_versions all
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
