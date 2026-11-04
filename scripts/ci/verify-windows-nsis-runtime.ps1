# Validates the actual NSIS installed payload, not merely win-unpacked.
# Must run on Windows after electron-builder has produced the installer.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $BuildDir,
  [string] $Architecture = 'x64'
)

$ErrorActionPreference = 'Stop'
$buildDirFull = (Resolve-Path -LiteralPath $BuildDir).Path
$stagedNode = Join-Path $buildDirFull "win-unpacked/resources/bin/win32-$Architecture/node.exe"
if (-not (Test-Path -LiteralPath $stagedNode)) {
  throw "Missing staged portable Node: $stagedNode"
}
$installers = @(Get-ChildItem -LiteralPath $buildDirFull -Filter '*-nsis.exe' -File)
if ($installers.Count -ne 1) {
  throw "Expected exactly one NSIS installer in $buildDirFull; got $($installers.Count)"
}

$stagedLength = (Get-Item -LiteralPath $stagedNode).Length
$stagedHash = (Get-FileHash -LiteralPath $stagedNode -Algorithm SHA256).Hash
Write-Host "Staged node.exe: $stagedLength bytes, SHA256=$stagedHash"
$stagedVersion = (& $stagedNode --version)
if ($LASTEXITCODE -ne 0 -or $stagedVersion -ne 'v22.15.1') {
  throw "Staged portable Node failed to execute Node v22.15.1: $stagedVersion"
}

$installDir = Join-Path $env:RUNNER_TEMP ('tx5dr-nsis-runtime-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Write-Host "Installing NSIS payload to isolated directory: $installDir"
# NSIS's /D= override must be last, and must not be quoted. RUNNER_TEMP contains
# no spaces on the GitHub-hosted windows-2022 runner.
if ($installDir.Contains(' ')) {
  throw "NSIS unattended installation test destination contains spaces: $installDir"
}
$arguments = @('/S', "/D=$installDir")
$installerProcess = Start-Process -FilePath $installers[0].FullName -ArgumentList $arguments -Wait -PassThru -NoNewWindow
if ($installerProcess.ExitCode -ne 0) {
  throw "NSIS installer failed with exit code $($installerProcess.ExitCode)"
}

$resources = Join-Path $installDir 'resources'
$installedNode = Join-Path $resources "bin/win32-$Architecture/node.exe"
if (-not (Test-Path -LiteralPath $installedNode -PathType Leaf)) {
  throw "NSIS installer omitted portable Node at: $installedNode"
}
$installedLength = (Get-Item -LiteralPath $installedNode).Length
$installedHash = (Get-FileHash -LiteralPath $installedNode -Algorithm SHA256).Hash
Write-Host "Installed node.exe: $installedLength bytes, SHA256=$installedHash"
if ($installedLength -ne $stagedLength -or $installedHash -ne $stagedHash) {
  throw "NSIS changed portable Node (staged=$stagedLength/$stagedHash; installed=$installedLength/$installedHash)"
}

$installedVersion = (& $installedNode --version)
$installedArch = (& $installedNode -p 'process.arch')
if ($LASTEXITCODE -ne 0 -or $installedVersion -ne 'v22.15.1' -or $installedArch -ne $Architecture) {
  throw "Installed Node runtime is not executable or architecture mismatch: version=$installedVersion arch=$installedArch"
}
Write-Host "Installed Node executable OK: $installedVersion ($installedArch)"

$serverScripts = Join-Path $resources 'app/packages/server/dist/scripts'
$nativeCheckScript = Join-Path $serverScripts 'check-native-modules.js'
if (-not (Test-Path -LiteralPath $nativeCheckScript -PathType Leaf)) {
  throw "NSIS installed payload missing native check script: $nativeCheckScript"
}
$env:APP_RESOURCES = $resources
$env:NODE_PATH = Join-Path $resources 'app/node_modules'
$env:NODE_ENV = 'production'
$env:Path = "$(Join-Path $resources "bin/win32-$Architecture");$(Join-Path $resources 'native');$env:Path"
Push-Location $serverScripts
try {
  & $installedNode $nativeCheckScript
  if ($LASTEXITCODE -ne 0) {
    throw "NSIS installed native module check exited with code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
Write-Host 'PASS: NSIS installed Node matches staged bytes and loads packaged native modules'
