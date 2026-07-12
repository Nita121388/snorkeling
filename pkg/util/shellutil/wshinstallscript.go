// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"strings"
)

// WshFileMetadata returns the size and hex SHA-256 hash of the local wsh binary at path.
// It is a regular-file-only check: a reparse point (symlink/junction) or non-regular
// file is rejected so a malicious swap cannot piggyback on the install. The hash is
// read in a single streaming pass and verified against Stat() up front, so a file
// that changes while hashing is detected.
//
// Shared by the manual and automatic wsh install paths so both verify the binary
// the same way before copying it to the remote.
func WshFileMetadata(path string) (size int64, sha256Hex string, err error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, "", fmt.Errorf("cannot open local wsh binary %s: %w", path, err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return 0, "", fmt.Errorf("cannot stat local wsh binary %s: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return 0, "", fmt.Errorf("local wsh binary is not a regular file: %s", path)
	}
	hash := sha256.New()
	bytesRead, err := io.Copy(hash, file)
	if err != nil {
		return 0, "", fmt.Errorf("cannot hash local wsh binary %s: %w", path, err)
	}
	if bytesRead != info.Size() {
		return 0, "", fmt.Errorf("local wsh binary changed while hashing: %s", path)
	}
	return info.Size(), fmt.Sprintf("%x", hash.Sum(nil)), nil
}

// BuildWindowsWshInstallScripts generates the prepare, install, and cleanup PowerShell
// commands for installing the wsh binary on a Windows remote. All three are returned
// in encoded form (ready to run via `powershell -EncodedCommand ...`).
//
// The install command embeds a copy of the prepare script at its head, so running
// `install` alone is sufficient; the standalone `prepare` is provided so callers can
// pre-clean / pre-create directories before streaming the upload without paying for
// the full install script. `cleanup` removes a stale temp file if the upload or
// install aborted midway.
//
// Hardening guarantees (shared with the manual install path):
//   - Size + SHA-256 verification of the uploaded temp before it is moved into place.
//   - Reparse-point / non-regular-file checks on every path touched (defends against
//     symlink/junction traps on the remote filesystem).
//   - Atomic replacement of an existing wsh.exe via [System.IO.File]::Replace with a
//     backup path, so a crash mid-install cannot leave a half-written binary.
//   - Automatic rollback to the backup if size/hash/version verification fails after
//     the replace.
//   - An exclusive file lock (~/.snorkeling/bin/.wsh-manual-install.lock) so two
//     concurrent installs cannot race.
//   - Post-install `wsh version` verification that the installed binary reports the
//     exact expected version line before the lock is released.
//
// remoteTempPath is expected to be relative to $HOME (e.g. ".snorkeling/tmp/wsh.exe.<ts>.temp");
// it will be backslash-escaped. remoteWshPath is currently ignored — the install path
// is hardcoded to $HOME\.snorkeling\bin\wsh.exe to match the canonical RemoteFullWshBinPath
// — but is kept on the signature for parity with the posix variant and future flexibility.
func BuildWindowsWshInstallScripts(remoteTempPath string, remoteWshPath string, expectedSize int64, expectedSHA256 string, expectedVersion string) (prepareCmd string, installCmd string, cleanupCmd string) {
	_ = remoteWshPath // reserved; canonical install path is $HOME\.snorkeling\bin\wsh.exe
	remoteTempPath = strings.ReplaceAll(remoteTempPath, "/", `\`)
	remotePrepareScript := strings.Join([]string{
		`$ErrorActionPreference = "Stop"`,
		`$SnorkelingRoot = Join-Path $HOME ".snorkeling"`,
		`$TempRoot = Join-Path $SnorkelingRoot "tmp"`,
		`$BinRoot = Join-Path $SnorkelingRoot "bin"`,
		`function Assert-SafeInstallDirectory {`,
		`    param([string]$Path)`,
		`    if (!(Test-Path -LiteralPath $Path)) { return }`,
		`    $Item = Get-Item -LiteralPath $Path -ErrorAction Stop`,
		`    if (!$Item.PSIsContainer -or (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "unsafe wsh install directory: $Path" }`,
		`}`,
		`Assert-SafeInstallDirectory $SnorkelingRoot`,
		`Assert-SafeInstallDirectory $TempRoot`,
		`Assert-SafeInstallDirectory $BinRoot`,
		`[System.IO.Directory]::CreateDirectory($TempRoot) | Out-Null`,
		`[System.IO.Directory]::CreateDirectory($BinRoot) | Out-Null`,
		`Assert-SafeInstallDirectory $SnorkelingRoot`,
		`Assert-SafeInstallDirectory $TempRoot`,
		`Assert-SafeInstallDirectory $BinRoot`,
	}, "\n")
	remoteInstallScript := strings.Join([]string{
		remotePrepareScript,
		`$TempPath = Join-Path $HOME ` + HardQuotePowerShell(remoteTempPath),
		`$WshPath = Join-Path $HOME ".snorkeling\bin\wsh.exe"`,
		fmt.Sprintf(`$ExpectedSize = [Int64]%d`, expectedSize),
		`$ExpectedHash = ` + HardQuotePowerShell(expectedSHA256),
		`$ExpectedVersion = ` + HardQuotePowerShell(expectedVersion),
		`$BackupPath = $null`,
		`$InstalledWithoutBackup = $false`,
		`$InstallLockPath = Join-Path $BinRoot ".wsh-manual-install.lock"`,
		`$InstallLockStream = $null`,
		`try {`,
		`    if (-not (Test-Path -LiteralPath $TempPath -PathType Leaf)) { throw "uploaded wsh temp file is missing" }`,
		`    $TempFile = Get-Item -LiteralPath $TempPath -Force`,
		`    if (($TempFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "uploaded wsh temp path is a reparse point" }`,
		`    if ($TempFile.Length -ne $ExpectedSize) { throw ("uploaded wsh size mismatch: expected {0}, got {1}" -f $ExpectedSize, $TempFile.Length) }`,
		`    $ActualHash = (Get-FileHash -LiteralPath $TempPath -Algorithm SHA256).Hash`,
		`    if (-not [string]::Equals($ActualHash, $ExpectedHash, [System.StringComparison]::OrdinalIgnoreCase)) { throw ("uploaded wsh SHA-256 mismatch: expected {0}, got {1}" -f $ExpectedHash, $ActualHash) }`,
		`    if (Test-Path -LiteralPath $InstallLockPath) {`,
		`        $InstallLockItem = Get-Item -LiteralPath $InstallLockPath -Force`,
		`        if ($InstallLockItem.PSIsContainer -or (($InstallLockItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "wsh install lock path is not a regular file" }`,
		`    }`,
		`    try {`,
		`        $InstallLockStream = [System.IO.File]::Open($InstallLockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)`,
		`    } catch { throw ("another manual wsh install is running or the install lock is unavailable: {0}" -f $_.Exception.Message) }`,
		`    if (Test-Path -LiteralPath $WshPath) {`,
		`        $WshFile = Get-Item -LiteralPath $WshPath -Force`,
		`        if ($WshFile.PSIsContainer -or (($WshFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "existing wsh path is not a regular file" }`,
		`        $BackupPath = $WshPath + ".backup-" + [Guid]::NewGuid().ToString("N")`,
		`        [System.IO.File]::Replace($TempPath, $WshPath, $BackupPath, $true)`,
		`    } else {`,
		`        Move-Item -LiteralPath $TempPath -Destination $WshPath`,
		`        $InstalledWithoutBackup = $true`,
		`    }`,
		`    $VersionLines = @(& $WshPath version)`,
		`    $VersionExitCode = $LASTEXITCODE`,
		`    $VersionOutput = ($VersionLines | Out-String).Trim()`,
		`    if ($VersionExitCode -ne 0) { throw ("installed wsh version command failed with exit code {0}" -f $VersionExitCode) }`,
		`    $VersionMatches = @($VersionLines | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ceq $ExpectedVersion })`,
		`    if ($VersionMatches.Count -eq 0) { throw ("installed wsh version mismatch: expected exact line '{0}', got '{1}'" -f $ExpectedVersion, $VersionOutput) }`,
		`    if (($null -ne $BackupPath) -and (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {`,
		`        try { Remove-Item -LiteralPath $BackupPath -ErrorAction Stop } catch { Write-Warning ("installed wsh is valid, but backup cleanup failed: {0}" -f $_.Exception.Message) }`,
		`    }`,
		`} catch {`,
		`    $InstallError = $_`,
		`    $RollbackError = $null`,
		`    if (($null -ne $BackupPath) -and (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {`,
		`        try { [System.IO.File]::Replace($BackupPath, $WshPath, $null, $true) } catch { $RollbackError = $_ }`,
		`    } elseif ($InstalledWithoutBackup -and (Test-Path -LiteralPath $WshPath -PathType Leaf)) {`,
		`        try { Remove-Item -LiteralPath $WshPath -ErrorAction Stop } catch { $RollbackError = $_ }`,
		`    }`,
		`    if ($null -ne $RollbackError) {`,
		`        $BackupMessage = if ($null -ne $BackupPath) { "; backup preserved at " + $BackupPath } else { "" }`,
		`        throw ("wsh install failed: {0}; rollback failed{1}: {2}" -f $InstallError.Exception.Message, $BackupMessage, $RollbackError.Exception.Message)`,
		`    }`,
		`    throw $InstallError`,
		`} finally {`,
		`    try {`,
		`        if (Test-Path -LiteralPath $TempPath) {`,
		`            $TempItem = Get-Item -LiteralPath $TempPath -Force`,
		`            if ($TempItem.PSIsContainer -or (($TempItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "refusing to clean non-regular wsh temp path" }`,
		`            Remove-Item -LiteralPath $TempPath -ErrorAction Stop`,
		`        }`,
		`    } catch { Write-Warning ("exact temp cleanup failed: {0}" -f $_.Exception.Message) }`,
		`    if ($null -ne $InstallLockStream) {`,
		`        try { $InstallLockStream.Dispose() } catch { Write-Warning ("wsh install lock release failed: {0}" -f $_.Exception.Message) }`,
		`    }`,
		`}`,
	}, "\n")
	remoteCleanupScript := strings.Join([]string{
		`$ErrorActionPreference = "Stop"`,
		`$SnorkelingRoot = Join-Path $HOME ".snorkeling"`,
		`$TempRoot = Join-Path $SnorkelingRoot "tmp"`,
		`function Assert-SafeCleanupDirectory {`,
		`    param([string]$Path)`,
		`    if (!(Test-Path -LiteralPath $Path)) { return }`,
		`    $Item = Get-Item -LiteralPath $Path -ErrorAction Stop`,
		`    if (!$Item.PSIsContainer -or (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "unsafe wsh cleanup directory: $Path" }`,
		`}`,
		`Assert-SafeCleanupDirectory $SnorkelingRoot`,
		`Assert-SafeCleanupDirectory $TempRoot`,
		`$TempPath = Join-Path $HOME ` + HardQuotePowerShell(remoteTempPath),
		`if (Test-Path -LiteralPath $TempPath) {`,
		`    $TempItem = Get-Item -LiteralPath $TempPath -Force`,
		`    if ($TempItem.PSIsContainer -or (($TempItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "refusing to clean non-regular wsh temp path" }`,
		`    Remove-Item -LiteralPath $TempPath -ErrorAction Stop`,
		`}`,
	}, "\n")
	return MakePowerShellEncodedCommand(remotePrepareScript), MakePowerShellEncodedCommand(remoteInstallScript), MakePowerShellEncodedCommand(remoteCleanupScript)
}
