param(
    [string]$HostName = "",
    [string]$User = "",
    [string]$RemoteWshPath = "",
    [string]$RemoteTempPath = "",
    [string]$InstallRoot = "D:\Apps"
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
    param([string]$Name)
    if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Find-LatestSnorkelingDarwinArm64Wsh {
    param([string]$Root)

    if (-not (Test-Path $Root)) {
        throw "Install root does not exist: $Root"
    }

    $matches = Get-ChildItem -Path $Root -Recurse -Filter "wsh-*-darwin.arm64" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "Snorkeling-win32-x64" } |
        Sort-Object LastWriteTime -Descending

    if (-not $matches -or $matches.Count -eq 0) {
        throw "Could not find Snorkeling darwin arm64 wsh binary under $Root"
    }

    return $matches[0].FullName
}

if ([string]::IsNullOrWhiteSpace($HostName)) {
    throw "HostName is required. Example: scripts\install-remote-wsh.ps1 -HostName 100.64.0.1 -User nita"
}
if ([string]::IsNullOrWhiteSpace($User)) {
    throw "User is required. Example: scripts\install-remote-wsh.ps1 -HostName 100.64.0.1 -User nita"
}
if ([string]::IsNullOrWhiteSpace($RemoteWshPath)) {
    $RemoteWshPath = "/Users/$User/.snorkeling/bin/wsh"
}

$remote = "$User@$HostName"
$remoteDir = Split-Path -Parent $RemoteWshPath
if ([string]::IsNullOrWhiteSpace($RemoteTempPath)) {
    $RemoteTempPath = "/Users/$User/snorkeling-wsh-upload.tmp"
}

Write-Step "Checking tools"
Require-Command "ssh"
Require-Command "scp"

Write-Step "Finding latest Snorkeling darwin arm64 wsh"
$localWsh = Find-LatestSnorkelingDarwinArm64Wsh -Root $InstallRoot
Write-Host "Local wsh: $localWsh"
Write-Host "Remote: $remote"
Write-Host "Target: $RemoteWshPath"

Write-Step "Uploading wsh binary"
scp $localWsh "${remote}:$RemoteTempPath"
if ($LASTEXITCODE -ne 0) {
    throw "scp upload failed with exit code $LASTEXITCODE"
}

Write-Step "Installing and verifying remote wsh"
ssh $remote "mkdir -p '$remoteDir' && mv '$RemoteTempPath' '$RemoteWshPath' && chmod a+x '$RemoteWshPath' && '$RemoteWshPath' version"
if ($LASTEXITCODE -ne 0) {
    throw "remote install failed with exit code $LASTEXITCODE"
}

Write-Step "Done"
Write-Host "Now reconnect this Snorkeling connection:" -ForegroundColor Green
Write-Host "  wsh conn disconnect $remote"
Write-Host "  wsh conn connect $remote"
