param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$directory = Split-Path -Parent $OutputPath
if ($directory -and -not (Test-Path $directory)) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
