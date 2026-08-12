$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
if (-not (Test-Path -LiteralPath ".env")) { throw "缺少 .env，请先运行 .\scripts\setup.ps1。" }
pnpm dev

