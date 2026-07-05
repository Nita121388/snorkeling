# 启动 Snorkeling 浅色主题开发版（完全隔离，不影响正式版）
# 使用方法：在 PowerShell 中执行此脚本

param(
    [int]$Port = 51741,
    [string]$BaseDir = "$env:USERPROFILE\.snorkeling-light",
    [string]$SharedToolsRoot = "E:\primary\projects\snorkeling\.tools",
    [switch]$BuildOnly = $false,
    [switch]$NoBuild = $false
)

Write-Host "=== Snorkeling Light Theme Dev Server ===" -ForegroundColor Cyan
Write-Host ""

# ======== 端口配置 ========
$VITE_PORT = $Port

# ======== 独立的数据和配置目录 ========
$ISOLATED_DIR = $BaseDir
$ISOLATED_DATA_DIR = "$ISOLATED_DIR\data"
$ISOLATED_CONFIG_DIR = "$ISOLATED_DIR\config"
$ISOLATED_AI_SESSIONS_DIR = "$ISOLATED_DIR\ai-sessions"
$ISOLATED_ELECTRON_DIR = "$ISOLATED_DIR\electron"
$ISOLATED_LEGACY_HOME_DIR = "$ISOLATED_DIR\legacy-home"

# ======== 设置隔离环境变量 ========
$env:WAVETERM_DATA_HOME = $ISOLATED_DATA_DIR
$env:WAVETERM_CONFIG_HOME = $ISOLATED_CONFIG_DIR
$env:WAVETERM_HOME = $ISOLATED_LEGACY_HOME_DIR
$env:WAVETERM_ELECTRON_USER_DATA_HOME = $ISOLATED_ELECTRON_DIR
$env:WAVETERM_NOCONFIRMQUIT = "1"
$env:SNORKELING_VITE_PORT = "$VITE_PORT"

# AI Sessions 也需要独立隔离（默认路径不受 WAVETERM_DATA_HOME 控制）
$env:WAVETERM_AI_SESSIONS_INDEX = "$ISOLATED_AI_SESSIONS_DIR\index.json"
$env:WAVETERM_AI_SESSIONS_SQLITE_INDEX = "$ISOLATED_AI_SESSIONS_DIR\index-v2.sqlite"
$env:WAVETERM_AI_SESSIONS_META = "$ISOLATED_AI_SESSIONS_DIR\meta.json"
$env:WAVETERM_AI_SESSIONS_DELETED_DIR = "$ISOLATED_AI_SESSIONS_DIR\deleted"

Write-Host "Isolated Data Dir:    $ISOLATED_DATA_DIR" -ForegroundColor Yellow
Write-Host "Isolated Config Dir:  $ISOLATED_CONFIG_DIR" -ForegroundColor Yellow
Write-Host "Electron UserData:    $ISOLATED_ELECTRON_DIR" -ForegroundColor Yellow
Write-Host "Vite Port:            $VITE_PORT" -ForegroundColor Yellow
Write-Host ""

# ======== 创建目录 ========
$null = New-Item -ItemType Directory -Force -Path $ISOLATED_DATA_DIR
$null = New-Item -ItemType Directory -Force -Path $ISOLATED_CONFIG_DIR
$null = New-Item -ItemType Directory -Force -Path $ISOLATED_AI_SESSIONS_DIR
$null = New-Item -ItemType Directory -Force -Path $ISOLATED_ELECTRON_DIR
$null = New-Item -ItemType Directory -Force -Path $ISOLATED_LEGACY_HOME_DIR

# 切换到项目目录
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

. .\scripts\use-local-env.ps1 -Quiet

if (Test-Path $SharedToolsRoot) {
    $sharedToolPaths = @(
        (Join-Path $SharedToolsRoot "go\bin"),
        (Join-Path $SharedToolsRoot "zig"),
        (Join-Path $SharedToolsRoot "task")
    ) | Where-Object { Test-Path $_ }
    if ($sharedToolPaths.Count -gt 0) {
        $env:PATH = ($sharedToolPaths + $env:PATH) -join ";"
        $env:Path = $env:PATH
    }
}

if (-not $NoBuild) {
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
        Write-Host "Missing Go. Install local tools in either this repo or E:\primary\projects\snorkeling, then start again." -ForegroundColor Red
        exit 1
    }
    if (-not (Get-Command zig -ErrorAction SilentlyContinue)) {
        Write-Host "Missing Zig. Install local tools in either this repo or E:\primary\projects\snorkeling, then start again." -ForegroundColor Red
        exit 1
    }

    Write-Host "Building isolated dev backend..." -ForegroundColor Green
    $null = New-Item -ItemType Directory -Force -Path ".\dist\bin"
    $zigPath = (Get-Command zig -ErrorAction Stop).Source
    $env:CGO_ENABLED = "1"
    $env:GOARCH = "amd64"
    $env:CC = "$zigPath cc -target x86_64-windows-gnu"
    $version = node version.cjs
    $buildTime = Get-Date -UFormat "%Y%m%d%H%M"
    go build -tags "osusergo,sqlite_omit_load_extension" -ldflags "-s -w -X main.BuildTime=$buildTime -X main.WaveVersion=$version" -o dist\bin\wavesrv.x64.exe cmd\server\main-server.go
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    Write-Host ""
    if ($BuildOnly) {
        Write-Host "Build complete. Skipping Electron start because -BuildOnly was set." -ForegroundColor Green
        exit 0
    }
} else {
    $wavesrvPath = Join-Path (Get-Location) "dist\bin\wavesrv.x64.exe"
    if (-not (Test-Path $wavesrvPath)) {
        Write-Host "Missing $wavesrvPath. Start without -NoBuild once to build it first." -ForegroundColor Red
        exit 1
    }
}

# ======== 启动 ========
Write-Host "Starting Snorkeling (Light Theme Dev)..." -ForegroundColor Green
Write-Host ""

npx electron-vite dev
