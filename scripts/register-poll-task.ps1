# Registers the ✅ poller: checks Slack every few minutes and posts the reels
# the owner has approved.
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-poll-task.ps1
#
# Runs one pass per firing rather than sitting resident, so a crash costs one
# cycle and nothing accumulates. Posting is idempotent per platform, so an
# overlapping or repeated run cannot double-post. Interactive session, like the
# other tasks: it shares the machine and the .env.local that holds the tokens.
param(
  [int]$EveryMinutes = 10,
  [string]$TaskName = "smbsolved-reels-poll"
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $repo "out\logs") | Out-Null

$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument "/c `"`"$npx`" tsx pipeline/poll.ts >> out\logs\poll.log 2>&1`"" `
  -WorkingDirectory $repo

# Repeat forever from the top of the hour; the daily reel lands at 06:30, so a
# ✅ at any time of day is picked up within one interval.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Output "Registered '$TaskName': every $EveryMinutes minutes. Test now:  schtasks /Run /TN $TaskName"
