// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"encoding/base64"
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
)

func TestMakeManualRemoteTempPathUsesUserTempForWindows(t *testing.T) {
	path := makeManualRemoteTempPath("windows", "x64", "abc123")
	if strings.HasPrefix(path, "/tmp/") {
		t.Fatalf("expected windows temp path outside /tmp, got %q", path)
	}
	if !strings.HasPrefix(path, ".snorkeling/tmp/") {
		t.Fatalf("expected windows temp path under .snorkeling/tmp, got %q", path)
	}
}

func TestMakeManualRemoteWshPathUsesExeForWindows(t *testing.T) {
	path := makeManualRemoteWshPath("windows")
	if path != "$HOME/.snorkeling/bin/wsh.exe" {
		t.Fatalf("expected windows remote wsh path to use .exe, got %q", path)
	}
}

func TestBuildManualWshInstallPowerShellCommandPreparesRemoteDirs(t *testing.T) {
	remotePrepareCmd, _, remoteCleanupCmd := buildManualRemoteInstallCommands("windows", ".snorkeling/tmp/wsh.tmp", "$HOME/.snorkeling/bin/wsh.exe", 123, strings.Repeat("a", 64), "wsh v1.2.3")
	prepareScript := decodeRemotePowerShellCommand(t, remotePrepareCmd)
	cmd := buildManualWshInstallPowerShellCommand("break@100.65.122.71", `E:\wsh.exe`, "break@100.65.122.71", "", ".snorkeling/tmp/wsh.tmp", remotePrepareCmd, "true", remoteCleanupCmd)
	if !strings.Contains(cmd, "==> Preparing remote directories") {
		t.Fatalf("expected powershell installer to prepare remote directories")
	}
	if !strings.Contains(cmd, "powershell -NoProfile -NonInteractive") {
		t.Fatalf("expected powershell installer to invoke remote powershell")
	}
	if !strings.Contains(cmd, "-EncodedCommand") {
		t.Fatalf("expected remote powershell command to be encoded")
	}
	if strings.Contains(cmd, "Out-Null") {
		t.Fatalf("expected remote powershell script to be encoded before passing to ssh")
	}
	assertContainsAll(t, prepareScript,
		`Assert-SafeInstallDirectory $SnorkelingRoot`,
		`Assert-SafeInstallDirectory $TempRoot`,
		`Assert-SafeInstallDirectory $BinRoot`,
		`[System.IO.FileAttributes]::ReparsePoint`,
	)
	assertBefore(t, prepareScript, `Assert-SafeInstallDirectory $SnorkelingRoot`, `[System.IO.Directory]::CreateDirectory($TempRoot)`)
}

func TestBuildManualRemoteInstallCommandsUsesPosixForNonWindows(t *testing.T) {
	remotePrepareCmd, remoteInstallCmd, remoteCleanupCmd := buildManualRemoteInstallCommands("linux", "/tmp/wsh.tmp", "$HOME/.snorkeling/bin/wsh", 123, strings.Repeat("a", 64), "wsh v1.2.3")
	if strings.Contains(remotePrepareCmd, "powershell") || strings.Contains(remoteInstallCmd, "powershell") {
		t.Fatalf("expected non-windows remote commands to remain posix")
	}
	if strings.Contains(remoteCleanupCmd, "powershell") {
		t.Fatalf("expected non-windows cleanup command to remain posix")
	}
	assertContainsAll(t, remotePrepareCmd,
		`[ ! -L "$snorkeling_root" ]`,
		`[ ! -L "$bin_root" ]`,
		`mkdir -p "$bin_root"`,
	)
	assertPosixSyntax(t, remotePrepareCmd)
}

func TestEncodePowerShellCommand(t *testing.T) {
	encoded := shellutil.EncodePowerShellCommand(`Write-Host "ok"`)
	if encoded == "" {
		t.Fatalf("expected encoded command")
	}
	if strings.Contains(encoded, "Write-Host") {
		t.Fatalf("expected encoded command not to contain raw script")
	}
}

func TestManualWshFileMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "wsh")
	if err := os.WriteFile(path, []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	size, hash, err := manualWshFileMetadata(path)
	if err != nil {
		t.Fatal(err)
	}
	if size != 3 {
		t.Fatalf("expected size 3, got %d", size)
	}
	if hash != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatalf("unexpected SHA-256: %s", hash)
	}
}

func TestWindowsRemoteInstallValidatesBeforeAtomicReplaceAndRollsBack(t *testing.T) {
	_, installCmd, cleanupCmd := buildManualRemoteInstallCommands(
		"windows",
		".snorkeling/tmp/snorkeling-wsh-test.tmp",
		"$HOME/.snorkeling/bin/wsh.exe",
		123,
		strings.Repeat("a", 64),
		"wsh v1.2.3",
	)
	installScript := decodeRemotePowerShellCommand(t, installCmd)
	cleanupScript := decodeRemotePowerShellCommand(t, cleanupCmd)

	assertContainsAll(t, installScript,
		`$ExpectedSize = [Int64]123`,
		`Get-FileHash -LiteralPath $TempPath -Algorithm SHA256`,
		`Assert-SafeInstallDirectory $TempRoot`,
		`Assert-SafeInstallDirectory $BinRoot`,
		`$InstallLockPath = Join-Path $BinRoot ".wsh-manual-install.lock"`,
		`[System.IO.FileShare]::None`,
		`$InstallLockStream.Dispose()`,
		`[Guid]::NewGuid().ToString("N")`,
		`[System.IO.File]::Replace($TempPath, $WshPath, $BackupPath, $true)`,
		`[System.IO.File]::Replace($BackupPath, $WshPath, $null, $true)`,
		`Where-Object { $_ -ceq $ExpectedVersion }`,
		`$VersionMatches.Count -eq 0`,
		`backup preserved at`,
		`} finally {`,
		`Remove-Item -LiteralPath $TempPath -ErrorAction Stop`,
	)
	assertBefore(t, installScript, `$TempFile.Length -ne $ExpectedSize`, `[System.IO.File]::Replace($TempPath`)
	assertBefore(t, installScript, `Get-FileHash -LiteralPath $TempPath`, `[System.IO.File]::Replace($TempPath`)
	assertBefore(t, installScript, `Get-FileHash -LiteralPath $TempPath`, `Move-Item -LiteralPath $TempPath`)
	finallyScript := installScript[strings.LastIndex(installScript, `} finally {`):]
	if strings.Contains(finallyScript, `$WshPath`) || strings.Contains(finallyScript, `$BackupPath`) {
		t.Fatalf("expected finally block to clean only the exact temp path:\n%s", finallyScript)
	}
	assertSafeExactCleanup(t, installScript)
	assertSafeExactCleanup(t, cleanupScript)
	assertContainsAll(t, cleanupScript,
		`.snorkeling\tmp\snorkeling-wsh-test.tmp`,
		`Assert-SafeCleanupDirectory $SnorkelingRoot`,
		`Assert-SafeCleanupDirectory $TempRoot`,
		`Get-Item -LiteralPath $TempPath`,
		`Remove-Item -LiteralPath $TempPath`,
		`ReparsePoint`,
	)
}

func TestPosixRemoteInstallValidatesBeforeMoveAndCleansExactTemp(t *testing.T) {
	_, installCmd, cleanupCmd := buildManualRemoteInstallCommands(
		"linux",
		"/tmp/snorkeling-wsh-test.tmp",
		"$HOME/.snorkeling/bin/wsh",
		123,
		strings.Repeat("a", 64),
		"wsh v1.2.3",
	)
	assertContainsAll(t, installCmd,
		`expected_size=123`,
		`wsh_path="$HOME/.snorkeling/bin/wsh"`,
		`backup_path="$wsh_path.backup-$expected_hash-$$"`,
		`lock_path="$wsh_path.manual-install-lock"`,
		`actual_size=$(wc -c < "$temp_path"`,
		`sha256sum "$temp_path"`,
		`shasum -a 256 "$temp_path"`,
		`trap cleanup_install EXIT`,
		`trap 'exit 130' INT`,
		`if ! mkdir "$lock_path"`,
		`rmdir "$lock_path"`,
		`existing wsh path is not a regular file`,
		`ln "$wsh_path" "$backup_path"`,
		`replacement_armed=1`,
		`rollback failed; backup preserved at`,
		`rm -f "$temp_path"`,
		`[ "$version_output" = "$expected_version" ]`,
	)
	assertBefore(t, installCmd, `actual_size=$(wc -c`, `mv "$temp_path" "$wsh_path"`)
	assertBefore(t, installCmd, `actual_hash=$(sha256sum`, `mv "$temp_path" "$wsh_path"`)
	assertBefore(t, installCmd, `chmod a+x "$temp_path"`, `mv "$temp_path" "$wsh_path"`)
	assertContainsAll(t, cleanupCmd,
		`temp_path=/tmp/snorkeling-wsh-test.tmp`,
		`[ -L "$temp_path" ]`,
		`rm -f "$temp_path"`,
	)
	assertSafeExactCleanup(t, installCmd)
	assertSafeExactCleanup(t, cleanupCmd)
	assertPosixSyntax(t, installCmd, cleanupCmd)
}

func TestPosixRemoteInstallRollsBackWhenVersionValidationFails(t *testing.T) {
	shPath, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("sh is not available")
	}
	homeDir := t.TempDir()
	installDir := filepath.Join(homeDir, ".snorkeling", "bin")
	if err := os.MkdirAll(installDir, 0700); err != nil {
		t.Fatal(err)
	}
	tempPath := filepath.Join(t.TempDir(), "uploaded-wsh")
	newWsh := []byte("#!/bin/sh\necho 'wsh vwrong'\n")
	if err := os.WriteFile(tempPath, newWsh, 0600); err != nil {
		t.Fatal(err)
	}
	wshPath := filepath.Join(installDir, "wsh")
	oldWsh := []byte("old-wsh-binary\n")
	if err := os.WriteFile(wshPath, oldWsh, 0700); err != nil {
		t.Fatal(err)
	}
	size, hash, err := manualWshFileMetadata(tempPath)
	if err != nil {
		t.Fatal(err)
	}
	_, installCmd, _ := buildManualRemoteInstallCommands("linux", tempPath, wshPath, size, hash, "wsh vexpected")
	cmd := exec.Command(shPath, "-c", installCmd)
	cmd.Env = append(os.Environ(), "HOME="+homeDir)
	if output, err := cmd.CombinedOutput(); err == nil {
		t.Fatalf("expected version validation to fail, output:\n%s", output)
	}
	gotOldWsh, err := os.ReadFile(wshPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotOldWsh) != string(oldWsh) {
		t.Fatalf("expected old wsh to be restored, got %q", gotOldWsh)
	}
	if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
		t.Fatalf("expected exact upload temp to be removed, stat error: %v", err)
	}
	backups, err := filepath.Glob(wshPath + ".backup-*")
	if err != nil {
		t.Fatal(err)
	}
	if len(backups) != 0 {
		t.Fatalf("expected rollback backup to be consumed, got %v", backups)
	}
	if _, err := os.Stat(wshPath + ".manual-install-lock"); !os.IsNotExist(err) {
		t.Fatalf("expected manual install lock to be released, stat error: %v", err)
	}
}

func TestManualInstallWrappersDisconnectBeforeUploadAndCleanupOnExit(t *testing.T) {
	powerShellCmd := buildManualWshInstallPowerShellCommand(
		"break@example.test",
		`E:\wsh.exe`,
		"break@example.test",
		"2222",
		".snorkeling/tmp/wsh.tmp",
		"REMOTE-PREPARE",
		"REMOTE-INSTALL",
		"REMOTE-CLEANUP-EXACT",
	)
	assertBefore(t, powerShellCmd, `conn disconnect $ConnName`, `& scp @ScpArgs`)
	assertBefore(t, powerShellCmd, `& scp @ScpArgs`, `} finally {`)
	assertContainsAll(t, powerShellCmd,
		`$RemoteCleanupCmd = "REMOTE-CLEANUP-EXACT"`,
		`& ssh @SshArgs $Remote $RemoteCleanupCmd`,
		`Write-Warning "exact remote temp cleanup failed`,
		`$InstallSucceeded = $false`,
		`if ($Disconnected -and $InstallSucceeded)`,
		`automatic connection recovery skipped after install failure`,
	)
	posixCmd := buildManualWshInstallPosixCommand(
		"break@example.test",
		"/local/wsh",
		"break@example.test",
		"2222",
		"/tmp/wsh.tmp",
		"REMOTE-PREPARE",
		"REMOTE-INSTALL",
		"REMOTE-CLEANUP-EXACT",
	)
	assertBefore(t, posixCmd, `conn disconnect "$conn_name"`, `scp -P`)
	assertBefore(t, posixCmd, `REMOTE-PREPARE`, `scp -P`)
	assertContainsAll(t, posixCmd,
		`trap cleanup_manual_install EXIT`,
		`remote_cleanup_cmd=REMOTE-CLEANUP-EXACT`,
		`if ! ssh -p 2222 "$remote" "$remote_cleanup_cmd"`,
		`warning: exact remote temp cleanup failed`,
		`install_succeeded=0`,
		`if [ "$disconnected" -eq 1 ] && [ "$install_succeeded" -eq 1 ]`,
		`automatic connection recovery skipped after install failure`,
	)
	assertPosixSyntax(t, posixCmd)
}

func decodeRemotePowerShellCommand(t *testing.T, command string) string {
	t.Helper()
	const marker = "-EncodedCommand "
	markerIndex := strings.Index(command, marker)
	if markerIndex == -1 {
		t.Fatalf("expected encoded PowerShell command, got %q", command)
	}
	data, err := base64.StdEncoding.DecodeString(command[markerIndex+len(marker):])
	if err != nil {
		t.Fatal(err)
	}
	if len(data)%2 != 0 {
		t.Fatalf("expected UTF-16LE data, got %d bytes", len(data))
	}
	words := make([]uint16, len(data)/2)
	for index := range words {
		words[index] = binary.LittleEndian.Uint16(data[index*2:])
	}
	return string(utf16.Decode(words))
}

func assertContainsAll(t *testing.T, value string, expected ...string) {
	t.Helper()
	for _, fragment := range expected {
		if !strings.Contains(value, fragment) {
			t.Fatalf("expected %q in:\n%s", fragment, value)
		}
	}
}

func assertBefore(t *testing.T, value string, first string, second string) {
	t.Helper()
	firstIndex := strings.Index(value, first)
	secondIndex := strings.Index(value, second)
	if firstIndex == -1 || secondIndex == -1 || firstIndex >= secondIndex {
		t.Fatalf("expected %q before %q in:\n%s", first, second, value)
	}
}

func assertSafeExactCleanup(t *testing.T, script string) {
	t.Helper()
	for _, forbidden := range []string{"*", "-Recurse", "Get-ChildItem", "find ", "rm -r", "Remove-Item -Path", "Remove-Item -LiteralPath $TempPath -Force", "Remove-Item -LiteralPath $BackupPath -Force"} {
		if strings.Contains(script, forbidden) {
			t.Fatalf("cleanup script contains forbidden %q:\n%s", forbidden, script)
		}
	}
}

func assertPosixSyntax(t *testing.T, scripts ...string) {
	t.Helper()
	shPath, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("sh is not available")
	}
	for _, script := range scripts {
		cmd := exec.Command(shPath, "-n")
		cmd.Stdin = strings.NewReader(script)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("invalid POSIX shell syntax: %v\n%s\n%s", err, output, script)
		}
	}
}
