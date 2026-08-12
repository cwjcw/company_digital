$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e

