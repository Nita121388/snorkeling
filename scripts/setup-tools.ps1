# Windows compatibility wrapper for the cross-platform bootstrap.

param(
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$nodeArgs = @((Join-Path $PSScriptRoot 'bootstrap.mjs'))
if ($Quiet) {
    $nodeArgs += '--quiet'
}
& node @nodeArgs
exit $LASTEXITCODE
