param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$TaskArgs
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'use-local-env.ps1') -Quiet

& task @TaskArgs
exit $LASTEXITCODE
