// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package blockcontroller

// The SIGWINCH redraw path only exists on unix; the Windows fallback is covered
// by the pty resize-nudge tests in redraw_test.go.

import (
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/shellexec"
)

func TestShellControllerRedrawTUI_SendsSigwinch(t *testing.T) {
	if os.Getenv(redrawTestChildEnv) == "1" {
		runRedrawTestChild()
		return // child exits itself
	}
	marker := filepath.Join(t.TempDir(), "winch-fired")
	readyMarker := filepath.Join(t.TempDir(), "child-ready")
	cmd := exec.Command(os.Args[0], "-test.run=TestShellControllerRedrawTUI_SendsSigwinch")
	cmd.Env = append(os.Environ(), redrawTestChildEnv+"=1", "WAVETERM_REDRAW_MARKER="+marker, "WAVETERM_REDRAW_READY="+readyMarker)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // own process group: never signal the test runner
	if err := cmd.Start(); err != nil {
		t.Fatalf("failed to start helper process: %v", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	// wait for the child to install its SIGWINCH handler before signaling
	if !waitForFile(readyMarker, 3*time.Second) {
		t.Fatalf("helper process never became ready")
	}

	wrap := shellexec.MakeCmdWrap(cmd, nil, true)
	sc := &ShellController{Lock: &sync.Mutex{}, ShellProc: &shellexec.ShellProc{Cmd: wrap}}
	if err := sc.RedrawTUI(); err != nil {
		t.Fatalf("RedrawTUI returned error: %v", err)
	}

	if !waitForFile(marker, 3*time.Second) {
		t.Fatalf("SIGWINCH was not delivered to the process group (marker %q never created)", marker)
	}
}

func waitForFile(path string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false
}

const redrawTestChildEnv = "WAVETERM_REDRAW_TEST_CHILD"

// runRedrawTestChild is the helper-process implementation used by
// TestShellControllerRedrawTUI_SendsSigwinch. It writes a ready marker once its
// SIGWINCH handler is installed, then writes a second marker when the signal
// arrives, and exits. Re-exec-ing the test binary avoids any dependency on an
// external shell/python for signal testing.
func runRedrawTestChild() {
	marker := os.Getenv("WAVETERM_REDRAW_MARKER")
	readyMarker := os.Getenv("WAVETERM_REDRAW_READY")
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGWINCH)
	_ = os.WriteFile(readyMarker, []byte("ready"), 0644)
	<-ch
	_ = os.WriteFile(marker, []byte("winch"), 0644)
	os.Exit(0)
}
