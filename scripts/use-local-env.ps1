param(
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolsRoot = Join-Path $repoRoot '.tools'
$cacheRoot = Join-Path $repoRoot '.cache'

$requiredDirs = @(
    (Join-Path $cacheRoot 'go-build'),
    (Join-Path $cacheRoot 'gomod'),
    (Join-Path $cacheRoot 'gopath'),
    (Join-Path $cacheRoot 'npm'),
    (Join-Path $cacheRoot 'electron'),
    (Join-Path $cacheRoot 'electron-builder'),
    (Join-Path $cacheRoot 'zig-global'),
    (Join-Path $cacheRoot 'zig-local'),
    (Join-Path $cacheRoot 'tmp')
)

foreach ($dir in $requiredDirs) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$localPaths = @(
    (Join-Path $toolsRoot 'go\bin'),
    (Join-Path $toolsRoot 'zig'),
    (Join-Path $toolsRoot 'task'),
    (Join-Path $repoRoot 'node_modules\.bin')
)

$env:PATH = (($localPaths | Where-Object { Test-Path $_ }) + $env:PATH) -join ';'

$env:GOCACHE = Join-Path $cacheRoot 'go-build'
$env:GOMODCACHE = Join-Path $cacheRoot 'gomod'
$env:GOPATH = Join-Path $cacheRoot 'gopath'
$env:GOENV = 'off'
$env:GOTOOLCHAIN = 'local'
if ([string]::IsNullOrWhiteSpace($env:GOPROXY)) {
    $env:GOPROXY = 'https://goproxy.cn,direct'
}
$env:NPM_CONFIG_CACHE = Join-Path $cacheRoot 'npm'
$env:npm_config_cache = $env:NPM_CONFIG_CACHE
$env:ELECTRON_CACHE = Join-Path $cacheRoot 'electron'
$env:ELECTRON_BUILDER_CACHE = Join-Path $cacheRoot 'electron-builder'
if ([string]::IsNullOrWhiteSpace($env:ELECTRON_MIRROR)) {
    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
}
$env:ZIG_GLOBAL_CACHE_DIR = Join-Path $cacheRoot 'zig-global'
$env:ZIG_LOCAL_CACHE_DIR = Join-Path $cacheRoot 'zig-local'
$env:TEMP = Join-Path $cacheRoot 'tmp'
$env:TMP = $env:TEMP

if ([string]::IsNullOrWhiteSpace($env:NODE_OPTIONS)) {
    $env:NODE_OPTIONS = '--max-old-space-size=8192'
} elseif ($env:NODE_OPTIONS -notmatch '--max-old-space-size') {
    $env:NODE_OPTIONS = "$env:NODE_OPTIONS --max-old-space-size=8192"
}

if (-not $Quiet) {
    Write-Host "Local toolchain enabled: $toolsRoot"
    Write-Host "GOCACHE: $env:GOCACHE"
    Write-Host "GOMODCACHE: $env:GOMODCACHE"
    Write-Host "GOPROXY: $env:GOPROXY"
    Write-Host "NPM cache: $env:NPM_CONFIG_CACHE"
    Write-Host "Electron cache: $env:ELECTRON_CACHE"
    Write-Host "Electron mirror: $env:ELECTRON_MIRROR"
    Write-Host "Zig cache: $env:ZIG_GLOBAL_CACHE_DIR"
    Write-Host "Temp: $env:TEMP"
}
