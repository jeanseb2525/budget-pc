$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$deliveryRoot = Split-Path -Parent $projectRoot

$nsisDir = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"

if (-not (Test-Path $nsisDir)) {
  throw "Dossier NSIS introuvable: $nsisDir"
}

$installer = Get-ChildItem $nsisDir -Filter "*setup.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "Aucun installateur NSIS trouve dans $nsisDir"
}

$installerTarget = Join-Path $deliveryRoot "Budget PC Installer.exe"
Copy-Item $installer.FullName $installerTarget -Force

Write-Output "INSTALLER=$installerTarget"
