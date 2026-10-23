$ErrorActionPreference = "Stop"

$taskName = "CAVWIC Solutions Lab Dev Server"
$stopScript = Join-Path $PSScriptRoot "stop-dev-server.ps1"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

& $stopScript | Out-Null
Write-Output "Removed '$taskName'. Astro now uses manual startup."
