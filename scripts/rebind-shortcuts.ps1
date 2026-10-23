$ErrorActionPreference = 'Stop'
$toolRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = (Resolve-Path -LiteralPath (Join-Path $toolRoot '售前解决方案工具.exe')).Path
$previousLauncherPath = Join-Path (Join-Path (Split-Path -Parent $toolRoot) '解决方案工具') '解决方案工具.exe'
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcutFolders = @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs')) | Select-Object -Unique
foreach ($shortcutFolder in $shortcutFolders) {
  if (-not (Test-Path -LiteralPath $shortcutFolder -PathType Container)) { throw "快捷方式目录不存在：$shortcutFolder" }
  $shortcutPath = Join-Path $shortcutFolder '售前解决方案工具.lnk'
  $shortcut = $shortcutShell.CreateShortcut($shortcutPath)
  if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.TargetPath -and $shortcut.TargetPath -ne $launcherPath) {
    $backupPath = Join-Path $toolRoot ('.cache\shortcut-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-ffff') + '-' + [IO.Path]::GetFileName($shortcutPath))
    New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force | Out-Null
    Copy-Item -LiteralPath $shortcutPath -Destination $backupPath -ErrorAction Stop
  }
  $shortcut.TargetPath = $launcherPath
  $shortcut.WorkingDirectory = $toolRoot
  $shortcut.IconLocation = "$launcherPath,0"
  $shortcut.Description = '售前解决方案工具'
  $shortcut.WindowStyle = 1
  $shortcut.Save()
  $verified = $shortcutShell.CreateShortcut($shortcutPath)
  if ($verified.TargetPath -ne $launcherPath -or $verified.WorkingDirectory -ne $toolRoot) { throw "快捷方式校验失败：$shortcutPath" }
  $previousShortcutPath = Join-Path $shortcutFolder '解决方案工具.lnk'
  if (Test-Path -LiteralPath $previousShortcutPath) {
    $previousShortcut = $shortcutShell.CreateShortcut($previousShortcutPath)
    if ($previousShortcut.TargetPath -eq $previousLauncherPath) {
      $archivePath = Join-Path $toolRoot ('.cache\shortcut-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-ffff') + '-' + [IO.Path]::GetFileName($previousShortcutPath))
      New-Item -ItemType Directory -Path (Split-Path -Parent $archivePath) -Force | Out-Null
      Move-Item -LiteralPath $previousShortcutPath -Destination $archivePath -ErrorAction Stop
    }
  }
  [pscustomobject]@{ shortcut = $shortcutPath; target = $verified.TargetPath; workingDirectory = $verified.WorkingDirectory }
}
