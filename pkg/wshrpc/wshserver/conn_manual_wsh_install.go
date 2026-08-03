// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
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
	localWshSize, localWshSHA256, err := manualWshFileMetadata(localWshPath)
	if err != nil {
		return wshrpc.CommandManualWshInstallData{}, err
	}
	randHex, err := utilfn.RandomHexString(12)
	if err != nil {
		return wshrpc.CommandManualWshInstallData{}, fmt.Errorf("error generating remote temp path: %w", err)
	}
	remoteTempPath := makeManualRemoteTempPath(clientOs, clientArch, randHex)
	remoteWshPath := makeManualRemoteWshPath(clientOs)
	remoteSshTarget := manualSshTarget(connOpts)
	cmd := buildManualWshInstallCommand(runtime.GOOS, clientOs, connName, localWshPath, remoteSshTarget, connOpts.SSHPort, remoteTempPath, remoteWshPath, localWshSize, localWshSHA256)
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

func manualWshFileMetadata(path string) (int64, string, error) {
	return shellutil.WshFileMetadata(path)
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

func buildManualWshInstallCommand(localGoos string, clientOs string, connName string, localWshPath string, remoteSshTarget string, sshPort string, remoteTempPath string, remoteWshPath string, expectedSize int64, expectedSHA256 string) string {
	remotePrepareCmd, remoteInstallCmd, remoteCleanupCmd := buildManualRemoteInstallCommands(clientOs, remoteTempPath, remoteWshPath, expectedSize, expectedSHA256, fmt.Sprintf("wsh v%s", wavebase.WaveVersion))
	if localGoos == "windows" {
		return buildManualWshInstallPowerShellCommand(connName, localWshPath, remoteSshTarget, sshPort, remoteTempPath, remotePrepareCmd, remoteInstallCmd, remoteCleanupCmd)
	}
	return buildManualWshInstallPosixCommand(connName, localWshPath, remoteSshTarget, sshPort, remoteTempPath, remotePrepareCmd, remoteInstallCmd, remoteCleanupCmd)
}

func buildManualRemoteInstallCommands(clientOs string, remoteTempPath string, remoteWshPath string, expectedSize int64, expectedSHA256 string, expectedVersion string) (string, string, string) {
	if clientOs == "windows" {
		// Windows branch shares the hardened install scripts (size + SHA-256 verify,
		// atomic replace with backup, version verify, rollback, install lock) with the
		// automatic install path via shellutil.BuildWindowsWshInstallScripts. Keeping a
		// single source of truth for the PowerShell install script means manual and
		// automatic installs cannot drift in hardening.
		return shellutil.BuildWindowsWshInstallScripts(remoteTempPath, remoteWshPath, expectedSize, expectedSHA256, expectedVersion)
	}
	remotePrepareCmd := strings.Join([]string{
		`set -eu`,
		`snorkeling_root="$HOME/.snorkeling"`,
		`bin_root="$snorkeling_root/bin"`,
		`[ ! -L "$snorkeling_root" ] || { echo "unsafe wsh install directory: $snorkeling_root" >&2; exit 1; }`,
		`[ ! -e "$snorkeling_root" ] || [ -d "$snorkeling_root" ] || { echo "unsafe wsh install directory: $snorkeling_root" >&2; exit 1; }`,
		`[ ! -L "$bin_root" ] || { echo "unsafe wsh install directory: $bin_root" >&2; exit 1; }`,
		`[ ! -e "$bin_root" ] || [ -d "$bin_root" ] || { echo "unsafe wsh install directory: $bin_root" >&2; exit 1; }`,
		`mkdir -p "$bin_root"`,
		`[ ! -L "$bin_root" ] && [ -d "$bin_root" ] || { echo "unsafe wsh install directory after create: $bin_root" >&2; exit 1; }`,
	}, "\n")
	remoteWshPathValue := shellutil.SoftQuote(remoteWshPath)
	remoteInstallCmd := strings.Join([]string{
		`set -eu`,
		`temp_path=` + shellutil.HardQuote(remoteTempPath),
		`wsh_path=` + remoteWshPathValue,
		fmt.Sprintf(`expected_size=%d`, expectedSize),
		`expected_hash=` + shellutil.HardQuote(expectedSHA256),
		`expected_version=` + shellutil.HardQuote(expectedVersion),
		`backup_path="$wsh_path.backup-$expected_hash-$$"`,
		`lock_path="$wsh_path.manual-install-lock"`,
		`had_backup=0`,
		`replacement_armed=0`,
		`install_complete=0`,
		`lock_acquired=0`,
		`cleanup_install() {`,
		`    status=$?`,
		`    trap - EXIT HUP INT TERM`,
		`    if [ "$install_complete" -eq 0 ]; then`,
		`        if [ "$had_backup" -eq 1 ]; then`,
		`            if [ -L "$backup_path" ] || [ ! -f "$backup_path" ]; then`,
		`                echo "warning: rollback backup is not a regular file; preserved path: $backup_path" >&2`,
		`            elif [ -L "$wsh_path" ] || { [ -e "$wsh_path" ] && [ ! -f "$wsh_path" ]; }; then`,
		`                echo "warning: refusing rollback over non-regular wsh path; backup preserved at $backup_path" >&2`,
		`            elif ! mv "$backup_path" "$wsh_path"; then`,
		`                echo "warning: rollback failed; backup preserved at $backup_path" >&2`,
		`            fi`,
		`        elif [ "$replacement_armed" -eq 1 ] && [ -f "$wsh_path" ] && [ ! -L "$wsh_path" ]; then`,
		`            rm -f "$wsh_path" || echo "warning: rollback cleanup failed: $wsh_path" >&2`,
		`        elif [ "$replacement_armed" -eq 1 ] && { [ -e "$wsh_path" ] || [ -L "$wsh_path" ]; }; then`,
		`            echo "warning: refusing rollback cleanup of non-regular wsh path: $wsh_path" >&2`,
		`        fi`,
		`    fi`,
		`    if [ -f "$temp_path" ] && [ ! -L "$temp_path" ]; then`,
		`        rm -f "$temp_path" || echo "warning: exact temp cleanup failed: $temp_path" >&2`,
		`    fi`,
		`    if [ "$lock_acquired" -eq 1 ]; then`,
		`        rmdir "$lock_path" || echo "warning: wsh install lock release failed: $lock_path" >&2`,
		`    fi`,
		`    exit "$status"`,
		`}`,
		`trap cleanup_install EXIT`,
		`trap 'exit 129' HUP`,
		`trap 'exit 130' INT`,
		`trap 'exit 143' TERM`,
		`[ -f "$temp_path" ] || { echo "uploaded wsh temp file is missing" >&2; exit 1; }`,
		`[ ! -L "$temp_path" ] || { echo "uploaded wsh temp path is a symlink" >&2; exit 1; }`,
		`actual_size=$(wc -c < "$temp_path" | tr -d '[:space:]')`,
		`[ "$actual_size" = "$expected_size" ] || { echo "uploaded wsh size mismatch: expected $expected_size, got $actual_size" >&2; exit 1; }`,
		`if command -v sha256sum >/dev/null 2>&1; then`,
		`    actual_hash=$(sha256sum "$temp_path" | awk '{print $1}')`,
		`elif command -v shasum >/dev/null 2>&1; then`,
		`    actual_hash=$(shasum -a 256 "$temp_path" | awk '{print $1}')`,
		`else`,
		`    echo "no SHA-256 tool found on remote host" >&2`,
		`    exit 1`,
		`fi`,
		`[ "$actual_hash" = "$expected_hash" ] || { echo "uploaded wsh SHA-256 mismatch: expected $expected_hash, got $actual_hash" >&2; exit 1; }`,
		remotePrepareCmd,
		`if ! mkdir "$lock_path"; then echo "another manual wsh install is running or the install lock is unavailable: $lock_path" >&2; exit 1; fi`,
		`lock_acquired=1`,
		`chmod a+x "$temp_path"`,
		`if [ -e "$wsh_path" ] || [ -L "$wsh_path" ]; then`,
		`    [ -f "$wsh_path" ] && [ ! -L "$wsh_path" ] || { echo "existing wsh path is not a regular file" >&2; exit 1; }`,
		`    [ ! -e "$backup_path" ] && [ ! -L "$backup_path" ] || { echo "refusing to overwrite existing backup path: $backup_path" >&2; exit 1; }`,
		`    ln "$wsh_path" "$backup_path"`,
		`    had_backup=1`,
		`fi`,
		`replacement_armed=1`,
		`mv "$temp_path" "$wsh_path"`,
		`version_output=$("$wsh_path" version)`,
		`[ "$version_output" = "$expected_version" ] || { echo "installed wsh version mismatch: expected '$expected_version', got '$version_output'" >&2; exit 1; }`,
		`install_complete=1`,
		`if [ "$had_backup" -eq 1 ]; then`,
		`    if [ -f "$backup_path" ] && [ ! -L "$backup_path" ]; then`,
		`        rm -f "$backup_path" || echo "warning: installed wsh is valid, but backup cleanup failed: $backup_path" >&2`,
		`    else`,
		`        echo "warning: installed wsh is valid, but backup path is not a regular file: $backup_path" >&2`,
		`    fi`,
		`fi`,
	}, "\n")
	remoteCleanupCmd := strings.Join([]string{
		`set -eu`,
		`temp_path=` + shellutil.HardQuote(remoteTempPath),
		`if [ -L "$temp_path" ] || { [ -e "$temp_path" ] && [ ! -f "$temp_path" ]; }; then`,
		`    echo "refusing to clean non-regular wsh temp path: $temp_path" >&2`,
		`    exit 1`,
		`fi`,
		`if [ -f "$temp_path" ]; then rm -f "$temp_path"; fi`,
	}, "\n")
	return remotePrepareCmd, remoteInstallCmd, remoteCleanupCmd
}

func buildManualWshInstallPowerShellCommand(connName string, localWshPath string, remoteSshTarget string, sshPort string, remoteTempPath string, remotePrepareCmd string, remoteInstallCmd string, remoteCleanupCmd string) string {
	var sb strings.Builder
	sb.WriteString("$ErrorActionPreference = \"Stop\"\n")
	sb.WriteString("$LocalWsh = " + shellutil.HardQuotePowerShell(localWshPath) + "\n")
	sb.WriteString("$Remote = " + shellutil.HardQuotePowerShell(remoteSshTarget) + "\n")
	sb.WriteString("$RemoteTemp = " + shellutil.HardQuotePowerShell(remoteTempPath) + "\n")
	sb.WriteString("$ConnName = " + shellutil.HardQuotePowerShell(connName) + "\n")
	sb.WriteString("$RemoteCleanupCmd = " + shellutil.HardQuotePowerShell(remoteCleanupCmd) + "\n")
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
	sb.WriteString("$LocalWshExe = $null\n")
	sb.WriteString("if (-not [string]::IsNullOrWhiteSpace($env:WAVETERM_WSHBINDIR)) { $LocalWshExe = Join-Path $env:WAVETERM_WSHBINDIR \"wsh.exe\" }\n")
	sb.WriteString("$Disconnected = $false\n")
	sb.WriteString("$InstallSucceeded = $false\n")
	sb.WriteString("try {\n")
	sb.WriteString("    if ($LocalWshExe -and (Test-Path -LiteralPath $LocalWshExe -PathType Leaf)) {\n")
	sb.WriteString("        Write-Host \"\"\n")
	sb.WriteString("        Write-Host \"==> Disconnecting Snorkeling connection before replacement\" -ForegroundColor Cyan\n")
	sb.WriteString("        & $LocalWshExe conn disconnect $ConnName\n")
	sb.WriteString("        if ($LASTEXITCODE -ne 0) { throw \"connection disconnect failed with exit code $LASTEXITCODE\" }\n")
	sb.WriteString("        $Disconnected = $true\n")
	sb.WriteString("    } else {\n")
	sb.WriteString("        Write-Warning \"Cannot disconnect automatically. Close the active connection before replacement if Windows reports that wsh.exe is in use.\"\n")
	sb.WriteString("    }\n")
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
	sb.WriteString("$InstallSucceeded = $true\n")
	sb.WriteString("Write-Host \"\"\n")
	sb.WriteString("Write-Host \"==> Reconnecting Snorkeling connection\" -ForegroundColor Cyan\n")
	sb.WriteString("if ($Disconnected) {\n")
	sb.WriteString("    & $LocalWshExe conn connect $ConnName\n")
	sb.WriteString("    if ($LASTEXITCODE -ne 0) { throw \"connection reconnect failed with exit code $LASTEXITCODE\" }\n")
	sb.WriteString("    $Disconnected = $false\n")
	sb.WriteString("} else {\n")
	sb.WriteString("    Write-Host \"wsh installed. Disconnect and reconnect this connection in Snorkeling.\" -ForegroundColor Yellow\n")
	sb.WriteString("}\n")
	sb.WriteString("} finally {\n")
	sb.WriteString("    Write-Host \"\"\n")
	sb.WriteString("    Write-Host \"==> Cleaning this upload's remote temp file\" -ForegroundColor Cyan\n")
	sb.WriteString("    try {\n")
	sb.WriteString("        & ssh @SshArgs $Remote $RemoteCleanupCmd\n")
	sb.WriteString("        if ($LASTEXITCODE -ne 0) { Write-Warning \"exact remote temp cleanup failed with exit code $LASTEXITCODE\" }\n")
	sb.WriteString("    } catch { Write-Warning (\"exact remote temp cleanup failed: {0}\" -f $_.Exception.Message) }\n")
	sb.WriteString("    if ($Disconnected -and $InstallSucceeded) {\n")
	sb.WriteString("        try {\n")
	sb.WriteString("            & $LocalWshExe conn connect $ConnName\n")
	sb.WriteString("            if ($LASTEXITCODE -ne 0) { Write-Warning \"connection recovery failed with exit code $LASTEXITCODE\" }\n")
	sb.WriteString("        } catch { Write-Warning (\"connection recovery failed: {0}\" -f $_.Exception.Message) }\n")
	sb.WriteString("    } elseif ($Disconnected) {\n")
	sb.WriteString("        Write-Warning \"automatic connection recovery skipped after install failure; reconnect manually after verifying wsh installation.\"\n")
	sb.WriteString("    }\n")
	sb.WriteString("}\n")
	sb.WriteString("Write-Host \"\"\n")
	sb.WriteString("Write-Host \"Manual wsh install complete.\" -ForegroundColor Green\n")
	return sb.String()
}

func buildManualWshInstallPosixCommand(connName string, localWshPath string, remoteSshTarget string, sshPort string, remoteTempPath string, remotePrepareCmd string, remoteInstallCmd string, remoteCleanupCmd string) string {
	var sb strings.Builder
	sb.WriteString("set -eu\n")
	sb.WriteString("local_wsh=" + shellutil.HardQuote(localWshPath) + "\n")
	sb.WriteString("remote=" + shellutil.HardQuote(remoteSshTarget) + "\n")
	sb.WriteString("remote_temp=" + shellutil.HardQuote(remoteTempPath) + "\n")
	sb.WriteString("conn_name=" + shellutil.HardQuote(connName) + "\n")
	sb.WriteString("remote_prepare_cmd=" + shellutil.HardQuote(remotePrepareCmd) + "\n")
	sb.WriteString("remote_cleanup_cmd=" + shellutil.HardQuote(remoteCleanupCmd) + "\n")
	sb.WriteString("local_wsh_exe=\n")
	sb.WriteString("disconnected=0\n")
	sb.WriteString("install_succeeded=0\n")
	sb.WriteString("cleanup_manual_install() {\n")
	sb.WriteString("    status=$?\n")
	sb.WriteString("    trap - EXIT HUP INT TERM\n")
	sb.WriteString("    echo\n")
	sb.WriteString("    echo \"==> Cleaning this upload's remote temp file\"\n")
	if sshPort != "" {
		sb.WriteString("    if ! ssh -p " + shellutil.HardQuote(sshPort) + " \"$remote\" \"$remote_cleanup_cmd\"; then echo 'warning: exact remote temp cleanup failed' >&2; fi\n")
	} else {
		sb.WriteString("    if ! ssh \"$remote\" \"$remote_cleanup_cmd\"; then echo 'warning: exact remote temp cleanup failed' >&2; fi\n")
	}
	sb.WriteString("    if [ \"$disconnected\" -eq 1 ] && [ \"$install_succeeded\" -eq 1 ]; then\n")
	sb.WriteString("        if ! \"$local_wsh_exe\" conn connect \"$conn_name\"; then echo 'warning: connection recovery failed' >&2; fi\n")
	sb.WriteString("    elif [ \"$disconnected\" -eq 1 ]; then\n")
	sb.WriteString("        echo 'warning: automatic connection recovery skipped after install failure; reconnect manually after verifying wsh installation' >&2\n")
	sb.WriteString("    fi\n")
	sb.WriteString("    exit \"$status\"\n")
	sb.WriteString("}\n")
	sb.WriteString("trap cleanup_manual_install EXIT\n")
	sb.WriteString("trap 'exit 129' HUP\n")
	sb.WriteString("trap 'exit 130' INT\n")
	sb.WriteString("trap 'exit 143' TERM\n")
	sb.WriteString("echo\n")
	sb.WriteString("echo '==> Checking local tools'\n")
	sb.WriteString("command -v scp >/dev/null || { echo 'Required command not found: scp' >&2; exit 1; }\n")
	sb.WriteString("command -v ssh >/dev/null || { echo 'Required command not found: ssh' >&2; exit 1; }\n")
	sb.WriteString("echo \"Local wsh: $local_wsh\"\n")
	sb.WriteString("echo \"Remote: $remote\"\n")
	sb.WriteString("echo \"Remote temp: $remote_temp\"\n")
	sb.WriteString("if [ -n \"${WAVETERM_WSHBINDIR:-}\" ] && [ -x \"$WAVETERM_WSHBINDIR/wsh\" ]; then\n")
	sb.WriteString("    local_wsh_exe=\"$WAVETERM_WSHBINDIR/wsh\"\n")
	sb.WriteString("    echo\n")
	sb.WriteString("    echo '==> Disconnecting Snorkeling connection before replacement'\n")
	sb.WriteString("    \"$local_wsh_exe\" conn disconnect \"$conn_name\"\n")
	sb.WriteString("    disconnected=1\n")
	sb.WriteString("else\n")
	sb.WriteString("    echo 'warning: cannot disconnect automatically; close the active connection if wsh is in use' >&2\n")
	sb.WriteString("fi\n")
	sb.WriteString("echo\n")
	sb.WriteString("echo '==> Preparing remote directories'\n")
	if sshPort != "" {
		sb.WriteString("ssh -p " + shellutil.HardQuote(sshPort) + " \"$remote\" \"$remote_prepare_cmd\"\n")
	} else {
		sb.WriteString("ssh \"$remote\" \"$remote_prepare_cmd\"\n")
	}
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
	sb.WriteString("install_succeeded=1\n")
	sb.WriteString("echo\n")
	sb.WriteString("echo '==> Reconnecting Snorkeling connection'\n")
	sb.WriteString("if [ \"$disconnected\" -eq 1 ]; then\n")
	sb.WriteString("    \"$local_wsh_exe\" conn connect \"$conn_name\"\n")
	sb.WriteString("    disconnected=0\n")
	sb.WriteString("else\n")
	sb.WriteString("    echo 'wsh installed. Disconnect and reconnect this connection in Snorkeling.'\n")
	sb.WriteString("fi\n")
	sb.WriteString("echo\n")
	sb.WriteString("echo 'Manual wsh install complete.'\n")
	return sb.String()
}
