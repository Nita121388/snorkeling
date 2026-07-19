param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$TaskArgs
)

$ErrorActionPreference = 'Stop'

& node (Join-Path $PSScriptRoot 'run-task.mjs') @TaskArgs
exit $LASTEXITCODE
