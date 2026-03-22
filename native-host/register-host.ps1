param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId
)

$HostName = "com.incredable.browserenhance.sessions"
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HostCmd = Join-Path $BaseDir "host.cmd"
$ManifestDir = Join-Path $env:LOCALAPPDATA "BrowserEnhance\\NativeMessagingHosts"
$ManifestPath = Join-Path $ManifestDir "$HostName.json"

if (!(Test-Path $ManifestDir)) {
  New-Item -ItemType Directory -Path $ManifestDir | Out-Null
}

$Manifest = @{
  name = $HostName
  description = "BrowserEnhance session isolation host"
  path = $HostCmd
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4

Set-Content -Path $ManifestPath -Value $Manifest -Encoding ASCII

reg.exe add "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName" /ve /t REG_SZ /d "$ManifestPath" /f | Out-Null

Write-Host "Native host registered at $ManifestPath"
