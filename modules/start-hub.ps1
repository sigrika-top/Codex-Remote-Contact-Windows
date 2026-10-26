$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 20 or newer is required. Install it from https://nodejs.org/ and open a new terminal."
}

Write-Output "Starting Codex Remote Contact at http://localhost:3789"
& node src/server.js
