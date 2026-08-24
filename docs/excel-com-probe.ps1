# Probe: can real Excel (COM) act as the formula-verification gate?
# Writes reel 001's sheet, sets before/after formulas, reads back what Excel shows.
$ErrorActionPreference = 'Stop'
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.ScreenUpdating = $false
try {
  $wb = $xl.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1)

  # --- reel 001 data. Top block: account codes as TEXT (left-aligned). Bottom: numbers.
  $ws.Range("A1").Value2 = "Acct";   $ws.Range("B1").Value2 = "Account Name"
  $ws.Range("A2:A4").NumberFormat = "@"          # force text, like a GL export
  $ws.Range("A2").Value2 = "1042"
  $ws.Range("A3").Value2 = "1055"
  $ws.Range("A4").Value2 = "1120"
  $ws.Range("A7").Value2 = "Code";   $ws.Range("B7").Value2 = "Description"
  $ws.Range("A8").Value2 = 1042;     $ws.Range("B8").Value2 = "Cash - Operating"
  $ws.Range("A9").Value2 = 1055;     $ws.Range("B9").Value2 = "Cash - Payroll"
  $ws.Range("A10").Value2 = 1120;    $ws.Range("B10").Value2 = "Accounts Receivable"

  function Read-Cell($ws, $ref) {
    $c = $ws.Range($ref)
    $v = $c.Value2
    $isErr = ($v -is [int]) -and ($v -le -2146826000)   # COM error values are Int32 0x800A07xx
    [pscustomobject]@{ ref=$ref; text=$c.Text; value2=$v; type=($(if ($null -eq $v) {'null'} else {$v.GetType().Name})); isError=$isErr; errCode=$(if ($isErr) { $v + 2146828288 } else { $null }) }
  }
  function Try-Formula($ws, $ref, $formula) {
    try { $ws.Range($ref).Formula2 = $formula } catch { return [pscustomobject]@{ ref=$ref; text="<<SYNTAX ERROR: $($_.Exception.Message.Split([char]10)[0])>>"; value2=$null; type='n/a'; isError=$true; errCode=$null } }
    $xl.Calculate()
    Read-Cell $ws $ref
  }

  Write-Output "== reel 001 =="
  Try-Formula $ws "B2" '=VLOOKUP(A2,$A$8:$B$10,2,FALSE)'   | Format-List | Out-String -Width 200
  Try-Formula $ws "B2" '=VLOOKUP(A2*1,$A$8:$B$10,2,FALSE)' | Format-List | Out-String -Width 200

  Write-Output "== coercion edge cases the channel lives on =="
  $ws.Range("D1").Value2 = "Cash - Operating "          # trailing space
  $ws.Range("D2").Value2 = ("Vendor" + [char]160 + "Inc") # non-breaking space
  $ws.Range("D3").NumberFormat = "@"; $ws.Range("D3").Value2 = "03/15/2026"   # date as text
  $ws.Range("D4").Value2 = "abc"
  Try-Formula $ws "E1" '=LEN(D1)'                      | Select-Object ref,text,type,isError | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E2" '=LEN(TRIM(D1))'                | Select-Object ref,text,type,isError | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E3" '=CODE(MID(D2,7,1))'            | Select-Object ref,text,type,isError | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E4" '=SUBSTITUTE(D2,CHAR(160)," ")' | Select-Object ref,text,type,isError | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E5" '=D3+0'                         | Select-Object ref,text,type,isError | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E6" '=DATEVALUE(D3)'                | Select-Object ref,text,type,isError | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E7" '=D4*1'                         | Select-Object ref,text,type,isError,errCode | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E8" '=XLOOKUP(A2,A8:A10,B8:B10)'    | Select-Object ref,text,type,isError | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E9" '=XLOOKUP(--A2,A8:A10,B8:B10)'  | Select-Object ref,text,type,isError | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E10" '=SUMIF(A8:A10,">1050",A8:A10)' | Select-Object ref,text,type,isError | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E11" '=NOTAFUNCTION(A2)'            | Select-Object ref,text,type,isError,errCode | Format-Table -AutoSize | Out-String
  Try-Formula $ws "E12" '=VLOOKUP(A2,A8:B10,2,FALSE'   | Select-Object ref,text,type,isError | Format-Table -AutoSize | Out-String
  Write-Output ("Excel version " + $xl.Version + " build " + $xl.Build + " | Calculation engine OK")
}
finally {
  if ($wb) { $wb.Close($false) }
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
