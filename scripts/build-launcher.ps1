param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) { $OutputPath = Join-Path $projectRoot '售前解决方案工具.exe' }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Package version must contain three numeric components.' }
$assemblyVersion = $manifest.version + '.0'
$temporaryRoot = Join-Path $projectRoot '.cache\launcher-build'
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
$metadataPath = Join-Path $temporaryRoot 'AssemblyInfo.cs'
$toolName = '售前解决方案工具'
$metadata = @"
using System.Reflection;
[assembly: AssemblyTitle("$toolName")]
[assembly: AssemblyProduct("$toolName")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
"@
[IO.File]::WriteAllText($metadataPath, $metadata, (New-Object Text.UTF8Encoding($true)))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'The Windows .NET Framework C# compiler is unavailable.' }
& $compiler /nologo /codepage:65001 /target:winexe /optimize+ /reference:System.Windows.Forms.dll "/win32icon:$projectRoot\assets\presales-solution-tool.ico" "/out:$OutputPath" "$PSScriptRoot\launcher.cs" "$metadataPath"
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
