// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"unicode/utf16"
)

// decodePowerShellEncodedCommand extracts the raw script carried by a
// `powershell -NoProfile -NonInteractive -EncodedCommand <base64-utf16le>` invocation.
// PowerShell expects the encoded payload to be UTF-16LE base64, so we decode base64 and
// then re-interpret the bytes as little-endian UTF-16 code units before joining them
// into a Go string. Returns the input unchanged if it does not look like an encoded
// command.
func decodePowerShellEncodedCommand(t *testing.T, cmd string) string {
	t.Helper()
	idx := strings.Index(cmd, "-EncodedCommand ")
	if idx < 0 {
		return cmd
	}
	encoded := strings.TrimSpace(cmd[idx+len("-EncodedCommand "):])
	// The encoded payload may inherit a trailing quote added by MakePowerShellEncodedCommand.
	encoded = strings.Trim(encoded, "\"'")
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("cannot base64-decode -EncodedCommand payload: %v\nraw: %q", err, cmd)
	}
	if len(raw)%2 != 0 {
		t.Fatalf("encoded payload is not a UTF-16LE byte stream (odd length %d): %q", len(raw), cmd)
	}
	units := make([]uint16, len(raw)/2)
	for i := 0; i < len(raw); i += 2 {
		units[i/2] = uint16(raw[i]) | uint16(raw[i+1])<<8
	}
	return string(utf16.Decode(units))
}

func TestPowerShellStdinCommandUsesFramedLoader(t *testing.T) {
	if len(PowerShellStdinCommand) >= 8191 {
		t.Fatalf("PowerShell stdin launcher exceeds the cmd.exe command-line limit: %d", len(PowerShellStdinCommand))
	}
	if strings.Contains(PowerShellStdinCommand, "-Command -") {
		t.Errorf("PowerShell stdin launcher must not use the multiline-incompatible -Command - mode")
	}
	loader := decodePowerShellEncodedCommand(t, PowerShellStdinCommand)
	for _, marker := range []string{"[Console]::In.ReadLine()", "[ScriptBlock]::Create", powerShellStdinTerminator, "missing PowerShell stdin terminator"} {
		if !strings.Contains(loader, marker) {
			t.Errorf("PowerShell stdin loader is missing %q: %s", marker, loader)
		}
	}
}

func TestPowerShellStdinCommandExecutesMultilineScript(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows PowerShell 5.1 regression test")
	}
	commandParts := strings.Fields(PowerShellStdinCommand)
	if len(commandParts) < 2 {
		t.Fatalf("invalid PowerShell stdin launcher: %q", PowerShellStdinCommand)
	}
	cmd := exec.Command(commandParts[0], commandParts[1:]...)
	cmd.Stdin = strings.NewReader(strings.Join([]string{
		`$ErrorActionPreference = "Stop"`,
		`try {`,
		`    Write-Output "stdin-multiline-ran"`,
		`} catch {`,
		`    exit 1`,
		`}`,
		powerShellStdinTerminator,
		``,
	}, "\n"))
	var stdout strings.Builder
	var stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("PowerShell stdin launcher failed: %v\nstderr: %s", err, stderr.String())
	}
	if strings.TrimSpace(stdout.String()) != "stdin-multiline-ran" {
		t.Fatalf("PowerShell stdin launcher did not execute the multiline script; stdout=%q stderr=%q", stdout.String(), stderr.String())
	}
}

// TestBuildWindowsWshInstallScriptsHardeningMarkers asserts that the generated install
// command carries the full set of hardening features the manual install flow was
// written to provide. These markers are what makes the install safe, not just functional;
// their presence is the contract between the manual and automatic install paths sharing
// this code. If a marker is missing the install has lost a safety property and the test
// must fail loudly.
func TestBuildWindowsWshInstallScriptsHardeningMarkers(t *testing.T) {
	const tempPath = "~/.snorkeling/tmp/wsh.exe.050101.000000.0000.tmp"
	const expectedPowerShellTempPath = `.snorkeling\tmp\wsh.exe.050101.000000.0000.tmp`
	const wshPath = "$HOME/.snorkeling/bin/wsh.exe"
	const expectedSize = int64(12345)
	const expectedSHA256 = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	const expectedVersion = "wsh v0.14.5-beta.4.snorkeling.0.0.47"

	prepareCmd, installCmd, cleanupCmd := BuildWindowsWshInstallScripts(tempPath, wshPath, expectedSize, expectedSHA256, expectedVersion)

	// SSH must receive only the fixed short PowerShell launcher as its command;
	// these generated values are sent through stdin and therefore must be raw scripts.
	for _, script := range []struct{ name, value string }{
		{"prepare", prepareCmd},
		{"install", installCmd},
		{"cleanup", cleanupCmd},
	} {
		if strings.TrimSpace(script.value) == "" {
			t.Errorf("%s script must not be empty", script.name)
		}
		if strings.Contains(script.value, "-EncodedCommand") || strings.Contains(script.value, "powershell -NoProfile") {
			t.Errorf("%s must be raw PowerShell sent through stdin, got command wrapper: %q", script.name, script.value)
		}
		if !strings.HasSuffix(strings.TrimSpace(script.value), powerShellStdinTerminator) {
			t.Errorf("%s script must end with the PowerShell stdin terminator", script.name)
		}
	}

	// The install command embeds the prepare script at its head, so all the prepare
	// markers must appear in the decoded install command too.
	installScript := decodePowerShellEncodedCommand(t, installCmd)

	// Markers that prove each safety property is present in the install script.
	type marker struct {
		name     string
		fragment string
	}
	markers := []marker{
		{"stop-on-error", `$ErrorActionPreference = "Stop"`},
		{"safe-dir-guard", `function Assert-SafeInstallDirectory`},
		{"temp-size-check", `if ($TempFile.Length -ne $ExpectedSize)`},
		{"sha256-check", `Get-FileHash -LiteralPath $TempPath -Algorithm SHA256`},
		{"sha256-orderless-compare", `[System.StringComparison]::OrdinalIgnoreCase`},
		{"install-lock-file", `.wsh-manual-install.lock`},
		{"install-lock-exclusive-open", `[System.IO.FileShare]::None`},
		{"existing-file-regular-check", `existing wsh path is not a regular file`},
		{"atomic-replace", `[System.IO.File]::Replace($TempPath, $WshPath, $BackupPath, $true)`},
		{"backup-path-guid", `$BackupPath = $WshPath + ".backup-" + [Guid]::NewGuid()`},
		{"version-verify", `& $WshPath version`},
		{"version-exact-match", `$_ -ceq $ExpectedVersion`},
		{"rollback-replace", `[System.IO.File]::Replace($BackupPath, $WshPath, $null, $true)`},
		{"rollback-remove", `Remove-Item -LiteralPath $WshPath -ErrorAction Stop`},
		{"install-failure-throw", `throw ("wsh install failed:`},
		{"stage-version", `$InstallStage = "version"`},
		{"plain-stderr", `[Console]::Error.WriteLine(("wsh-install-error stage={0}: {1}"`},
		{"temp-finally-cleanup", `finally {`},
		{"reparse-point-trap-reject", `refusing to clean non-regular wsh temp path`},
	}
	var missing []string
	for _, m := range markers {
		if !strings.Contains(installScript, m.fragment) {
			missing = append(missing, m.name)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("install script is missing hardening markers: %v\nfull decoded install script:\n%s", missing, installScript)
	}

	// The expected size, hash, and version must all appear verbatim in the install script,
	// so a wrong upload (size/hash mismatch) or wrong binary (version mismatch) is caught.
	if !strings.Contains(installScript, "12345") {
		t.Errorf("install script must reference expected size 12345")
	}
	if !strings.Contains(installScript, expectedSHA256) {
		t.Errorf("install script must reference expected SHA-256 hash")
	}
	if !strings.Contains(installScript, expectedVersion) {
		t.Errorf("install script must reference expected version line %q", expectedVersion)
	}

	// SFTP 和 PowerShell 都使用相对于 home 的临时路径，确认脚本不会把 shell 的 ~ 标记当作普通目录名。
	if strings.Contains(installScript, tempPath) {
		t.Errorf("install script must not contain the un-escaped forward-slash temp path: %q", tempPath)
	}
	if strings.Contains(installScript, `~\.snorkeling`) {
		t.Errorf("install script must not join $HOME with a literal tilde path")
	}
	if !strings.Contains(installScript, expectedPowerShellTempPath) {
		t.Errorf("install script must contain the normalized home-relative temp path")
	}

	// The cleanup script must remove the half-written temp file when an upload/install
	// aborted, so a later install is not blocked by it. Decode and check it references
	// the temp path and a Remove-Item with -LiteralPath (no wildcards).
	cleanupScript := decodePowerShellEncodedCommand(t, cleanupCmd)
	if strings.Contains(cleanupScript, `~\.snorkeling`) {
		t.Errorf("cleanup script must not join $HOME with a literal tilde path")
	}
	if !strings.Contains(cleanupScript, expectedPowerShellTempPath) {
		t.Errorf("cleanup script must reference the normalized home-relative temp path:\n%s", cleanupScript)
	}
	if !strings.Contains(cleanupScript, "Remove-Item -LiteralPath $TempPath") {
		t.Errorf("cleanup script must Remove-Item -LiteralPath $TempPath:\n%s", cleanupScript)
	}
	if strings.Contains(cleanupScript, "*") {
		t.Errorf("cleanup script must not use wildcards:\n%s", cleanupScript)
	}
}

// TestWshFileMetadataSumsRealFile verifies WshFileMetadata produces a stable hex SHA-256
// and size that match an independent io.Copy + sha256 computation. This locks the
// contract the install paths depend on: caller-supplied (size, sha256) must equal
// what BuildWindowsWshInstallScripts will verify inside the install command, even
// though they are computed by two independent code paths.
func TestWshFileMetadataSumsRealFile(t *testing.T) {
	tmp := t.TempDir() + string(os.PathSeparator) + "wsh-fake.bin"
	payload := []byte("the quick brown fox jumps over the lazy dog\n")
	repeats := 4096
	// Build a payload big enough to force a streaming hash, then write it out.
	big := make([]byte, 0, len(payload)*repeats)
	for i := 0; i < repeats; i++ {
		big = append(big, payload...)
	}
	if err := os.WriteFile(tmp, big, 0o644); err != nil {
		t.Fatalf("cannot write temp file: %v", err)
	}
	size, hash, err := WshFileMetadata(tmp)
	if err != nil {
		t.Fatalf("WshFileMetadata failed: %v", err)
	}
	if size != int64(len(big)) {
		t.Fatalf("size mismatch: expected %d, got %d", len(big), size)
	}
	wantSum := sha256.Sum256(big)
	wantHash := fmt.Sprintf("%x", wantSum[:])
	if hash != wantHash {
		t.Fatalf("hash mismatch: WshFileMetadata=%s independent=%s", hash, wantHash)
	}

	// WshFileMetadata must reject a non-regular file (e.g. a directory) so a swap
	// onto a directory path cannot piggyback through the install.
	dirPath := t.TempDir() + string(os.PathSeparator) + "adir"
	if err := os.Mkdir(dirPath, 0o755); err != nil {
		t.Fatalf("cannot make directory: %v", err)
	}
	if _, _, err := WshFileMetadata(dirPath); err == nil {
		t.Fatal("WshFileMetadata must reject a directory")
	}

	// WshFileMetadata must error on a missing path.
	if _, _, err := WshFileMetadata(tmp + ".missing"); err == nil {
		t.Fatal("WshFileMetadata must error on a missing path")
	}
}
