$ErrorActionPreference = "Stop"
$projectDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$pidFile = Join-Path $projectDir "runtime\keep-awake.pid"
if (Test-Path $pidFile) {
  $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($oldPid -match '^\d+$') {
    Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
    Write-Output "Stopped keep-awake process $oldPid."
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$listeners = netstat -ano | Select-String -Pattern "^\s*TCP\s+\S+:3789\s+\S+\s+LISTENING\s+(\d+)"
$processIds = @()
foreach ($line in $listeners) {
  $procId = $line.Matches[0].Groups[1].Value
  if ($procId -and $processIds -notcontains $procId) {
    $processIds += $procId
  }
}

if ($processIds.Count -eq 0) {
  Write-Output "Hub is not listening on port 3789."
  exit 0
}

foreach ($procId in $processIds) {
  Stop-Process -Id ([int]$procId) -Force
  Write-Output "Stopped process $procId."
}
