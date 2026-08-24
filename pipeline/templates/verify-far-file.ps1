# Opens an EXISTING fixed-asset-register workbook (e.g. one the owner cleaned
# up by hand), recalculates it in real Excel, and prints the same key cells the
# builder reports — so template-far.ts --check can re-verify an edited file
# before it is republished. Read-only; never saves.
param(
  [Parameter(Mandatory = $true)][string]$Path
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$xl = $null; $wb = $null
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false
  $full = (Resolve-Path $Path).Path
  $wb = $xl.Workbooks.Open($full, 0, $true)  # UpdateLinks=0, ReadOnly=true
  $ws = $wb.Worksheets.Item('Register')
  $xl.CalculateFullRebuild()

  $read = [ordered]@{}
  foreach ($row in 5..10) {
    foreach ($col in @('O','Q','S','W')) { $read["$col$row"] = $ws.Range("$col$row").Value2 }
  }
  $read['T10'] = $ws.Range('T10').Value2
  foreach ($c in @('N11','O11','P11','Q11','R11','S11','W11','B15','B16','B17','B18','C18','B20')) { $read[$c] = $ws.Range($c).Value2 }
  foreach ($c in @('B19','C19','B21')) { $read[$c] = [string]$ws.Range($c).Text }
  $read['excel'] = "$($xl.Version).$($xl.Build)"
  $read | ConvertTo-Json -Compress
}
finally {
  if ($wb) { try { $wb.Close($false) } catch {} }
  if ($xl) { try { $xl.Quit() } catch {}; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
