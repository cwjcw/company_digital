param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$Password
)

$ErrorActionPreference = "Stop"
$excel = $null
$workbook = $null

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false
  $excel.AutomationSecurity = 3

  if ([string]::IsNullOrWhiteSpace($Password)) {
    $workbook = $excel.Workbooks.Open($InputPath, 0, $true)
  } else {
    $workbook = $excel.Workbooks.Open($InputPath, 0, $true, $null, $Password)
  }

  $workbook.SaveAs($OutputPath, 51)
} finally {
  if ($workbook) {
    $workbook.Close($false)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook)
  }
  if ($excel) {
    $excel.Quit()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
