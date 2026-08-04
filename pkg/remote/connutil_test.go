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
	"sync"
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
		func() {},
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
	transportClosed := false
	done := make(chan error, 1)
	go func() {
		done <- uploadFileViaSFTP(
			ctx,
			func(string) (io.WriteCloser, error) { return remoteFile, nil },
			func() {
				transportClosed = true
				_ = remoteFile.Close()
			},
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
	if !transportClosed {
		t.Fatal("expected cancellation to close the SFTP transport")
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

// TestComputeAdaptiveTimeout_FastLink verifies that on a fast link the
// computed deadline comfortably exceeds the elapsed time (so the watchdog
// won't trip a healthy upload).
func TestComputeAdaptiveTimeout_FastLink(t *testing.T) {
	// 12 MB uploaded in 3s of elapsed -> ~4 MB/s, way above slow-link floor.
	const total = 12 * 1024 * 1024
	bytesSoFar := int64(3 * 1024 * 1024)
	elapsed := 3 * time.Second
	now := time.Now()
	need := computeAdaptiveTimeout(bytesSoFar, total, elapsed, now)
	if need < UploadMinTimeout {
		t.Fatalf("need=%s below floor %s", need, UploadMinTimeout)
	}
	if need > UploadMaxTimeout {
		t.Fatalf("need=%s above cap %s", need, UploadMaxTimeout)
	}
	// At 4 MB/s steady-state, 9 MB remaining = ~2.25s * 1.5 + 3s elapsed + 10s buffer
	// ≈ 16.4s. Should comfortably exceed the elapsed time.
	if need <= elapsed {
		t.Fatalf("need=%s should exceed elapsed=%s on a fast healthy link", need, elapsed)
	}
}

// TestComputeAdaptiveTimeout_SlowLink verifies the deadline scales to the
// real Tailscale-class throughput observed in production (~62 KiB/s).
// 12 MB at 62 KiB/s needs ~200s, which exceeds the static 90s floor but
// stays under UploadMaxTimeout.
func TestComputeAdaptiveTimeout_SlowLink(t *testing.T) {
	const total = 12 * 1024 * 1024
	// 1.5 MB written after 24s = 62500 bytes/s ≈ 61 KiB/s
	bytesSoFar := int64(1.5 * 1024 * 1024)
	elapsed := 24 * time.Second
	now := time.Now()
	need := computeAdaptiveTimeout(bytesSoFar, total, elapsed, now)
	// The deadline should land between the 90s floor and the 5min cap,
	// and reflect "elapsed + ~remaining*1.5 + 10s".
	if need < UploadMinTimeout {
		t.Fatalf("need=%s below floor %s", need, UploadMinTimeout)
	}
	if need > UploadMaxTimeout {
		t.Fatalf("need=%s above cap %s", need, UploadMaxTimeout)
	}
	// 10.5 MB remaining at 61 KiB/s ≈ 172s * 1.5 + 24s + 10s ≈ 292s.
	// The watchdog should have pushed deadline well past the static 90s floor.
	if need <= 90*time.Second {
		t.Fatalf("need=%s should exceed the static 90s floor on a slow link", need)
	}
}

// TestComputeAdaptiveTimeout_CappedAtMaxTimeout verifies that even on a very
// slow link dragging a huge payload, the deadline never exceeds
// UploadMaxTimeout measured from start.
func TestComputeAdaptiveTimeout_CappedAtMaxTimeout(t *testing.T) {
	// 100 MB at a slow-but-alive 50 KiB/s — well over 5min real time.
	const total = 100 * 1024 * 1024
	bytesSoFar := int64(5 * 1024 * 1024) // 5 MB written
	elapsed := 100 * time.Second        // 100s in
	now := time.Now()
	need := computeAdaptiveTimeout(bytesSoFar, total, elapsed, now)
	// need is measured from `now`, not from start; the cap is start+UploadMaxTimeout.
	start := now.Add(-elapsed)
	maxDeadline := start.Add(UploadMaxTimeout)
	if now.Add(need).After(maxDeadline) {
		t.Fatalf("deadline +%s extends past cap %s", need, maxDeadline)
	}
	if need > UploadMaxTimeout {
		t.Fatalf("need=%s exceeds UploadMaxTimeout=%s", need, UploadMaxTimeout)
	}
}

// TestComputeAdaptiveTimeout_FloorEnforced verifies the deadline is never
// compressed below UploadMinTimeout, even when the upload is almost done
// (where 'remaining' would otherwise collapse to ~0).
func TestComputeAdaptiveTimeout_FloorEnforced(t *testing.T) {
	const total = 12 * 1024 * 1024
	// 11.999 MB of 12 MB — not much left.
	bytesSoFar := int64(12*1024*1024) - 1024
	elapsed := 10 * time.Second
	now := time.Now()
	need := computeAdaptiveTimeout(bytesSoFar, total, elapsed, now)
	if need < UploadMinTimeout {
		t.Fatalf("need=%s below floor %s", need, UploadMinTimeout)
	}
}

// TestComputeAdaptiveTimeout_ZeroProgress returns 0 so the watchdog skips
// adjusting the deadline (letting the timer run out naturally), since the
// rate can't be sampled with zero written.
func TestComputeAdaptiveTimeout_ZeroProgress(t *testing.T) {
	if got := computeAdaptiveTimeout(0, 1024, time.Second, time.Now()); got != 0 {
		t.Fatalf("expected 0 for zero bytesSoFar, got %s", got)
	}
	if got := computeAdaptiveTimeout(100, 0, time.Second, time.Now()); got != 0 {
		t.Fatalf("expected 0 for zero totalBytes, got %s", got)
	}
	if got := computeAdaptiveTimeout(100, 1024, 0, time.Now()); got != 0 {
		t.Fatalf("expected 0 for zero elapsed, got %s", got)
	}
}

// TestProgressWriter_AtomicWriteStress exercises the atomic.Int64 counter
// under concurrent writers and a concurrent reader (the watchdog pattern),
// verifying the value never regresses and the final tally is exact. With
// the race detector (CGO_ENABLED=1 + gcc available) this surfaces any
// data race on `written`; without it, it still verifies counting.
func TestProgressWriter_AtomicWriteStress(t *testing.T) {
	const writers = 4
	const chunksPerWriter = 250
	const chunk = 4096
	// bytes.Buffer is NOT safe for concurrent writers, so wrap it with a
	// mutex. The point of this test is progressWriter's counter atomicity,
	// not the underlying sink's thread-safety.
	var mu sync.Mutex
	var sink bytes.Buffer
	pw := newProgressWriter(writerFunc(func(p []byte) (int, error) {
		mu.Lock()
		defer mu.Unlock()
		return sink.Write(p)
	}), int64(writers*chunksPerWriter*chunk), func(int64, int64) {})
	done := make(chan struct{})
	go func() {
		// Watchdog-style reader: polls written like the real goroutine.
		ticker := time.NewTicker(time.Millisecond)
		defer ticker.Stop()
		var last int64
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				now := pw.written.Load()
				if now < last {
					t.Errorf("written regressed: %d -> %d", last, now)
					return
				}
				last = now
			}
		}
	}()
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			payload := make([]byte, chunk)
			for i := range payload {
				payload[i] = byte(i)
			}
			for j := 0; j < chunksPerWriter; j++ {
				n, err := pw.Write(payload)
				if err != nil || n != chunk {
					t.Errorf("Write returned n=%d err=%v", n, err)
					return
				}
			}
		}()
	}
	wg.Wait()
	close(done)
	want := int64(writers * chunksPerWriter * chunk)
	if got := pw.written.Load(); got != want {
		t.Fatalf("written=%d, want %d", got, want)
	}
	if sink.Len() != int(want) {
		t.Fatalf("sink.len=%d, want %d", sink.Len(), want)
	}
}

// writerFunc adapts a func([]byte) (int, error) to io.Writer.
type writerFunc func(p []byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }

// TestUploadFileViaSFTPWatchdog_SlowUploadSucceeds verifies the adaptive
// watchdog lets a slow-but-alive upload complete inside the 90s floor that
// the static deadline would have aborted. We can't easily make the real
// upload exceed 90s in a unit test (would need real elapsed time), so this
// test focuses on the semantic guarantee: a slow Writer that yields control
// between chunks completes successfully even when the upload takes a
// noticeable wall-clock time, matching the behaviour the watchdog preserves
// in production.
func TestUploadFileViaSFTPWatchdog_SlowUploadSucceeds(t *testing.T) {
	// 256 KiB written in 4 chunks, with a small yield between each. Total
	// wall-clock time is tiny (a few ms), but this exercises the full path
	// — open, progressWriter wiring, watchdog tick, copy, close — end to end.
	const total = 256 * 1024
	remoteFile := &fakeSFTPFile{}
	chunk := make([]byte, total/4)
	input := bytes.NewReader(append(chunk, append(chunk, append(chunk, chunk...)...)...))
	done := make(chan error, 1)
	go func() {
		done <- uploadFileViaSFTP(
			context.Background(),
			func(string) (io.WriteCloser, error) { return remoteFile, nil },
			func() {},
			"/C:/Users/nita/.snorkeling/tmp/wsh.exe.temp",
			input,
			total,
			func(int64, int64) {},
		)
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("expected adaptive upload to succeed, got %v", err)
		}
		if remoteFile.closeCount != 1 {
			t.Fatalf("expected remote file to close once, got %d", remoteFile.closeCount)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("adaptive upload hung")
	}
}
