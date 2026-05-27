# We source this file with -NoExit -File
$env:PATH = {{.WSHBINDIR_PWSH}} + "{{.PATHSEP}}" + $env:PATH

# Source dynamic script from wsh token
$waveterm_swaptoken_output = wsh token $env:WAVETERM_SWAPTOKEN pwsh 2>$null | Out-String
if ($waveterm_swaptoken_output -and $waveterm_swaptoken_output -ne "") {
    Invoke-Expression $waveterm_swaptoken_output
}
Remove-Variable -Name waveterm_swaptoken_output
Remove-Item Env:WAVETERM_SWAPTOKEN

$Global:_WAVETERM_SI_FIRSTPROMPT = $true

# shell integration
function Global:_waveterm_si_blocked {
    # Check if we're in tmux or screen
    return ($env:TMUX -or $env:STY -or $env:TERM -like "tmux*" -or $env:TERM -like "screen*")
}

function Global:_waveterm_si_osc {
    param([string]$Payload)
    $esc = [char]27
    $bel = [char]7
    Write-Host -NoNewline "$esc]$Payload$bel"
}

function Global:_waveterm_si_osc7 {
    if (_waveterm_si_blocked) { return }
    
    # Percent-encode the raw path as-is (handles UNC, drive letters, etc.)
    $encoded_pwd = [System.Uri]::EscapeDataString($PWD.Path)
    
    # OSC 7 - current directory
    _waveterm_si_osc "7;file://localhost/$encoded_pwd"
}

function Global:_waveterm_si_command_start {
    param([string]$CommandLine)
    if (_waveterm_si_blocked) { return }

    if ($null -eq $CommandLine) {
        _waveterm_si_osc "16162;C"
        return
    }

    $commandText = $CommandLine
    if ($commandText.Length -gt 8192) {
        $commandText = "# command too large ($($commandText.Length) bytes)"
    }
    $cmd64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($commandText))
    if ($cmd64 -ne "") {
        _waveterm_si_osc "16162;C;{`"cmd64`":`"$cmd64`"}"
    } else {
        _waveterm_si_osc "16162;C"
    }
}

function Global:_waveterm_si_prompt {
    if (_waveterm_si_blocked) { return }
    
    if ($Global:_WAVETERM_SI_FIRSTPROMPT) {
		# not sending uname
		       $shellversion = $PSVersionTable.PSVersion.ToString()
		       _waveterm_si_osc "16162;M;{`"shell`":`"pwsh`",`"shellversion`":`"$shellversion`",`"integration`":true}"
        $Global:_WAVETERM_SI_FIRSTPROMPT = $false
    }
    
    _waveterm_si_osc7
}

# Add the OSC 7 call to the prompt function
if (Test-Path Function:\prompt) {
    $global:_waveterm_original_prompt = $function:prompt
    function Global:prompt {
        _waveterm_si_prompt
        & $global:_waveterm_original_prompt
    }
} else {
    function Global:prompt {
        _waveterm_si_prompt
        "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
    }
}

function Global:_waveterm_si_bind_accept_line {
    if (-not (Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue)) { return }
    try {
        Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
            $commandLine = $null
            $cursor = $null
            [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$commandLine, [ref]$cursor)
            _waveterm_si_command_start $commandLine
            [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
        }
    } catch {
        # Leave the default Enter binding intact if PSReadLine is unavailable or restricted.
    }
}

# Load Wave completions
wsh completion powershell | Out-String | Invoke-Expression

_waveterm_si_bind_accept_line

if ($PSVersionTable.PSVersion.Major -ge 7 -and $PSStyle.FileInfo.Directory -eq "`e[44;1m") {
    $PSStyle.FileInfo.Directory = "`e[34;1m"
}
