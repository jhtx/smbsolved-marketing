# Registers the biweekly newsletter draft (every other Monday, 07:30).
# The task only DRAFTS: Jimmy writes the close note, pastes reel links,
# sends from Kit, and mirrors to the LinkedIn newsletter a day later.
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-newsletter-task.ps1
param(
  [string]$Time = "07:30",
  [string]$TaskName = "smbsolved-reels-newsletter"
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $repo "out\logs") | Out-Null

$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument "/c `"`"$npx`" tsx pipeline/newsletter.ts >> out\logs\newsletter.log 2>&1`"" `
  -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 2 -DaysOfWeek Monday -At $Time
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Output "Registered '$TaskName': every other Monday at $Time (first fire: next Monday)."
Write-Output "Test now:  schtasks /Run /TN $TaskName"
