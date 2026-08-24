# Registers the weekly topic-mining run (Sundays 17:00 by default).
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-mine-task.ps1
#
# The miner appends candidates to content/backlog.md and posts a Slack notice;
# a human curates and promotes (gives an item a **NNN** number) before the
# daily task can ever pick it up. Same interactive-session rule as the daily
# task, purely for consistency (the miner itself does not need Excel).
param(
  [string]$Time = "17:00",
  [string]$Day = "Sunday",
  [string]$TaskName = "smbsolved-reels-mine"
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $repo "out\logs") | Out-Null

$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument "/c `"`"$npx`" tsx pipeline/mine.ts >> out\logs\mine.log 2>&1`"" `
  -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $Time
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Output "Registered '$TaskName': $Day at $Time. Test now:  schtasks /Run /TN $TaskName"
