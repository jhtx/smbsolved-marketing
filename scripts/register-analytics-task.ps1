# Registers the nightly analytics pull (05:45 by default).
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-analytics-task.ps1
#
# Pulls Instagram insights and YouTube statistics for reels posted in the last
# five weeks into out/analytics.db, and copies the file into the OneDrive
# archive. The Sunday miner reads it, so next week's topics are chosen knowing
# which of this month's landed. Runs just before the daily reel job, when the
# machine is reliably awake.
param(
  [string]$Time = "05:45",
  [string]$TaskName = "smbsolved-reels-analytics"
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $repo "out\logs") | Out-Null

$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument "/c `"`"$npx`" tsx pipeline/analytics.ts >> out\logs\analytics.log 2>&1`"" `
  -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Output "Registered '$TaskName': daily at $Time. Test now:  schtasks /Run /TN $TaskName"
