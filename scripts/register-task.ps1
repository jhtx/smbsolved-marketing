# Registers the daily pipeline run in Windows Task Scheduler.
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1 -Time 07:00 -Days Monday,Wednesday,Friday
#
# "Run only when user is logged on" (LogonType Interactive) is deliberate:
# Excel COM does not work from a non-interactive session. Keep the machine
# logged in (lock screen is fine) and disable sleep. A missed run shows up
# as a missing heartbeat (HEALTHCHECK_URL) and a missing Slack message.
param(
  [string]$Time = "06:30",
  [string[]]$Days = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday"),
  [string]$TaskName = "smbsolved-reels"
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $repo "out\logs") | Out-Null

$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument "/c `"`"$npx`" tsx pipeline/run.ts --next >> out\logs\task.log 2>&1`"" `
  -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Days -At $Time
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Output "Registered '$TaskName': $($Days -join ',') at $Time, run only when $env:USERNAME is logged on."
Write-Output "Test now:  schtasks /Run /TN $TaskName     Log: out\logs\task.log and out\logs\run.log"
