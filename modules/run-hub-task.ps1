$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $project 'runtime'
. (Join-Path $PSScriptRoot 'hub-job.ps1')
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$settings = Get-Content -Raw -Encoding UTF8 (Join-Path $project 'data\settings.json') | ConvertFrom-Json
$enabled = $settings.channels.qq
if ($null -eq $enabled) {
  $enabled = $false
}
$hub = Start-Process powershell.exe -WindowStyle Hidden -PassThru -WorkingDirectory $project `
  -ArgumentList @('-NoProfile','-File',(Join-Path $project 'modules\start-hub.ps1')) `
  -RedirectStandardOutput (Join-Path $runtime "hub-task-$stamp.out.log") `
  -RedirectStandardError (Join-Path $runtime "hub-task-$stamp.err.log")
$ready = $false
for ($attempt=0; $attempt -lt 40; $attempt++) {
  Start-Sleep -Milliseconds 500
  try { $null=Invoke-RestMethod http://127.0.0.1:3789/api/state -TimeoutSec 2; $ready=$true; break } catch { }
}
if (-not $ready) { Stop-Process -Id $hub.Id -ErrorAction SilentlyContinue; throw 'Hub failed to start; see runtime/hub-task logs' }
$null=Invoke-RestMethod http://127.0.0.1:3789/api/channel -Method Post -ContentType 'application/json' -Body (@{channel='qq';enabled=[bool]$enabled}|ConvertTo-Json -Compress)
$hub.WaitForExit()
exit $hub.ExitCode
