// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/genconn"
)

type fakePlatformShell struct {
	commands []string
}

func (s *fakePlatformShell) MakeProcessController(cmd genconn.CommandSpec) (genconn.ShellProcessController, error) {
	s.commands = append(s.commands, cmd.Cmd)
	switch len(s.commands) {
	case 1:
		return &fakePlatformProcess{
			stdout: "'uname' " + string([]byte{0xb2, 0xbb, 0xca, 0xc7}),
			err:    errors.New("exit status 1"),
		}, nil
	case 2:
		return &fakePlatformProcess{stdout: "windows x64\n"}, nil
	default:
		return nil, errors.New("unexpected command")
	}
}

type fakePlatformProcess struct {
	stdout string
	stderr string
	err    error
}

func (p *fakePlatformProcess) Start() error {
	return nil
}

func (p *fakePlatformProcess) Wait() error {
	return p.err
}

func (p *fakePlatformProcess) Kill() {
}

func (p *fakePlatformProcess) StdinPipe() (io.WriteCloser, error) {
	return nopWriteCloser{bytes.NewBuffer(nil)}, nil
}

func (p *fakePlatformProcess) StdoutPipe() (io.Reader, error) {
	return strings.NewReader(p.stdout), nil
}

func (p *fakePlatformProcess) StderrPipe() (io.Reader, error) {
	return strings.NewReader(p.stderr), nil
}

type nopWriteCloser struct {
	*bytes.Buffer
}

func (w nopWriteCloser) Close() error {
	return nil
}

func TestGetClientPlatformFromOsArchStrNormalizesWindowsUname(t *testing.T) {
	clientOs, clientArch, err := GetClientPlatformFromOsArchStr(context.Background(), "MINGW64_NT-10.0-26200 x86_64")
	if err != nil {
		t.Fatalf("GetClientPlatformFromOsArchStr returned error: %v", err)
	}
	if clientOs != "windows" || clientArch != "x64" {
		t.Fatalf("expected windows/x64, got %s/%s", clientOs, clientArch)
	}
}

func TestGetClientPlatformFallsBackForWindowsCmdShell(t *testing.T) {
	shell := &fakePlatformShell{}
	clientOs, clientArch, err := GetClientPlatform(context.Background(), shell)
	if err != nil {
		t.Fatalf("GetClientPlatform returned error: %v", err)
	}
	if clientOs != "windows" || clientArch != "x64" {
		t.Fatalf("expected windows/x64, got %s/%s", clientOs, clientArch)
	}
	if len(shell.commands) != 2 || !strings.Contains(shell.commands[1], "-EncodedCommand") {
		t.Fatalf("expected encoded powershell fallback command, got %#v", shell.commands)
	}
}

func TestGetRemoteWshPathUsesExeForWindows(t *testing.T) {
	if path := GetRemoteWshPath("windows"); path != "~/.snorkeling/bin/wsh.exe" {
		t.Fatalf("expected windows remote wsh path to use .exe, got %q", path)
	}
}

func TestGetRemoteWshTempPathUsesTmpDirForWindows(t *testing.T) {
	path := getRemoteWshTempPath("windows", "~/.snorkeling/bin/wsh.exe")
	if !strings.HasPrefix(path, "~/.snorkeling/tmp/wsh-auto/wsh.exe.") {
		t.Fatalf("expected windows remote temp path under ~/.snorkeling/tmp/wsh-auto, got %q", path)
	}
	name := strings.TrimPrefix(path, "~/.snorkeling/tmp/wsh-auto/")
	if !regexp.MustCompile(windowsWshAutoTempNamePattern).MatchString(name) {
		t.Fatalf("expected strict windows auto temp name, got %q", name)
	}
}

func TestWindowsWshAutoTempNamePatternHasStrictOwnershipBoundary(t *testing.T) {
	pattern := regexp.MustCompile(windowsWshAutoTempNamePattern)
	valid := []string{
		"wsh.exe.1720699200000000000.0.temp",
		"wsh.exe.1720699200000000000.9223372036854775807.temp",
	}
	for _, name := range valid {
		if !pattern.MatchString(name) {
			t.Errorf("expected auto temp name to match: %q", name)
		}
	}
	invalid := []string{
		"snorkeling-wsh-0.0.48-windows-x64.manual.tmp",
		"wsh.exe.172069920000000000.1.temp",
		"wsh.exe.1720699200000000000.-1.temp",
		"wsh.exe.1720699200000000000.1.temp.backup",
		"prefix-wsh.exe.1720699200000000000.1.temp",
		`..\wsh.exe.1720699200000000000.1.temp`,
	}
	for _, name := range invalid {
		if pattern.MatchString(name) {
			t.Errorf("expected non-auto temp name not to match: %q", name)
		}
	}
}

func TestWindowsWshQuarantineNamePatternHasStrictOwnershipBoundary(t *testing.T) {
	pattern := regexp.MustCompile(windowsWshQuarantineNamePattern)
	valid := "wsh.exe.1720699200000000000.1.temp.quarantine.638878916960000000"
	if !pattern.MatchString(valid) {
		t.Fatalf("expected quarantine name to match: %q", valid)
	}
	invalid := []string{
		"wsh.exe.1720699200000000000.1.temp",
		"wsh.exe.1720699200000000000.1.temp.quarantine.63887891696000000",
		"snorkeling-wsh-0.0.48-windows-x64.tmp.quarantine.638878916960000000",
		"wsh.exe.1720699200000000000.1.temp.quarantine.638878916960000000.backup",
	}
	for _, name := range invalid {
		if pattern.MatchString(name) {
			t.Errorf("expected non-quarantine name not to match: %q", name)
		}
	}
}

func TestMakeWindowsWshTempCleanupScriptIsBoundedAndExact(t *testing.T) {
	now := time.Date(2026, time.July, 11, 12, 34, 56, 0, time.UTC)
	script := makeWindowsWshTempCleanupScript(now)
	for _, expected := range []string{
		"2026-07-11T12:34:56Z",
		"2026-07-10T12:34:56Z",
		"2026-07-04T12:34:56Z",
		`$MaxProcessed = 20`,
		`$SnorkelingRoot = Join-Path $HOME ".snorkeling"`,
		`Assert-SafeCleanupRoot $SnorkelingRoot`,
		`Join-Path $TempRoot "wsh-auto"`,
		`Join-Path $TempRoot "wsh-quarantine"`,
		`foreach ($RootPath in @($TempRoot, $AutoRoot))`,
		`$Item -is [System.IO.FileInfo]`,
		`[System.IO.FileAttributes]::ReparsePoint`,
		`[System.IO.FileShare]::None`,
		`Move-Item -LiteralPath $Item.FullName -Destination $Destination`,
		`Remove-Item -LiteralPath $Item.FullName`,
	} {
		if !strings.Contains(script, expected) {
			t.Errorf("expected cleanup script to contain %q", expected)
		}
	}
	for _, forbidden := range []string{
		`.snorkeling\bin`,
		`-Force`,
		`-Recurse`,
		`Remove-Item -Path`,
	} {
		if strings.Contains(script, forbidden) {
			t.Errorf("cleanup script must not contain %q", forbidden)
		}
	}
	for _, line := range strings.Split(script, "\n") {
		if !strings.Contains(line, "Remove-Item") {
			continue
		}
		if strings.ContainsAny(line, "*?") {
			t.Errorf("Remove-Item must not use wildcards: %q", line)
		}
		if !strings.Contains(line, "-LiteralPath") {
			t.Errorf("Remove-Item must use an exact literal path: %q", line)
		}
	}
}

func TestWindowsAutoInstallRequiresManualSentinel(t *testing.T) {
	wrapped := fmt.Errorf("wsh install failed: %w", ErrWindowsAutoWshInstallRequiresManual)
	if !errors.Is(wrapped, ErrWindowsAutoWshInstallRequiresManual) {
		t.Fatal("expected wrapped windows manual-required error to retain its classification")
	}
	if errors.Is(errors.New(ErrWindowsAutoWshInstallRequiresManual.Error()), ErrWindowsAutoWshInstallRequiresManual) {
		t.Fatal("errors with only the same message must not be classified as manual-required")
	}
	if !strings.Contains(ErrWindowsAutoWshInstallRequiresManual.Error(), "manual install required") {
		t.Fatalf("expected manual install guidance, got %q", ErrWindowsAutoWshInstallRequiresManual)
	}
}

func TestMakeWindowsStreamToTempCommandUsesEncodedPowerShell(t *testing.T) {
	cmd := makeWindowsStreamToTempCommand("~/.snorkeling/tmp/wsh.exe.tmp")
	if !strings.Contains(cmd, "powershell -NoProfile -NonInteractive") {
		t.Fatalf("expected windows stream-to-temp command to use powershell")
	}
	if !strings.Contains(cmd, "-EncodedCommand") {
		t.Fatalf("expected windows stream-to-temp command to be encoded")
	}
	// The raw PowerShell (CopyTo, OpenStandardInput, FileShare::None) must not appear
	// verbatim in the command — it should be base64-encoded inside -EncodedCommand.
	for _, forbidden := range []string{"CopyTo", "OpenStandardInput", "FileShare"} {
		if strings.Contains(cmd, forbidden) {
			t.Fatalf("expected raw stream script to be encoded, but found %q", forbidden)
		}
	}
}

func TestExtractWshVersionLineSkipsPowerShellNoise(t *testing.T) {
	output := "#< CLIXML\nwsh v0.14.5-beta.4.snorkeling.0.0.42\n"
	if got := extractWshVersionLine(output); got != "wsh v0.14.5-beta.4.snorkeling.0.0.42" {
		t.Fatalf("unexpected version line: %q", got)
	}
}
