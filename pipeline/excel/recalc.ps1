# Recalculates reel formulas in REAL Excel via COM and reports what Excel shows.
#
# Invoked by pipeline/excel.ts. Reads a job file:
#   {
#     "cells":    [ { "ref": "A2", "value": "1042", "kind": "text" | "number" },
#                  // a cell that displays other than it stores: Excel holds the
#                  // serial under "numberFormat" and must render "expectText"
#                  { "ref": "A2", "value": "46031", "kind": "number",
#                    "numberFormat": "mm/dd/yyyy", "expectText": "01/09/2026" }, ... ],
#     "formulas": [ { "key": "before", "cell": "B2", "text": "=VLOOKUP(...)", "numberFormat": "General" }, ... ],
#
#     // optional, mutation reels only: Excel inserts a column or a row AFTER
#     // "formulas" have been calculated, fills the newcomer, then calculates
#     // "formulasAfter". A formula with an empty "text" is not retyped: the
#     // insert shifted and rewrote it, and reading back what Excel made of it
#     // is the entire point (VLOOKUP's range grows, its column index does not).
#     "mutation":      { "kind": "insertColumn", "at": "B", "cells": [ ... ] },
#     "formulasAfter": [ { "key": "before", "cell": "C8", "text": "" }, ... ]
#   }
# Writes JSON to stdout:
#   { "excel": "16.0.20326",
#     "results": [ { key, cell, text, value, isError, errCode, formulaReadback, setError } ],
#     "display": [ { ref, text, expected } ] }
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
$out = [ordered]@{ excel = $null; results = @(); display = @() }
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

  function Write-Cells($cells) {
    foreach ($c in $cells) {
      $r = $ws.Range($c.ref)
      if ($c.numberFormat) {
        # The cell displays something other than what it holds: a date serial
        # under mm/dd/yyyy. LEFT() then reads the serial while the viewer reads
        # the date, which is the whole lesson of that family of reels.
        $r.NumberFormat = [string]$c.numberFormat
        $num = 0.0
        if ([double]::TryParse([string]$c.value, [ref]$num)) { $r.Value2 = $num } else { $r.Value2 = [string]$c.value }
      } elseif ($c.kind -eq 'text') {
        $r.NumberFormat = '@'          # like a GL export: digits stored as text
        $r.Value2 = [string]$c.value
      } else {
        $r.NumberFormat = 'General'
        $num = 0.0
        if ([double]::TryParse([string]$c.value, [ref]$num)) { $r.Value2 = $num } else { $r.Value2 = [string]$c.value }
      }
      # A cell that claims a display is held to it, the same way a formula is
      # held to `expected`. Constants need no calculation to read back.
      if ($null -ne $c.expectText) {
        $out.display += [ordered]@{ ref = $c.ref; text = [string]$r.Text; expected = [string]$c.expectText }
      }
    }
  }

  # Calculates one formula and reports what Excel shows. An empty $f.text means
  # the cell already holds a formula (Excel rewrote it during an insert) and
  # must be read, not retyped.
  function Invoke-Formula($f) {
    $r = $ws.Range($f.cell)
    $res = [ordered]@{
      key = $f.key; cell = $f.cell; text = $null; value = $null
      isError = $false; errCode = $null; formulaReadback = $null; setError = $null
    }
    $typed = [string]$f.text
    if ($typed.Length -gt 0) {
      $r.ClearContents() | Out-Null
      $fmt = if ($f.numberFormat) { [string]$f.numberFormat } else { 'General' }
      $r.NumberFormat = $fmt
      try {
        $r.Formula2 = $typed
      } catch {
        $res.setError = ($_.Exception.Message -split "`n")[0].Trim()
        return $res
      }
    } elseif (-not $r.HasFormula) {
      $res.setError = "$($f.cell) holds no formula after the insert"
      return $res
    }
    $xl.Calculate() | Out-Null
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
    return $res
  }

  Write-Cells $job.cells
  foreach ($f in $job.formulas) { $out.results += (Invoke-Formula $f) }

  # --- the mutation, performed by Excel itself -------------------------------
  # Everything that makes an insert interesting (which ranges stretch, which
  # indexes stubbornly do not) is Excel's behaviour, so Excel does it.
  if ($job.mutation) {
    if ($job.mutation.kind -eq 'insertColumn') {
      $ws.Columns($job.mutation.at).Insert() | Out-Null
    } else {
      $ws.Rows([int]$job.mutation.at).Insert() | Out-Null
    }
    Write-Cells $job.mutation.cells
    $xl.Calculate() | Out-Null
    foreach ($f in $job.formulasAfter) { $out.results += (Invoke-Formula $f) }
  }
}
finally {
  if ($wb) { try { $wb.Close($false) } catch {} }
  if ($xl) { try { $xl.Quit() } catch {}; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}

$out | ConvertTo-Json -Depth 6 -Compress
