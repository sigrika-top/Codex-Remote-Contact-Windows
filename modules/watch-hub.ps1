$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $project 'runtime'
$pause = Join-Path $runtime 'hub-watchdog.pause'
$log = Join-Path $runtime 'hub-watchdog.log'
$hubTask = 'CodexQQHub'

function Write-WatchLog([string]$message) {
  $line = "$(Get-Date -Format o) $message`r`n"
  [System.IO.File]::AppendAllText($log, $line, [System.Text.UTF8Encoding]::new($false))
}

if (Test-Path -LiteralPath $pause) { return }
try {
  $task = Get-ScheduledTask -TaskName $hubTask
  $expected = Join-Path $project 'modules\run-hub-task.ps1'
  if (($task.Actions.Arguments -join '') -notmatch [regex]::Escape($expected)) {
    throw 'Hub task action changed; watchdog will not start it'
  }
  if ($task.State -eq 'Running') { return }
  # The task runs as the signed-in Administrator account; SYSTEM only asks the
  # scheduler to restart it and never reads Codex credentials or chat history.
  Start-ScheduledTask -TaskName $hubTask
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $state = Invoke-RestMethod http://127.0.0.1:3789/api/state -TimeoutSec 2
      if ($state.channels.qq) {
        Write-WatchLog 'Hub restarted; QQ channel enabled.'
        return
      }
    } catch { }
  }
  throw 'Hub task was started but did not become ready'
} catch {
  Write-WatchLog "Watchdog check failed: $($_.Exception.Message)"
  throw
}
