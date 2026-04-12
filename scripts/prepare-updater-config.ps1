$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$sourceConfigPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
$releaseConfigPath = Join-Path $projectRoot "src-tauri\tauri.release.conf.json"

$pubkey = ($env:TAURI_UPDATER_PUBKEY | Out-String).Trim()
$endpointsRaw = ($env:TAURI_UPDATER_ENDPOINTS | Out-String).Trim()

if (-not $pubkey) {
  throw "TAURI_UPDATER_PUBKEY est manquant."
}

$endpoints = $endpointsRaw -split "[`r`n;,]" |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ }

if (-not $endpoints -or $endpoints.Count -eq 0) {
  throw "TAURI_UPDATER_ENDPOINTS est manquant."
}

$config = Get-Content $sourceConfigPath -Raw | ConvertFrom-Json

if (-not $config.bundle) {
  $config | Add-Member -NotePropertyName "bundle" -NotePropertyValue ([pscustomobject]@{})
}

$config.bundle | Add-Member -NotePropertyName "createUpdaterArtifacts" -NotePropertyValue $true -Force

if (-not $config.PSObject.Properties["plugins"]) {
  $config | Add-Member -NotePropertyName "plugins" -NotePropertyValue ([pscustomobject]@{})
}

$config.plugins | Add-Member -NotePropertyName "updater" -NotePropertyValue ([pscustomobject]@{
  pubkey = $pubkey
  endpoints = @($endpoints)
  windows = [pscustomobject]@{
    installMode = "passive"
  }
}) -Force

$json = $config | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($releaseConfigPath, $json, [System.Text.Encoding]::UTF8)

Write-Output "UPDATER_CONFIG=$releaseConfigPath"
