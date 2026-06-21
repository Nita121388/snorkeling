// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) ConnPrepareManualWshInstallCommand(ctx context.Context, data wshrpc.ConnExtData) (wshrpc.CommandManualWshInstallData, error) {
	connName := data.ConnName
	if conncontroller.IsLocalConnName(connName) {
		return wshrpc.CommandManualWshInstallData{}, fmt.Errorf("manual wsh install is only supported for SSH connections")
	}
	if strings.HasPrefix(connName, "wsl://") {
		return wshrpc.CommandManualWshInstallData{}, fmt.Errorf("manual wsh install is not supported for WSL connections")
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return wshrpc.CommandManualWshInstallData{}, fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := conncontroller.MaybeGetConn(connOpts)
	if conn == nil {
		return wshrpc.CommandManualWshInstallData{}, fmt.Errorf("connection not found: %s", connName)
	}
	client := conn.GetClient()
	if client == nil {
		return wshrpc.CommandManualWshInstallData{}, fmt.Errorf("SSH client is not connected. Reconnect once, then open manual install again")
	}
	clientOs, clientArch, err := remote.GetClientPlatform(ctx, genconn.MakeSSHShellClient(client))
	if err != nil {
		return wshrpc.CommandManualWshInstallData{}, fmt.Errorf("error detecting client platform: %w", err)
	}
	localWshPath, err := shellutil.GetLocalWshBinaryPath(wavebase.WaveVersion, clientOs, clientArch)
	if err != nil {
		return wshrpc.CommandManualWshInstallData{}, err
	}
	if _, err := os.Stat(localWshPath); err != nil {
		return wshrpc.CommandManualWshInstallData{}, fmt.Errorf("cannot stat local wsh binary %s: %w", localWshPath, err)
	}
	randHex, err := utilfn.RandomHexString(12)
	if err != nil {
		return wshrpc.CommandManualWshInstallData{}, fmt.Errorf("error generating remote temp path: %w", err)
	}
	remoteTempPath := makeManualRemoteTempPath(clientOs, clientArch, randHex)
	remoteWshPath := makeManualRemoteWshPath(clientOs)
	remoteSshTarget := manualSshTarget(connOpts)
	cmd := buildManualWshInstallCommand(runtime.GOOS, clientOs, connName, localWshPath, remoteSshTarget, connOpts.SSHPort, remoteTempPath, remoteWshPath)
	return wshrpc.CommandManualWshInstallData{
		ConnName:        connName,
		ClientOs:        clientOs,
		ClientArch:      clientArch,
		LocalWshPath:    localWshPath,
		RemoteTempPath:  remoteTempPath,
		RemoteWshPath:   remoteWshPath,
		RemoteSshTarget: remoteSshTarget,
		Cmd:             cmd,
	}, nil
}

func manualSshTarget(opts *remote.SSHOpts) string {
	if opts.SSHUser == "" {
		return opts.SSHHost
	}
	return opts.SSHUser + "@" + opts.SSHHost
}

func makeManualRemoteTempPath(clientOs string, clientArch string, randHex string) string {
	name := fmt.Sprintf("snorkeling-wsh-%s-%s.%s-%s.tmp", wavebase.WaveVersion, clientOs, clientArch, randHex)
	if clientOs == "windows" {
		return ".snorkeling/tmp/" + name
	}
	return "/tmp/" + name
}

func makeManualRemoteWshPath(clientOs string) string {
	if clientOs == "windows" {
		return "$HOME/.snorkeling/bin/wsh.exe"
	}
	return "$HOME/.snorkeling/bin/wsh"
}

func buildManualWshInstallCommand(localGoos string, clientOs string, connName string, localWshPath string, remoteSshTarget string, sshPort string, remoteTempPath string, remoteWshPath string) string {
	remotePrepareCmd, remoteInstallCmd := buildManualRemoteInstallCommands(clientOs, remoteTempPath, remoteWshPath)
	if localGoos == "windows" {
		return buildManualWshInstallPowerShellCommand(connName, localWshPath, remoteSshTarget, sshPort, remoteTempPath, remotePrepareCmd, remoteInstallCmd)
	}
	return buildManualWshInstallPosixCommand(connName, localWshPath, remoteSshTarget, sshPort, remoteTempPath, remoteInstallCmd)
}

func buildManualRemoteInstallCommands(clientOs string, remoteTempPath string, remoteWshPath string) (string, string) {
	if clientOs == "windows" {
		remotePrepareScript := strings.Join([]string{
			`$ErrorActionPreference = "Stop"`,
			`New-Item -ItemType Directory -Force "$HOME\.snorkeling\tmp", "$HOME\.snorkeling\bin" | Out-Null`,
		}, "; ")
		remoteInstallScript := strings.Join([]string{
			`$ErrorActionPreference = "Stop"`,
			`$TempPath = Join-Path $HOME ` + shellutil.HardQuotePowerShell(strings.ReplaceAll(remoteTempPath, "/", `\`)),
			`$WshPath = Join-Path $HOME ".snorkeling\bin\wsh.exe"`,
			`Move-Item -Force $TempPath $WshPath`,
			`& $WshPath version`,
		}, "; ")
		return makeRemotePowerShellCommand(remotePrepareScript), makeRemotePowerShellCommand(remoteInstallScript)
	}
	remotePrepareCmd := `mkdir -p "$HOME/.snorkeling/bin"`
	remoteInstallCmd := fmt.Sprintf(
		"%s; mv %s %s; chmod a+x %s; %s version",
		remotePrepareCmd,
		shellutil.HardQuote(remoteTempPath),
		shellutil.HardQuote(remoteWshPath),
		shellutil.HardQuote(remoteWshPath),
		shellutil.HardQuote(remoteWshPath),
	)
	return remotePrepareCmd, remoteInstallCmd
}

func makeRemotePowerShellCommand(script string) string {
	return shellutil.MakePowerShellEncodedCommand(script)
}

func buildManualWshInstallPowerShellCommand(connName string, localWshPath string, remoteSshTarget string, sshPort string, remoteTempPath string, remotePrepareCmd string, remoteInstallCmd string) string {
	var sb strings.Builder
	sb.WriteString("$ErrorActionPreference = \"Stop\"\n")
	sb.WriteString("$LocalWsh = " + shellutil.HardQuotePowerShell(localWshPath) + "\n")
	sb.WriteString("$Remote = " + shellutil.HardQuotePowerShell(remoteSshTarget) + "\n")
	sb.WriteString("$RemoteTemp = " + shellutil.HardQuotePowerShell(remoteTempPath) + "\n")
	sb.WriteString("$ConnName = " + shellutil.HardQuotePowerShell(connName) + "\n")
	sb.WriteString("$ScpArgs = @()\n")
	sb.WriteString("$SshArgs = @()\n")
	if sshPort != "" {
		sb.WriteString("$ScpArgs += @(\"-P\", " + shellutil.HardQuotePowerShell(sshPort) + ")\n")
		sb.WriteString("$SshArgs += @(\"-p\", " + shellutil.HardQuotePowerShell(sshPort) + ")\n")
	}
	sb.WriteString("Write-Host \"\"\n")
	sb.WriteString("Write-Host \"==> Checking local tools\" -ForegroundColor Cyan\n")
	sb.WriteString("if ($null -eq (Get-Command \"scp\" -ErrorAction SilentlyContinue)) { throw \"Required command not found: scp\" }\n")
	sb.WriteString("if ($null -eq (Get-Command \"ssh\" -ErrorAction SilentlyContinue)) { throw \"Required command not found: ssh\" }\n")
	sb.WriteString("Write-Host \"Local wsh: $LocalWsh\"\n")
	sb.WriteString("Write-Host \"Remote: $Remote\"\n")
	sb.WriteString("Write-Host \"Remote temp: $RemoteTemp\"\n")
	sb.WriteString("Write-Host \"\"\n")
	sb.WriteString("Write-Host \"==> Preparing remote directories\" -ForegroundColor Cyan\n")
	sb.WriteString("$RemotePrepareCmd = " + shellutil.HardQuotePowerShell(remotePrepareCmd) + "\n")
	sb.WriteString("& ssh @SshArgs $Remote $RemotePrepareCmd\n")
	sb.WriteString("if ($LASTEXITCODE -ne 0) { throw \"remote prepare failed with exit code $LASTEXITCODE\" }\n")
	sb.WriteString("Write-Host \"\"\n")
	sb.WriteString("Write-Host \"==> Uploading wsh binary with scp\" -ForegroundColor Cyan\n")
	sb.WriteString("$RemoteScpTarget = \"${Remote}:$RemoteTemp\"\n")
	sb.WriteString("& scp @ScpArgs $LocalWsh $RemoteScpTarget\n")
	sb.WriteString("if ($LASTEXITCODE -ne 0) { throw \"scp upload failed with exit code $LASTEXITCODE\" }\n")
	sb.WriteString("Write-Host \"\"\n")
	sb.WriteString("Write-Host \"==> Installing and verifying remote wsh\" -ForegroundColor Cyan\n")
	sb.WriteString("$RemoteInstallCmd = " + shellutil.HardQuotePowerShell(remoteInstallCmd) + "\n")
	sb.WriteString("& ssh @SshArgs $Remote $RemoteInstallCmd\n")
	sb.WriteString("if ($LASTEXITCODE -ne 0) { throw \"remote install failed with exit code $LASTEXITCODE\" }\n")
	sb.WriteString("Write-Host \"\"\n")
	sb.WriteString("Write-Host \"==> Reconnecting Snorkeling connection\" -ForegroundColor Cyan\n")
	sb.WriteString("$LocalWshExe = $null\n")
	sb.WriteString("if (-not [string]::IsNullOrWhiteSpace($env:WAVETERM_WSHBINDIR)) { $LocalWshExe = Join-Path $env:WAVETERM_WSHBINDIR \"wsh.exe\" }\n")
	sb.WriteString("if ($LocalWshExe -and (Test-Path $LocalWshExe)) {\n")
	sb.WriteString("    & $LocalWshExe conn disconnect $ConnName\n")
	sb.WriteString("    & $LocalWshExe conn connect $ConnName\n")
	sb.WriteString("} else {\n")
	sb.WriteString("    Write-Host \"wsh installed. Disconnect and reconnect this connection in Snorkeling.\" -ForegroundColor Yellow\n")
	sb.WriteString("}\n")
	sb.WriteString("Write-Host \"\"\n")
	sb.WriteString("Write-Host \"Manual wsh install complete.\" -ForegroundColor Green\n")
	return sb.String()
}

func buildManualWshInstallPosixCommand(connName string, localWshPath string, remoteSshTarget string, sshPort string, remoteTempPath string, remoteInstallCmd string) string {
	var sb strings.Builder
	sb.WriteString("set -e\n")
	sb.WriteString("local_wsh=" + shellutil.HardQuote(localWshPath) + "\n")
	sb.WriteString("remote=" + shellutil.HardQuote(remoteSshTarget) + "\n")
	sb.WriteString("remote_temp=" + shellutil.HardQuote(remoteTempPath) + "\n")
	sb.WriteString("conn_name=" + shellutil.HardQuote(connName) + "\n")
	sb.WriteString("echo\n")
	sb.WriteString("echo '==> Checking local tools'\n")
	sb.WriteString("command -v scp >/dev/null || { echo 'Required command not found: scp' >&2; exit 1; }\n")
	sb.WriteString("command -v ssh >/dev/null || { echo 'Required command not found: ssh' >&2; exit 1; }\n")
	sb.WriteString("echo \"Local wsh: $local_wsh\"\n")
	sb.WriteString("echo \"Remote: $remote\"\n")
	sb.WriteString("echo \"Remote temp: $remote_temp\"\n")
	sb.WriteString("echo\n")
	sb.WriteString("echo '==> Uploading wsh binary with scp'\n")
	if sshPort != "" {
		sb.WriteString("scp -P " + shellutil.HardQuote(sshPort) + " \"$local_wsh\" \"${remote}:${remote_temp}\"\n")
	} else {
		sb.WriteString("scp \"$local_wsh\" \"${remote}:${remote_temp}\"\n")
	}
	sb.WriteString("echo\n")
	sb.WriteString("echo '==> Installing and verifying remote wsh'\n")
	if sshPort != "" {
		sb.WriteString("ssh -p " + shellutil.HardQuote(sshPort) + " \"$remote\" " + shellutil.HardQuote(remoteInstallCmd) + "\n")
	} else {
		sb.WriteString("ssh \"$remote\" " + shellutil.HardQuote(remoteInstallCmd) + "\n")
	}
	sb.WriteString("echo\n")
	sb.WriteString("echo '==> Reconnecting Snorkeling connection'\n")
	sb.WriteString("if [ -n \"$WAVETERM_WSHBINDIR\" ] && [ -x \"$WAVETERM_WSHBINDIR/wsh\" ]; then\n")
	sb.WriteString("    \"$WAVETERM_WSHBINDIR/wsh\" conn disconnect \"$conn_name\" || true\n")
	sb.WriteString("    \"$WAVETERM_WSHBINDIR/wsh\" conn connect \"$conn_name\"\n")
	sb.WriteString("else\n")
	sb.WriteString("    echo 'wsh installed. Disconnect and reconnect this connection in Snorkeling.'\n")
	sb.WriteString("fi\n")
	sb.WriteString("echo\n")
	sb.WriteString("echo 'Manual wsh install complete.'\n")
	return sb.String()
}
