$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$openDialog = New-Object Windows.Forms.OpenFileDialog
$openDialog.Title = "选择本地企业加密 Excel"
$openDialog.Filter = "Excel 工作簿 (*.xlsx)|*.xlsx"
$openDialog.Multiselect = $false
if ($openDialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { exit 0 }

$saveDialog = New-Object Windows.Forms.SaveFileDialog
$saveDialog.Title = "保存非加密 Excel"
$saveDialog.Filter = "Excel 工作簿 (*.xlsx)|*.xlsx"
$saveDialog.InitialDirectory = [IO.Path]::GetDirectoryName($openDialog.FileName)
$saveDialog.FileName = [IO.Path]::GetFileNameWithoutExtension($openDialog.FileName) + "_非加密.xlsx"
if ($saveDialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { exit 0 }

$converter = Join-Path $PSScriptRoot "convert-local-encrypted-excel.ps1"
& $converter -InputPath $openDialog.FileName -OutputPath $saveDialog.FileName
[Windows.Forms.MessageBox]::Show(
  "转换完成，可在凯南计划中心中导入：`r`n$($saveDialog.FileName)",
  "凯南计划中心",
  [Windows.Forms.MessageBoxButtons]::OK,
  [Windows.Forms.MessageBoxIcon]::Information
) | Out-Null
