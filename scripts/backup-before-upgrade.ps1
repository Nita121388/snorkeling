# Snorkeling data backup before upgrade.
#
# Why: the app upgrade itself never touches the data dirs, and schema migrations
# are transactional with a backup-first policy. The one version class that
# warrants an extra manual backup is an index-rework release (e.g. the W3-2
# AI Sessions index package: DROP INDEX + partial index + maintenance-window
# VACUUM).
#
# Layout facts this script relies on (verified 2026-11-27):
#   - ~/.snorkeling/ai-sessions/index-v2.sqlite is MACHINE-GLOBAL: it holds
#     annotations / notes / tags / emoji prefs / custom props, which exist
#     ONLY there (session bodies can be re-indexed from agent jsonl files;
#     those cannot). Old auto-backups (index-v2.sqlite.backup-before-*) are
#     excluded on purpose.
#   - waveterm.db / filestore.db live per instance: dev profiles under
#     <repo>\.runcfg\<profile>\data\db\, packaged app under %APPDATA%\snorkeling.
#     Both are discovered automatically.
#
# Stop Snorkeling before a real backup for the cleanest copy (the script also
# copies -wal/-shm sidecars, but a live SQLite file copy is only best-effort).
#
# Usage:
#   Double-click scripts\backup-before-upgrade.cmd  (defaults to E:\backup,
#   keeps the window open and prints the outcome).
#   Or from a shell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-before-upgrade.ps1 `
#       -Destination E:\backup -Label pre-0.0.141
#   Add -DryRun to list what would be copied without copying.
#
# Exit codes: 0 = ok (or dry run ok) / 1 = nothing to back up / 2 = copy error.
param(
    [Parameter(Mandatory = $true)]
    [string]$Destination,
    [string]$Label = "",
    [switch]$DryRun,
    # Dev/verify profiles under .runcfg\<profile>\data are disposable; off by default.
    [switch]$IncludeDevProfiles
)

$ErrorActionPreference = "Stop"

# "E:backup" (drive-relative) would silently resolve against the current
# directory of that drive; normalize to "E:\backup".
if ($Destination -match '^([A-Za-z]):(?!\\)') {
    $Destination = $Destination -replace '^([A-Za-z]):', '$1:\'
}

$repoRoot = Split-Path -Parent $PSScriptRoot

# Candidate data roots, each tagged so files from different roots never
# collide inside the backup folder.
# Default = the instances that matter before an app upgrade: the packaged app
# (appdata), the classic ~/.snorkeling home, and the main dev instance
# (.runcfg\data). Extra dev/verify profiles are opt-in (-IncludeDevProfiles).
function Get-DataRoots($includeDevProfiles) {
    $roots = @(
        @{ Tag = "home"; Dir = Join-Path $env:USERPROFILE ".snorkeling" },
        @{ Tag = "appdata"; Dir = Join-Path $env:APPDATA "snorkeling" },
        @{ Tag = "appdata-dev"; Dir = Join-Path $env:APPDATA "Snorkeling (Dev)" },
        @{ Tag = "localshare"; Dir = Join-Path $env:USERPROFILE ".local\share\snorkeling" }
    )
    $runcfg = Join-Path $repoRoot ".runcfg"
    if (Test-Path $runcfg) {
        $roots += @{ Tag = "runcfg-default"; Dir = $runcfg }
        if ($includeDevProfiles) {
            Get-ChildItem -Path $runcfg -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                if (Test-Path (Join-Path $_.FullName "data")) {
                    $roots += @{ Tag = "runcfg-$($_.Name)"; Dir = $_.FullName }
                }
            }
        }
    }
    return @($roots | Where-Object { Test-Path $_.Dir })
}

function Add-FilesToPlan($plan, $tag, $dir, $note) {
    if (-not (Test-Path $dir)) { return }
    Get-ChildItem -Path $dir -File -ErrorAction SilentlyContinue | ForEach-Object {
        # Skip old auto-backups produced by the app's own backup-first policy.
        if ($_.Name -like "*.backup-before-*" -or $_.Name -like "*.backup-*") { return }
        $plan.Add([pscustomobject]@{ Tag = $tag; File = $_; Note = $note }) | Out-Null
    }
}

$plan = New-Object System.Collections.ArrayList
foreach ($root in Get-DataRoots $IncludeDevProfiles) {
    # 1. Machine-global AI sessions index (the irreplaceable part).
    Add-FilesToPlan $plan $root.Tag (Join-Path $root.Dir "ai-sessions") "AI sessions index (annotations/notes/tags ONLY here)"
    # 2. Per-instance Go DBs, both layouts: <root>\db and <root>\data\db.
    Add-FilesToPlan $plan $root.Tag (Join-Path $root.Dir "db") "waveterm.db / filestore.db (instance data)"
    Add-FilesToPlan $plan $root.Tag (Join-Path $root.Dir "data\db") "waveterm.db / filestore.db (instance data)"
}

# Keep only the SQLite-related files we care about; dedupe by (Tag, FullName).
$keepPattern = "^(index-v2\.sqlite(-wal|-shm)?|waveterm\.db(-wal|-shm)?|filestore\.db(-wal|-shm)?)$"
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$plan = @(
    $plan |
        Where-Object { $_.File.Name -match $keepPattern -and $seen.Add("$($_.Tag)|$($_.File.FullName)") }
)

if ($plan.Count -eq 0) {
    Write-Error "Nothing to back up (no data roots found)."
    exit 1
}

# Running app -> WAL not checkpointed. Sidecar files are included, but a
# stopped app is the only fully clean copy.
$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "^(Snorkeling|wavesrv)" })
if ($running.Count -gt 0) {
    $names = ($running.ProcessName | Sort-Object -Unique) -join ", "
    Write-Warning "Snorkeling is still running ($names). Stopping it first is the cleanest backup."
}

$totalMB = [math]::Round((($plan | ForEach-Object { $_.File.Length } | Measure-Object -Sum).Sum / 1MB), 1)
Write-Host ("Found {0} file(s), {1} MB total:" -f $plan.Count, $totalMB)
foreach ($tag in ($plan | Group-Object Tag | Sort-Object Name)) {
    $tagMB = [math]::Round((($tag.Group | ForEach-Object { $_.File.Length } | Measure-Object -Sum).Sum / 1MB), 1)
    Write-Host ("  [{0}] {1} file(s), {2} MB" -f $tag.Name, $tag.Count, $tagMB)
    foreach ($item in ($tag.Group | Where-Object { $_.File.Length -ge 1MB } | Sort-Object { $_.File.Length } -Descending)) {
        Write-Host ("      {0}  {1,9:N1} MB" -f $item.File.Name, ($item.File.Length / 1MB))
    }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ($Label -ne "") { $stamp = $stamp + "-" + ($Label -replace "[^A-Za-z0-9._-]", "") }
$target = Join-Path $Destination "snorkeling-backup-$stamp"

if ($DryRun) {
    Write-Host "[dry-run] would copy to: $target"
    exit 0
}

try {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($item in $plan) {
        $subDir = Join-Path $target $item.Tag
        New-Item -ItemType Directory -Path $subDir -Force | Out-Null
        Copy-Item -Path $item.File.FullName -Destination $subDir -Force
    }
    # Verify: every planned file exists in the target with the same size.
    $copiedCount = 0
    foreach ($item in $plan) {
        $copy = Get-Item (Join-Path (Join-Path $target $item.Tag) $item.File.Name) -ErrorAction Stop
        if ($copy.Length -ne $item.File.Length) {
            throw "size mismatch after copy: $($item.Tag)\$($item.File.Name)"
        }
        $copiedCount++
    }
    Write-Host ("OK: {0} file(s), {1} MB -> {2}" -f $copiedCount, $totalMB, $target)
    exit 0
}
catch {
    Write-Error "backup failed: $_"
    exit 2
}
