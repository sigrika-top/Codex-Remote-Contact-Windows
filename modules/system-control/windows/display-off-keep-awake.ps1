$ErrorActionPreference = "Stop"
$projectDir = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$runtimeDir = Join-Path $projectDir "runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$pidFile = Join-Path $runtimeDir "keep-awake.pid"

if (Test-Path $pidFile) {
  $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($oldPid -match '^\d+$') {
    Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
  }
}

Add-Type -Namespace CodexRemoteContact -Name Display -MemberDefinition @"
[DllImport("user32.dll")]
public static extern System.IntPtr SendMessage(System.IntPtr hWnd, uint Msg, System.IntPtr wParam, System.IntPtr lParam);
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
"@

Set-Content -Path $pidFile -Value $PID -Encoding ascii
[CodexRemoteContact.Display]::SetThreadExecutionState(0x80000001) | Out-Null
[CodexRemoteContact.Display]::SendMessage([IntPtr]0xffff, 0x0112, [IntPtr]0xF170, [IntPtr]2) | Out-Null

while ($true) {
  [CodexRemoteContact.Display]::SetThreadExecutionState(0x80000001) | Out-Null
  Start-Sleep -Seconds 30
}
