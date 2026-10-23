$ErrorActionPreference = "Stop"

$taskName = "CAVWIC Solutions Lab Dev Server"
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot "start-review-server.ps1"
$powerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

$npmPath = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
Set-Location -LiteralPath $projectRoot
& $npmPath run dev:stop | Out-Null

$action = New-ScheduledTaskAction `
  -Execute $powerShellPath `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`"" `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -Hidden

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Starts the lightweight local CAVWIC Solutions Lab review server after sign-in."
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Output "Installed '$taskName' and started the lightweight static review server."
