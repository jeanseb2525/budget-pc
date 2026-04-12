$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$releaseRoot = Join-Path $projectRoot "release\windows"
$nsisDir = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"
$stableInstallerName = "Budget PC Installer.exe"
$stableSignatureName = "$stableInstallerName.sig"
$latestJsonName = "latest.json"

$downloadBaseUrl = ($env:TAURI_RELEASE_DOWNLOAD_BASE_URL | Out-String).Trim().TrimEnd("/")

if (-not $downloadBaseUrl) {
  throw "TAURI_RELEASE_DOWNLOAD_BASE_URL est manquant."
}

if (-not (Test-Path $nsisDir)) {
  throw "Dossier NSIS introuvable: $nsisDir"
}

$installer = Get-ChildItem $nsisDir -Filter "*setup.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "Aucun installateur NSIS trouve dans $nsisDir"
}

$signaturePath = "$($installer.FullName).sig"

if (-not (Test-Path $signaturePath)) {
  throw "Signature updater introuvable: $signaturePath"
}

$package = Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$package.version

if (-not $version) {
  throw "Version introuvable dans package.json"
}

$signature = (Get-Content $signaturePath -Raw).Trim()
$installerUrl = "$downloadBaseUrl/$([System.Uri]::EscapeDataString($stableInstallerName))"

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

$releaseInstallerPath = Join-Path $releaseRoot $stableInstallerName
$releaseSignaturePath = Join-Path $releaseRoot $stableSignatureName
$latestJsonPath = Join-Path $releaseRoot $latestJsonName

Copy-Item $installer.FullName $releaseInstallerPath -Force
Copy-Item $signaturePath $releaseSignaturePath -Force

$latestJson = [ordered]@{
  version = $version
  notes = "Budget PC $version"
  pub_date = [DateTimeOffset]::UtcNow.ToString("o")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signature
      url = $installerUrl
    }
  }
}

[System.IO.File]::WriteAllText(
  $latestJsonPath,
  ($latestJson | ConvertTo-Json -Depth 10),
  [System.Text.Encoding]::UTF8
)

Write-Output "RELEASE_DIR=$releaseRoot"
Write-Output "INSTALLER=$releaseInstallerPath"
Write-Output "SIGNATURE=$releaseSignaturePath"
Write-Output "LATEST_JSON=$latestJsonPath"
