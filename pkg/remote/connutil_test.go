// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/pslog"
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

type fakeSFTPFile struct {
	bytes.Buffer
	closeCh    chan struct{}
	closeCount int
}

func (f *fakeSFTPFile) Close() error {
	f.closeCount++
	if f.closeCh != nil {
		select {
		case <-f.closeCh:
		default:
			close(f.closeCh)
		}
	}
	return nil
}

type blockingSFTPFile struct {
	writeStarted chan struct{}
	closed       chan struct{}
	closeCount   int
}

func (f *blockingSFTPFile) Write(_ []byte) (int, error) {
	select {
	case <-f.writeStarted:
	default:
		close(f.writeStarted)
	}
	<-f.closed
	return 0, context.Canceled
}

func (f *blockingSFTPFile) Close() error {
	f.closeCount++
	select {
	case <-f.closed:
	default:
		close(f.closed)
	}
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

func TestMakeWindowsSFTPPathResolvesHome(t *testing.T) {
	got := makeWindowsSFTPPath("/C:/Users/nita", "~/.snorkeling/tmp/wsh-auto/wsh.exe.temp")
	want := "/C:/Users/nita/.snorkeling/tmp/wsh-auto/wsh.exe.temp"
	if got != want {
		t.Fatalf("expected SFTP path %q, got %q", want, got)
	}
}

func TestUploadFileViaSFTPClosesRemoteFileAndReportsFinalProgress(t *testing.T) {
	remoteFile := &fakeSFTPFile{}
	var openedPath string
	var progress []string
	err := uploadFileViaSFTP(
		context.Background(),
		func(path string) (io.WriteCloser, error) {
			openedPath = path
			return remoteFile, nil
		},
		"/C:/Users/nita/.snorkeling/tmp/wsh.exe.temp",
		strings.NewReader("wsh"),
		3,
		func(written, total int64) {
			progress = append(progress, fmt.Sprintf("%d/%d", written, total))
		},
	)
	if err != nil {
		t.Fatalf("expected SFTP upload to succeed, got %v", err)
	}
	if openedPath != "/C:/Users/nita/.snorkeling/tmp/wsh.exe.temp" {
		t.Fatalf("unexpected opened path %q", openedPath)
	}
	if remoteFile.String() != "wsh" {
		t.Fatalf("expected uploaded bytes %q, got %q", "wsh", remoteFile.String())
	}
	if remoteFile.closeCount != 1 {
		t.Fatalf("expected remote file to close once, got %d", remoteFile.closeCount)
	}
	if len(progress) == 0 || progress[len(progress)-1] != "3/3" {
		t.Fatalf("expected final progress 3/3, got %v", progress)
	}
}

func TestUploadFileViaSFTPCancellationClosesRemoteFile(t *testing.T) {
	remoteFile := &blockingSFTPFile{
		writeStarted: make(chan struct{}),
		closed:       make(chan struct{}),
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- uploadFileViaSFTP(
			ctx,
			func(string) (io.WriteCloser, error) { return remoteFile, nil },
			"/C:/Users/nita/.snorkeling/tmp/wsh.exe.temp",
			strings.NewReader("wsh"),
			3,
			nil,
		)
	}()
	<-remoteFile.writeStarted
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected cancellation error, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("SFTP upload did not stop after cancellation")
	}
	if remoteFile.closeCount == 0 {
		t.Fatal("expected cancellation to close the remote file")
	}
}

func TestAppendWshUploadDiagRecordsStageMetadata(t *testing.T) {
	pslog.ResetForTesting()
	logDir := t.TempDir()
	pslog.SetDataDirForTesting(logDir)
	pslog.SetEnabled(true)
	t.Cleanup(func() {
		pslog.SetEnabled(false)
		pslog.ResetForTesting()
	})

	appendWshUploadDiag("session-started", "remote_os", "windows", "bytes", int64(42))
	matches, err := filepath.Glob(filepath.Join(logDir, "pslog-*.log"))
	if err != nil {
		t.Fatalf("glob pslog files: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected one pslog file, got %d", len(matches))
	}
	content, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read pslog file: %v", err)
	}
	text := string(content)
	for _, expected := range []string{
		"[ssh-wsh-upload]",
		"stage=session-started",
		"remote_os=windows",
		"bytes=42",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("expected pslog to contain %q, got %q", expected, text)
		}
	}
}

func TestExtractWshVersionLineSkipsPowerShellNoise(t *testing.T) {
	output := "#< CLIXML\nwsh v0.14.5-beta.4.snorkeling.0.0.42\n"
	if got := extractWshVersionLine(output); got != "wsh v0.14.5-beta.4.snorkeling.0.0.42" {
		t.Fatalf("unexpected version line: %q", got)
	}
}
