$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 20 or newer is required."
}

# Enable Node's environment proxy handling for this Hub process and children.
$hubProxy = $env:CODEX_REMOTE_CONTACT_PROXY_URL
if ($hubProxy) {
  $env:HTTP_PROXY = $hubProxy
  $env:HTTPS_PROXY = $hubProxy
  $env:ALL_PROXY = $hubProxy
}
$env:NO_PROXY = (@($env:NO_PROXY, "localhost", "127.0.0.1", "::1") | Where-Object { $_ }) -join ","
$env:NODE_USE_ENV_PROXY = "1"

Write-Output "Starting Codex Remote Contact at http://localhost:3789"
& node src/server.js
exit $LASTEXITCODE
