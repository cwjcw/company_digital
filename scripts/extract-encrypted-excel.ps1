param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$excel = $null
$workbook = $null
$worksheets = New-Object System.Collections.Generic.List[object]

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false
  $excel.AutomationSecurity = 3
  $workbook = $excel.Workbooks.Open($InputPath, 0, $true)

  foreach ($worksheet in $workbook.Worksheets) {
    $usedRange = $null
    try {
      $usedRange = $worksheet.UsedRange
      $rowCount = [int]$usedRange.Rows.Count
      $columnCount = [int]$usedRange.Columns.Count
      $values = $usedRange.Value2
      $rows = New-Object System.Collections.Generic.List[object]

      for ($rowIndex = 1; $rowIndex -le $rowCount; $rowIndex++) {
        $row = New-Object object[] $columnCount
        for ($columnIndex = 1; $columnIndex -le $columnCount; $columnIndex++) {
          if ($rowCount -eq 1 -and $columnCount -eq 1) {
            $row[$columnIndex - 1] = $values
          } else {
            $row[$columnIndex - 1] = $values.GetValue($rowIndex, $columnIndex)
          }
        }
        $rows.Add([object[]]$row)
      }

      $worksheets.Add([ordered]@{
        name = [string]$worksheet.Name
        rows = $rows
      })
    } finally {
      if ($usedRange) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($usedRange)
      }
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($worksheet)
    }
  }

  $payload = [ordered]@{ worksheets = $worksheets } | ConvertTo-Json -Depth 8 -Compress
  [IO.File]::WriteAllText($OutputPath, $payload, (New-Object Text.UTF8Encoding($false)))
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
