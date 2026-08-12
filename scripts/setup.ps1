$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host "检查 Node.js、pnpm 与 PostgreSQL..."
node -v
pnpm -v
$Psql = Get-ChildItem -LiteralPath "C:\Program Files\PostgreSQL","D:\Program Files\PostgreSQL" -Recurse -Filter psql.exe -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $Psql) { throw "未找到 psql.exe，请确认 PostgreSQL 已安装。" }
& $Psql --version

if (-not (Test-Path -LiteralPath ".env")) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Warning "已创建 .env。请先填写数据库密码和两个 JWT 密钥，再重新运行本脚本。"
  exit 2
}

$EnvValues = @{}
Get-Content -LiteralPath ".env" -Encoding UTF8 | ForEach-Object {
  if ($_ -match "^\s*([^#][^=]*)=(.*)$") { $EnvValues[$matches[1].Trim()] = $matches[2].Trim() }
}
foreach ($Required in @("DATABASE_HOST","DATABASE_PORT","DATABASE_USER","DATABASE_PASSWORD","DATABASE_NAME","JWT_ACCESS_SECRET","JWT_REFRESH_SECRET")) {
  if (-not $EnvValues[$Required] -or $EnvValues[$Required] -match "^replace") { throw ".env 中的 $Required 尚未填写。" }
}

$env:PGPASSWORD = $EnvValues["DATABASE_PASSWORD"]
$Exists = & $Psql -h $EnvValues["DATABASE_HOST"] -p $EnvValues["DATABASE_PORT"] -U $EnvValues["DATABASE_USER"] -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$($EnvValues["DATABASE_NAME"].Replace("'","''"))'"
if ($Exists -ne "1") {
  $CreateDb = Join-Path (Split-Path -Parent $Psql) "createdb.exe"
  & $CreateDb -h $EnvValues["DATABASE_HOST"] -p $EnvValues["DATABASE_PORT"] -U $EnvValues["DATABASE_USER"] $EnvValues["DATABASE_NAME"]
}

pnpm install
pnpm db:migrate
pnpm db:seed
Write-Host "初始化完成。运行 .\scripts\dev.ps1 启动系统。"

