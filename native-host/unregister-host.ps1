$HostName = "com.incredable.browserenhance.sessions"
$ManifestDir = Join-Path $env:LOCALAPPDATA "BrowserEnhance\\NativeMessagingHosts"
$ManifestPath = Join-Path $ManifestDir "$HostName.json"

if (Test-Path $ManifestPath) {
  Remove-Item $ManifestPath -Force
}

reg.exe delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName" /f | Out-Null

Write-Host "Native host unregistered."
