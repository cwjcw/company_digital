param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$extractScript = Join-Path $PSScriptRoot "extract-encrypted-excel.ps1"
$rebuildScript = Join-Path $projectRoot "apps\api\scripts\rebuild-extracted-workbook.cjs"
$tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ("kainice-excel-" + [Guid]::NewGuid().ToString("N"))
$jsonPath = Join-Path $tempDirectory "workbook.json"

try {
  [IO.Directory]::CreateDirectory($tempDirectory) | Out-Null
  & $extractScript -InputPath ([IO.Path]::GetFullPath($InputPath)) -OutputPath $jsonPath
  & node.exe $rebuildScript $jsonPath ([IO.Path]::GetFullPath($OutputPath))
  if ($LASTEXITCODE -ne 0) { throw "标准 XLSX 重建失败" }
} finally {
  if (Test-Path -LiteralPath $tempDirectory) {
    Remove-Item -LiteralPath $tempDirectory -Recurse -Force
  }
}
