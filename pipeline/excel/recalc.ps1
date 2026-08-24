# Recalculates reel formulas in REAL Excel via COM and reports what Excel shows.
#
# Invoked by pipeline/excel.ts. Reads a job file:
#   {
#     "cells":    [ { "ref": "A2", "value": "1042", "kind": "text" | "number" }, ... ],
#     "formulas": [ { "key": "before", "cell": "B2", "text": "=VLOOKUP(...)", "numberFormat": "General" }, ... ]
#   }
# Writes JSON to stdout:
#   { "excel": "16.0.20326", "results": [ { key, cell, text, value, isError, errCode, formulaReadback, setError } ] }
#
# Why real Excel and not a JS formula engine: the channel lives on coercion
# edge cases (text vs number, CHAR(160), dates-as-text). Only Excel is Excel.
#
# Requirements: Excel installed; run in an interactive user session (Office COM
# is unsupported from services / Session 0).
param(
  [Parameter(Mandatory = $true)][string]$JobPath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$job = Get-Content -LiteralPath $JobPath -Raw -Encoding UTF8 | ConvertFrom-Json

$xl = $null
$wb = $null
$out = [ordered]@{ excel = $null; results = @() }
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false
  $xl.DisplayAlerts = $false
  $xl.ScreenUpdating = $false
  $xl.EnableEvents = $false
  $out.excel = "$($xl.Version).$($xl.Build)"

  $wb = $xl.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1)
  # Wide columns so .Text never degrades to ####.
  $ws.Columns.ColumnWidth = 60

  foreach ($c in $job.cells) {
    $r = $ws.Range($c.ref)
    if ($c.kind -eq 'text') {
      $r.NumberFormat = '@'          # like a GL export: digits stored as text
      $r.Value2 = [string]$c.value
    } else {
      $r.NumberFormat = 'General'
      $num = 0.0
      if ([double]::TryParse([string]$c.value, [ref]$num)) { $r.Value2 = $num } else { $r.Value2 = [string]$c.value }
    }
  }

  foreach ($f in $job.formulas) {
    $r = $ws.Range($f.cell)
    $res = [ordered]@{
      key = $f.key; cell = $f.cell; text = $null; value = $null
      isError = $false; errCode = $null; formulaReadback = $null; setError = $null
    }
    $r.ClearContents() | Out-Null
    $fmt = if ($f.numberFormat) { [string]$f.numberFormat } else { 'General' }
    $r.NumberFormat = $fmt
    try {
      $r.Formula2 = [string]$f.text
    } catch {
      $res.setError = ($_.Exception.Message -split "`n")[0].Trim()
      $out.results += $res
      continue
    }
    $xl.Calculate()
    $v = $r.Value2
    $res.formulaReadback = [string]$r.Formula2
    $res.text = [string]$r.Text
    if ($v -is [int] -and $v -le -2146826000) {
      # COM error values are Int32 0x800A07xx; + 2146828288 gives the xlErr code
      $res.isError = $true
      $res.errCode = [int]($v + 2146828288)
      $res.value = $null
    } elseif ($null -eq $v) {
      $res.value = $null
    } elseif ($v -is [double] -or $v -is [int] -or $v -is [bool]) {
      $res.value = $v
    } else {
      $res.value = [string]$v
    }
    $out.results += $res
  }
}
finally {
  if ($wb) { try { $wb.Close($false) } catch {} }
  if ($xl) { try { $xl.Quit() } catch {}; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}

$out | ConvertTo-Json -Depth 6 -Compress
