$ErrorActionPreference = "Continue"
$projectDir = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$pidFile = Join-Path $projectDir "runtime\keep-awake.pid"

if (Test-Path $pidFile) {
  $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($oldPid -match '^\d+$') {
    Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

Add-Type -Namespace CodexRemoteContact -Name DisplayRestore -MemberDefinition @"
[DllImport("user32.dll")]
public static extern System.IntPtr SendMessage(System.IntPtr hWnd, uint Msg, System.IntPtr wParam, System.IntPtr lParam);
"@

[CodexRemoteContact.DisplayRestore]::SendMessage([IntPtr]0xffff, 0x0112, [IntPtr]0xF170, [IntPtr](-1)) | Out-Null
Write-Output "Display restored and keep-awake released."
