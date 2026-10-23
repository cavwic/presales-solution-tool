$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Join-Path $env:ProgramFiles "nodejs\node.exe"
$serverScript = Join-Path $PSScriptRoot "serve-dist.mjs"
$indexFile = Join-Path $projectRoot "dist\index.html"

if (-not (Test-Path -LiteralPath $nodePath)) {
  throw "node.exe was not found at $nodePath"
}
if (-not (Test-Path -LiteralPath $indexFile)) {
  throw "The static site has not been built. Run npm run build first."
}

Set-Location -LiteralPath $projectRoot
& $nodePath $serverScript --host 127.0.0.1 --port 43202

if ($LASTEXITCODE -ne 0) {
  throw "Static review server stopped unexpectedly."
}
