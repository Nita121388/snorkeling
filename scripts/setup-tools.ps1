# Snorkeling 项目独立工具链安装脚本
# 作用：将 task, zig, go 等工具安装到项目 .tools/ 目录

param(
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path "$PSScriptRoot\.."
$toolsRoot = Join-Path $repoRoot '.tools'
$cacheRoot = Join-Path $repoRoot '.cache'

function Install-Tool {
    param($Name, $Url, $FileName, $ExtractDir)

    $ext = [System.IO.Path]::GetExtension($Url)
    $archive = Join-Path $toolsRoot "$Name$ext"

    if (Test-Path (Join-Path $toolsRoot $Name)) {
        if (-not $Quiet) { Write-Host "[$Name] already installed at .tools/$Name/" }
        return
    }

    if (-not $Quiet) { Write-Host "[$Name] downloading ..." }

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try {
        Invoke-WebRequest -Uri $Url -OutFile $archive -UseBasicParsing -TimeoutSec 120
    } catch {
        Write-Warning "[$Name] download failed: $_"
        if (Test-Path $archive) { Remove-Item $archive -Force }
        return
    }

    if (-not $Quiet) { Write-Host "[$Name] extracting ..." }

    if ($Url -like '*.zip') {
        if ($ExtractDir) {
            $tmp = Join-Path $toolsRoot "_tmp_$Name"
            if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
            Expand-Archive -Path $archive -DestinationPath $tmp -Force
            $src = Join-Path $tmp $ExtractDir
            Move-Item -Path $src -Destination (Join-Path $toolsRoot $Name) -Force
            Remove-Item $tmp -Recurse -Force
        } else {
            Expand-Archive -Path $archive -DestinationPath (Join-Path $toolsRoot $Name) -Force
        }
    } elseif ($Url -like '*.tar.gz') {
        # On Windows with Git Bash we can use tar
        tar -xzf $archive -C $toolsRoot
    }

    Remove-Item $archive -Force
    if (-not $Quiet) { Write-Host "[$Name] installed at .tools/$Name/" }
}

# 1. task (go-task)
Install-Tool -Name "task" -Url "https://github.com/go-task/task/releases/download/v3.42.1/task_windows_amd64.zip" -ExtractDir ""

# 2. zig
Install-Tool -Name "zig" -Url "https://ziglang.org/download/0.13.0/zig-windows-x86_64-0.13.0.zip" -ExtractDir "zig-windows-x86_64-0.13.0"

# 3. 确保 .cache 目录结构
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

# 4. 验证
Write-Host ""
Write-Host "=== 安装完成 ==="
$goExe = Join-Path $toolsRoot "go\bin\go.exe"
if (Test-Path $goExe) {
    $ver = & $goExe version
    Write-Host "Go:       $ver"
} else {
    Write-Host "Go:       NOT FOUND (需要手动安装)"
}
$taskExe = Join-Path $toolsRoot "task\task.exe"
if (Test-Path $taskExe) {
    $ver = & $taskExe --version 2>$null
    Write-Host "Task:     $ver"
} else {
    Write-Host "Task:     NOT FOUND"
}
$zigExe = Join-Path $toolsRoot "zig\zig.exe"
if (Test-Path $zigExe) {
    $ver = & $zigExe version 2>$null
    Write-Host "Zig:      $ver"
} else {
    Write-Host "Zig:      NOT FOUND"
}
Write-Host ''
Write-Host "Run .tools\env.ps1 to activate, then 'task dev:local' to start"
