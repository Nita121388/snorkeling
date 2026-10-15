// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/shellexec"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// --- mocks ---------------------------------------------------------------

type mockTerminalController struct{}

func (mockTerminalController) Start(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts, force bool) error {
	return nil
}
func (mockTerminalController) Stop(graceful bool, newStatus string, destroy bool) {}
func (mockTerminalController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	return &BlockControllerRuntimeStatus{BlockId: "block:mock", ShellProcStatus: Status_Running}
}
func (mockTerminalController) GetConnName() string { return "" }
func (mockTerminalController) SendInput(inputUnion *BlockInputUnion) error {
	return nil
}

type mockRedrawController struct {
	mockTerminalController
	redrawCalls int
}

func (m *mockRedrawController) RedrawTUI() error {
	m.redrawCalls++
	return nil
}

// --- RedrawController dispatch --------------------------------------------

func TestRedrawController_NoController(t *testing.T) {
	if err := RedrawController(context.Background(), "block:does-not-exist"); err != nil {
		t.Fatalf("RedrawController with no controller should be a no-op, got error: %v", err)
	}
}

func TestRedrawController_EmptyBlockId(t *testing.T) {
	if err := RedrawController(context.Background(), ""); err != nil {
		t.Fatalf("RedrawController with empty blockId should be a no-op, got error: %v", err)
	}
}

func TestRedrawController_UnsupportedController(t *testing.T) {
	blockId := "block:unsupported"
	registerController(blockId, mockTerminalController{})
	defer deleteController(blockId)
	if err := RedrawController(context.Background(), blockId); err != nil {
		t.Fatalf("RedrawController on a non-redrawable controller should be a no-op, got error: %v", err)
	}
}

func TestRedrawController_DispatcherRoutesToRedrawable(t *testing.T) {
	blockId := "block:redrawable"
	ctrl := &mockRedrawController{}
	registerController(blockId, ctrl)
	defer deleteController(blockId)
	if err := RedrawController(context.Background(), blockId); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ctrl.redrawCalls != 1 {
		t.Fatalf("expected RedrawTUI to be called once, got %d", ctrl.redrawCalls)
	}
}

// --- ShellController.RedrawTUI ---------------------------------------------

func TestShellControllerRedrawTUI_NoProc(t *testing.T) {
	sc := &ShellController{Lock: &sync.Mutex{}}
	if err := sc.RedrawTUI(); err != nil {
		t.Fatalf("RedrawTUI with no ShellProc should be a no-op, got error: %v", err)
	}
	sc.ShellProc = &shellexec.ShellProc{} // Cmd == nil
	if err := sc.RedrawTUI(); err != nil {
		t.Fatalf("RedrawTUI with nil Cmd should be a no-op, got error: %v", err)
	}
}

func TestShellProcPid(t *testing.T) {
	if got := shellProcPid(nil); got != 0 {
		t.Fatalf("expected 0 for nil ShellProc, got %d", got)
	}
	if got := shellProcPid(&shellexec.ShellProc{}); got != 0 {
		t.Fatalf("expected 0 for nil Cmd, got %d", got)
	}
	// CmdWrap with no started process
	wrap := shellexec.MakeCmdWrap(exec.Command("true"), nil, true)
	if got := shellProcPid(&shellexec.ShellProc{Cmd: wrap}); got != 0 {
		t.Fatalf("expected 0 for unstarted process, got %d", got)
	}
}

func TestShellControllerRedrawTUI_SendsSigwinch(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("SIGWINCH not supported on Windows")
	}
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
