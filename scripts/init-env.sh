#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ -e .env ]]; then
  echo ".env 已存在，未做任何修改。"
  exit 0
fi

command -v openssl >/dev/null || { echo "错误：需要 openssl 生成安全随机值。" >&2; exit 1; }
cp .env.example .env

database_password="$(openssl rand -hex 32)"
jwt_access_secret="$(openssl rand -hex 48)"
jwt_refresh_secret="$(openssl rand -hex 48)"

sed -i \
  -e "s/^DATABASE_PASSWORD=.*/DATABASE_PASSWORD=${database_password}/" \
  -e "s/^JWT_ACCESS_SECRET=.*/JWT_ACCESS_SECRET=${jwt_access_secret}/" \
  -e "s/^JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=${jwt_refresh_secret}/" \
  .env
chmod 600 .env
unset database_password jwt_access_secret jwt_refresh_secret
echo "已创建权限为 600 的本机 .env，并生成互不相同的随机数据库密码和 JWT 密钥。"

