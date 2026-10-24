// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"io"
	"os/exec"
	"sync"
	"testing"
	"time"

	"github.com/creack/pty"
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

// --- pty resize nudge fallback ---------------------------------------------

// mockPtyConn implements shellexec.ConnInterface and records every SetSize call
// so the resize-nudge fallback can be asserted without a real pty.
type mockPtyConn struct {
	pty.Pty // nil: only SetSize is exercised in these tests

	sizes [][2]int
	err   error
}

func (m *mockPtyConn) Kill()                              {}
func (m *mockPtyConn) KillGraceful(time.Duration)         {}
func (m *mockPtyConn) Wait() error                        { return nil }
func (m *mockPtyConn) Start() error                       { return nil }
func (m *mockPtyConn) ExitCode() int                      { return 0 }
func (m *mockPtyConn) ExitSignal() string                 { return "" }
func (m *mockPtyConn) StdinPipe() (io.WriteCloser, error) { return nil, nil }
func (m *mockPtyConn) StdoutPipe() (io.ReadCloser, error) { return nil, nil }
func (m *mockPtyConn) StderrPipe() (io.ReadCloser, error) { return nil, nil }
func (m *mockPtyConn) SetSize(w int, h int) error {
	m.sizes = append(m.sizes, [2]int{w, h})
	return m.err
}

func withNoNudgeDelay(t *testing.T) {
	t.Helper()
	prev := redrawNudgeDelay
	redrawNudgeDelay = 0
	t.Cleanup(func() { redrawNudgeDelay = prev })
}

func TestNudgePtySize_ResizesThenRestores(t *testing.T) {
	withNoNudgeDelay(t)
	conn := &mockPtyConn{}
	sp := &shellexec.ShellProc{Cmd: conn}

	nudgePtySize(sp, 30, 100)

	if len(conn.sizes) != 2 {
		t.Fatalf("expected 2 SetSize calls (nudge + restore), got %d: %v", len(conn.sizes), conn.sizes)
	}
	if conn.sizes[0] != [2]int{31, 100} {
		t.Fatalf("expected nudge to 31x100, got %v", conn.sizes[0])
	}
	if conn.sizes[1] != [2]int{30, 100} {
		t.Fatalf("expected restore to 30x100, got %v", conn.sizes[1])
	}
}

func TestNudgePtySize_SkipsWhenNoSizeOrNoProc(t *testing.T) {
	withNoNudgeDelay(t)
	conn := &mockPtyConn{}
	nudgePtySize(nil, 30, 100)
	nudgePtySize(&shellexec.ShellProc{}, 30, 100)
	nudgePtySize(&shellexec.ShellProc{Cmd: conn}, 0, 100)
	nudgePtySize(&shellexec.ShellProc{Cmd: conn}, 30, 0)
	if len(conn.sizes) != 0 {
		t.Fatalf("expected no SetSize calls, got %v", conn.sizes)
	}
}

func TestNudgePtySize_NudgeErrorDoesNotRestore(t *testing.T) {
	withNoNudgeDelay(t)
	conn := &mockPtyConn{err: io.ErrClosedPipe}
	nudgePtySize(&shellexec.ShellProc{Cmd: conn}, 24, 80)
	if len(conn.sizes) != 1 {
		t.Fatalf("expected a single failed SetSize attempt, got %v", conn.sizes)
	}
}
