# Builds the "Fixed Asset Register & Roll-forward" template in REAL Excel via
# COM, calculates it, and prints the computed key cells as JSON so
# template-far.ts can verify them against independently computed values.
#
# Invoked by pipeline/template-far.ts. Do not run the numbers by hand; the
# whole point is that Excel computes and TypeScript re-derives.
#
# Sheet layout (Register):
#   B1                 report year (input)
#   row 4              headers, rows 5..10 six sample assets
#   A..J inputs        id, desc, in-service, cost, salvage, life-yrs,
#                      tax class, bonus %, disposal date, proceeds
#   K..T book          months prior / current, monthly rate, beg A/D,
#                      current dep, disposal relief, end A/D, end cost,
#                      NBV, gain/(loss)
#   U..W tax           MACRS year, MACRS %, current tax dep
#   X..Y flags         added this year / disposed this year
#   row 11             totals
#   rows 14..21        cost + A/D roll-forward with tie-out checks
#   rows 23..26        GL tie block (user enters GL balances)
param(
  [Parameter(Mandatory = $true)][string]$OutPath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$xl = $null; $wb = $null
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false
  $wb = $xl.Workbooks.Add()

  # ---------------- Tables sheet: MACRS GDS half-year percentages ----------
  $tb = $wb.Worksheets.Item(1); $tb.Name = 'Tables'
  $tb.Range('A1').Value2 = 'MACRS GDS, half-year convention (200% DB; 15-year is 150% DB)'
  $classes = @(3, 5, 7, 10, 15)
  $macrs = @{
    3  = @(0.3333, 0.4445, 0.1481, 0.0741)
    5  = @(0.20, 0.32, 0.192, 0.1152, 0.1152, 0.0576)
    7  = @(0.1429, 0.2449, 0.1749, 0.1249, 0.0893, 0.0892, 0.0893, 0.0446)
    10 = @(0.10, 0.18, 0.144, 0.1152, 0.0922, 0.0737, 0.0655, 0.0655, 0.0656, 0.0655, 0.0328)
    15 = @(0.05, 0.095, 0.0855, 0.077, 0.0693, 0.0623, 0.059, 0.059, 0.0591, 0.059, 0.0591, 0.059, 0.0591, 0.059, 0.0591, 0.0295)
  }
  # NOTE: numeric writes go through Range("B3")-style addresses with explicit
  # casts. PowerShell's COM binder throws "Specified cast is not valid" on
  # Cells.Item(...).Value2 once mixed numeric types have passed through it.
  $tb.Range('A2').Value2 = 'Year'
  for ($c = 0; $c -lt $classes.Count; $c++) {
    $col = [string][char](66 + $c)   # B..F
    $tb.Range($col + '2').Value2 = [double]$classes[$c]
    $pcts = $macrs[$classes[$c]]
    for ($y = 0; $y -lt $pcts.Count; $y++) {
      $tb.Range($col + [string](3 + $y)).Value2 = [double]$pcts[$y]
    }
  }
  for ($y = 1; $y -le 16; $y++) { $tb.Range('A' + [string](2 + $y)).Value2 = [double]$y }
  $tb.Range('B3:F18').NumberFormat = '0.00%'

  # ---------------- Register sheet ----------------------------------------
  $ws = $wb.Worksheets.Add([System.Reflection.Missing]::Value, $tb)
  $ws.Name = 'Register'

  $ws.Range('A1').Value2 = 'FIXED ASSET REGISTER & ROLL-FORWARD'
  $ws.Range('A1').Font.Bold = $true; $ws.Range('A1').Font.Size = 14
  $ws.Range('A2').Value2 = 'smbsolved.com · every formula verified in real Excel · yellow cells are inputs'
  $ws.Range('A2').Font.Color = 90 * 65536 + 90 * 256 + 90

  $ws.Range('A3').Value2 = 'Report year'
  $ws.Range('B3').Value2 = [double]2026
  $ws.Range('B3').Interior.Color = 0x99FFFF  # light yellow (BGR)
  # NOTE: formulas reference $B$3 for the report year.

  $heads = @('Asset ID','Description','In service','Cost','Salvage','Life (yrs)','Tax class','Bonus %','Disposed','Proceeds',
             'Mo. prior','Mo. this yr','Monthly dep','Beg A/D','Dep this yr','A/D relieved','End A/D','End cost','NBV','Gain/(loss)',
             'Tax yr','MACRS %','Tax dep','_add','_disp')
  for ($c = 0; $c -lt $heads.Count; $c++) {
    $addr = [string][char](65 + $c) + '4'   # A4..Y4
    $cell = $ws.Range($addr); $cell.Value2 = [string]$heads[$c]; $cell.Font.Bold = $true
  }

  # sample assets (rows 5..10)
  $assets = @(
    @('FA-0001','Crown FC 5200 forklift','2023-03-15',28500,2500,7,5,0,$null,$null),
    @('FA-0002','Office buildout, Suite 210','2024-07-01',64200,0,10,15,0,$null,$null),
    @('FA-0003','Dell Latitude laptops (x6)','2026-01-20',8940,0,3,5,0.8,$null,$null),
    @('FA-0004','Ford F-350 service truck','2026-04-10',52800,4800,5,5,0,$null,$null),
    @('FA-0005','Haas VF-2 CNC mill','2021-09-01',145000,5000,10,7,0,$null,$null),
    @('FA-0006','Dell PowerEdge server','2022-05-12',18600,0,5,5,0,'2026-06-15',4200)
  )
  for ($r = 0; $r -lt $assets.Count; $r++) {
    $row = [string](5 + $r); $a = $assets[$r]
    $ws.Range('A' + $row).Value2 = [string]$a[0]
    $ws.Range('B' + $row).Value2 = [string]$a[1]
    # Value2 rejects DateTime (invalid cast); dates go in as OADate serials.
    $ws.Range('C' + $row).Value2 = [double][DateTime]::Parse($a[2]).ToOADate()
    $ws.Range('D' + $row).Value2 = [double]$a[3]
    $ws.Range('E' + $row).Value2 = [double]$a[4]
    $ws.Range('F' + $row).Value2 = [double]$a[5]
    $ws.Range('G' + $row).Value2 = [double]$a[6]
    $ws.Range('H' + $row).Value2 = [double]$a[7]
    if ($null -ne $a[8]) { $ws.Range('I' + $row).Value2 = [double][DateTime]::Parse($a[8]).ToOADate() }
    if ($null -ne $a[9]) { $ws.Range('J' + $row).Value2 = [double]$a[9] }
  }
  $ws.Range('A5:J10').Interior.Color = 0x99FFFF

  # formulas, rows 5..10 ({0} = row)
  $F = @{
    K = '=IF($C{0}="","",MAX(0,MIN($F{0}*12,($B$3-1-YEAR($C{0}))*12+13-MONTH($C{0}))))'
    L = '=IF($C{0}="","",IF(YEAR($C{0})>$B$3,0,IF(AND($I{0}<>"",YEAR($I{0})<$B$3),0,MAX(0,MIN(IF(AND($I{0}<>"",YEAR($I{0})=$B$3),MONTH($I{0})-1,12)-IF(YEAR($C{0})=$B$3,MONTH($C{0}),1)+1,$F{0}*12-K{0})))))'
    M = '=IF($C{0}="","",($D{0}-$E{0})/($F{0}*12))'
    N = '=IF($C{0}="","",K{0}*M{0})'
    O = '=IF($C{0}="","",L{0}*M{0})'
    P = '=IF(Y{0}=1,N{0}+O{0},0)'
    Q = '=IF($C{0}="","",IF(Y{0}=1,0,N{0}+O{0}))'
    R = '=IF($C{0}="","",IF(OR(Y{0}=1,AND($I{0}<>"",YEAR($I{0})<$B$3)),0,$D{0}))'
    S = '=IF($C{0}="","",R{0}-Q{0})'
    T = '=IF(Y{0}=1,$J{0}-($D{0}-P{0}),"")'
    U = '=IF($C{0}="","",$B$3-YEAR($C{0})+1)'
    V = '=IF($C{0}="","",IFERROR(INDEX(Tables!$B$3:$F$18,U{0},MATCH($G{0},Tables!$B$2:$F$2,0)),0))'
    W = '=IF($C{0}="","",IF(AND($I{0}<>"",YEAR($I{0})<$B$3),0,($D{0}*(1-$H{0}))*V{0}*IF(Y{0}=1,0.5,1)+IF(U{0}=1,$D{0}*$H{0},0)))'
    X = '=IF($C{0}="",0,IF(YEAR($C{0})=$B$3,1,0))'
    Y = '=IF($C{0}="",0,IF(AND($I{0}<>"",YEAR($I{0})=$B$3),1,0))'
  }
  foreach ($col in $F.Keys) {
    for ($row = 5; $row -le 10; $row++) {
      $ws.Range("$col$row").Formula2 = ($F[$col] -f $row)
    }
  }

  # totals row 11
  $ws.Range('B11').Value2 = 'TOTALS'; $ws.Range('B11').Font.Bold = $true
  foreach ($col in @('D','N','O','P','Q','R','S','W')) {
    $ws.Range("${col}11").Formula2 = "=SUM(${col}5:${col}10)"
    $ws.Range("${col}11").Font.Bold = $true
  }

  # roll-forward block
  $ws.Range('A14').Value2 = 'ROLL-FORWARD'; $ws.Range('A14').Font.Bold = $true
  $ws.Range('B14').Value2 = 'Cost'; $ws.Range('C14').Value2 = 'Accum. dep.'
  $ws.Range('A15').Value2 = 'Beginning'
  $ws.Range('B15').Formula2 = '=SUMPRODUCT(($C$5:$C$10<>"")*(1-$X$5:$X$10)*$D$5:$D$10)'
  $ws.Range('C15').Formula2 = '=$N$11'
  $ws.Range('A16').Value2 = 'Additions / depreciation'
  $ws.Range('B16').Formula2 = '=SUMPRODUCT($X$5:$X$10*$D$5:$D$10)'
  $ws.Range('C16').Formula2 = '=$O$11'
  $ws.Range('A17').Value2 = 'Disposals / A/D relieved'
  $ws.Range('B17').Formula2 = '=-SUMPRODUCT($Y$5:$Y$10*$D$5:$D$10)'
  $ws.Range('C17').Formula2 = '=-$P$11'
  $ws.Range('A18').Value2 = 'Ending'
  $ws.Range('B18').Formula2 = '=SUM(B15:B17)'; $ws.Range('B18').Font.Bold = $true
  $ws.Range('C18').Formula2 = '=SUM(C15:C17)'; $ws.Range('C18').Font.Bold = $true
  $ws.Range('A19').Value2 = 'Ties to detail?'
  $ws.Range('B19').Formula2 = '=IF(ROUND(B18-$R$11,2)=0,"OK",B18-$R$11)'
  $ws.Range('C19').Formula2 = '=IF(ROUND(C18-$Q$11,2)=0,"OK",C18-$Q$11)'
  $ws.Range('A20').Value2 = 'Net book value'
  $ws.Range('B20').Formula2 = '=B18-C18'; $ws.Range('B20').Font.Bold = $true
  $ws.Range('A21').Value2 = 'Ties to detail?'
  $ws.Range('B21').Formula2 = '=IF(ROUND(B20-$S$11,2)=0,"OK",B20-$S$11)'

  $ws.Range('A23').Value2 = 'TIE TO GL'; $ws.Range('A23').Font.Bold = $true
  $ws.Range('A24').Value2 = 'GL fixed asset cost'
  $ws.Range('B24').Interior.Color = 0x99FFFF
  $ws.Range('C24').Formula2 = '=IF($B24="","enter GL balance",IF(ROUND($B24-B18,2)=0,"OK",$B24-B18))'
  $ws.Range('A25').Value2 = 'GL accumulated depreciation'
  $ws.Range('B25').Interior.Color = 0x99FFFF
  $ws.Range('C25').Formula2 = '=IF($B25="","enter GL balance",IF(ROUND($B25-C18,2)=0,"OK",$B25-C18))'

  # formats
  $ws.Range('C5:C10').NumberFormat = 'm/d/yyyy'
  $ws.Range('I5:I10').NumberFormat = 'm/d/yyyy'
  $ws.Range('D5:E11,J5:J10,M5:T11,W5:W11,B15:C21,B24:B25').NumberFormat = '#,##0.00'
  $ws.Range('H5:H10').NumberFormat = '0%'
  $ws.Range('V5:V10').NumberFormat = '0.00%'
  $ws.Range('X:Y').EntireColumn.Hidden = $true
  $ws.Columns.Item(2).ColumnWidth = 26
  foreach ($c in 3..23) { $ws.Columns.Item($c).ColumnWidth = 12 }

  # ---------------- Readme -------------------------------------------------
  $rm = $wb.Worksheets.Add([System.Reflection.Missing]::Value, $ws)
  $rm.Name = 'Readme'
  $notes = @(
    'FIXED ASSET REGISTER & ROLL-FORWARD, from smbsolved.com',
    '',
    'Yellow cells are inputs. Everything else calculates.',
    'Book depreciation is straight line, full-month convention: the month you place an asset in service counts, the month you dispose of it does not.',
    'Tax depreciation is MACRS GDS half-year (percentages on the Tables sheet). Bonus % applies in year one and reduces the MACRS basis. Section 179 is not modeled; ask your tax preparer.',
    'The tie-out rows should read OK. If one shows a number, that number is exactly how far off you are.',
    'Remove assets disposed of in years before the report year; the register shows the current year only.',
    'Add rows: insert above the TOTALS row, then fill the formulas down from the row above.',
    'No macros. Works in Excel 2016 and later.',
    'Every formula in this file was computed and checked in real Excel before publishing.'
  )
  for ($i = 0; $i -lt $notes.Count; $i++) { $rm.Range('A' + [string](1 + $i)).Value2 = [string]$notes[$i] }
  $rm.Columns.Item(1).ColumnWidth = 110

  # ---------------- calculate, read back, save ----------------------------
  $xl.Calculate()

  $read = [ordered]@{}
  foreach ($row in 5..10) {
    $read["O$row"] = $ws.Range("O$row").Value2
    $read["Q$row"] = $ws.Range("Q$row").Value2
    $read["S$row"] = $ws.Range("S$row").Value2
    $read["W$row"] = $ws.Range("W$row").Value2
  }
  $read['T10'] = $ws.Range('T10').Value2
  foreach ($c in @('N11','O11','P11','Q11','R11','S11','W11','B15','B16','B17','B18','C18','B20')) { $read[$c] = $ws.Range($c).Value2 }
  foreach ($c in @('B19','C19','B21')) { $read[$c] = [string]$ws.Range($c).Text }
  $read['excel'] = "$($xl.Version).$($xl.Build)"

  if (Test-Path $OutPath) { Remove-Item $OutPath -Force }
  $wb.SaveAs((Resolve-Path (Split-Path $OutPath -Parent)).Path + '\' + (Split-Path $OutPath -Leaf), 51) # 51 = xlsx
  $read['saved'] = $OutPath

  $read | ConvertTo-Json -Compress
}
finally {
  if ($wb) { try { $wb.Close($false) } catch {} }
  if ($xl) { try { $xl.Quit() } catch {}; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
