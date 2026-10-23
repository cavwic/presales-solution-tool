$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$npmPath = Join-Path $env:ProgramFiles "nodejs\npm.cmd"

if (-not (Test-Path -LiteralPath $npmPath)) {
  throw "npm.cmd was not found at $npmPath"
}

Set-Location -LiteralPath $projectRoot
& $npmPath run dev:start

if ($LASTEXITCODE -ne 0) {
  throw "Astro dev server failed to start."
}
