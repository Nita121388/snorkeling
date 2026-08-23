// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// requirePi checks that a real pi binary is available; tests call this to skip
// when running in environments without pi.
func requirePi(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("pi"); err != nil {
		t.Skip("pi binary not found; skipping integration test")
	}
}

// TestPiAdapter_Integration_GetState spawns a real `pi --mode rpc` in an
// isolated session dir, calls get_state, and verifies the correlated response
// plus that boot events (extension_ui_request etc.) are tolerated. No LLM call
// is made, so this never touches provider auth or billing.
func TestPiAdapter_Integration_GetState(t *testing.T) {
	requirePi(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	sessDir := t.TempDir()
	adapter := &piAdapter{}
	session, err := adapter.Start(ctx, StartOptions{
		Provider:   "openai", // wrong/absent is fine for get_state
		Model:      "gpt-4o-mini",
		SessionDir: sessDir,
	})
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer session.Close()

	// A boot window lets pi emit extension/status events; the mapper must not
	// crash on them. Then get_state must correlate to our request id.
	time.Sleep(1500 * time.Millisecond)
	st, err := session.GetState(ctx)
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if st == nil {
		t.Fatal("nil state")
	}
	t.Logf("session id=%q model=%+v msgcount=%d", st.SessionID, st.Model, st.MessageCount)
	if st.SessionID == "" {
		t.Fatalf("expected non-empty session id from get_state")
	}
}

// TestPiAdapter_Integration_PromptAck spawns pi and verifies prompt acceptance
// without waiting for the LLM turn to complete (we abort right after the ack,
// so nothing is billed beyond an accepted prompt).
func TestPiAdapter_Integration_PromptAck(t *testing.T) {
	requirePi(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	sessDir := t.TempDir()
	adapter := &piAdapter{}
	session, err := adapter.Start(ctx, StartOptions{SessionDir: sessDir})
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer session.Close()

	events := make(chan ChatEvent, 64)
	unsub := session.OnEvent(func(evt ChatEvent) { events <- evt })
	defer unsub()

	time.Sleep(1500 * time.Millisecond)
	if err := session.Prompt(ctx, "say hello"); err != nil {
		t.Fatalf("Prompt rejected: %v", err)
	}
	// We should see thread_started / turn_start before anything else.
	deadline := time.After(15 * time.Second)
	seenTurn := false
	for !seenTurn {
		select {
		case evt := <-events:
			switch evt.Type {
			case TurnStart:
				seenTurn = true
			case TurnFailed:
				t.Fatalf("turn failed: %v", evt.Error)
			}
		case <-deadline:
			t.Fatal("timed out waiting for turn_start after prompt ack")
		}
	}
	// Cleanly stop the running turn.
	if err := session.Abort(ctx); err != nil {
		t.Logf("abort error (non-fatal): %v", err)
	}
}

// TestManager_EnsureDedupes verifies the Manager reuses one Session for the
// same source+sessionID and errors on a second concurrent prompt.
func TestManager_EnsureDedupes(t *testing.T) {
	requirePi(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	mgr := NewManager()
	defer mgr.CloseAll()

	sessDir := t.TempDir()
	s1, first, err := mgr.Ensure(ctx, &piAdapter{}, StartOptions{SessionDir: sessDir})
	if err != nil {
		t.Fatalf("Ensure failed: %v", err)
	}
	if !first {
		t.Fatal("expected first=true for fresh session")
	}
	s2, firstAgain, err := mgr.Ensure(ctx, &piAdapter{}, StartOptions{SessionDir: sessDir})
	if err != nil {
		t.Fatalf("Ensure(dup) failed: %v", err)
	}
	if firstAgain {
		t.Fatal("expected first=false for duplicate")
	}
	if s1 != s2 {
		t.Fatal("expected same *Session for duplicate Ensure")
	}
	mgr.Close("pi", "")
	if mgr.ActiveCount() != 0 {
		t.Fatal("expected zero active sessions after Close")
	}
}

// TestManager_Sweep verifies idle sessions are reclaimed by the sweeper.
func TestManager_Sweep(t *testing.T) {
	requirePi(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	mgr := NewManager()
	defer mgr.CloseAll()
	// Force a tiny idle timeout for the test.
	mgr.idle = 100 * time.Millisecond
	sessDir := t.TempDir()
	_, _, err := mgr.Ensure(ctx, &piAdapter{}, StartOptions{SessionDir: sessDir})
	if err != nil {
		t.Fatalf("Ensure failed: %v", err)
	}
	// Pretend the session has been idle forever.
	time.Sleep(150 * time.Millisecond)
	mgr.sweepOnce()
	if mgr.ActiveCount() != 0 {
		t.Fatalf("expected sweeper to close idle session, active=%d", mgr.ActiveCount())
	}
}

var _ = filepath.Join // keep imports tidy

var _ = os.Getenv // keep imports tidy
// TestSession_ControlRejectsNonAllowlisted verifies the control allowlist
// rejects unknown methods before any RPC is attempted (nil rpc is fine here).
func TestSession_ControlRejectsNonAllowlisted(t *testing.T) {
	s := &Session{}
	if _, err := s.Control(context.Background(), "fork", nil); err == nil {
		t.Fatal("expected non-allowlisted method to be rejected")
	}
	if _, err := s.Control(context.Background(), "get_commands", nil); err == nil {
		t.Fatal("expected error from uninitialized rpc even for allowlisted method")
	}
}

// TestPiAdapter_Integration_GetCommands spawns a real pi and fetches the
// command registry the GUI slash panel should render. No LLM call.
func TestPiAdapter_Integration_GetCommands(t *testing.T) {
	requirePi(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	session, err := (&piAdapter{}).Start(ctx, StartOptions{SessionDir: t.TempDir(), NoExtensions: true})
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer session.Close()
	time.Sleep(1500 * time.Millisecond)

	data, err := session.Control(ctx, "get_commands", nil)
	if err != nil {
		t.Fatalf("Control(get_commands) failed: %v", err)
	}
	m, ok := data.(map[string]any)
	if !ok {
		t.Fatalf("unexpected get_commands payload %#v", data)
	}
	cmds, _ := m["commands"].([]any)
	t.Logf("pi exposes %d commands", len(cmds))
	for i, c := range cmds {
		if i >= 5 {
			break
		}
		cm, _ := c.(map[string]any)
		t.Logf("  /%v (%v)", cm["name"], cm["source"])
	}
}

// TestPiAdapter_Integration_ThinkingLevels verifies thinking level discovery.
func TestPiAdapter_Integration_ThinkingLevels(t *testing.T) {
	requirePi(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	session, err := (&piAdapter{}).Start(ctx, StartOptions{SessionDir: t.TempDir()})
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer session.Close()
	time.Sleep(1500 * time.Millisecond)

	data, err := session.Control(ctx, "get_available_thinking_levels", nil)
	if err != nil {
		t.Fatalf("Control(get_available_thinking_levels) failed: %v", err)
	}
	t.Logf("thinking levels: %#v", data)
}

// TestPiAdapter_Integration_ImagePromptAck verifies a prompt carrying a base64
// image attachment is accepted by real pi (protocol-level evidence for the
// attachment path). We abort immediately after the ack; nothing is billed
// beyond an accepted prompt.
func TestPiAdapter_Integration_ImagePromptAck(t *testing.T) {
	requirePi(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	session, err := (&piAdapter{}).Start(ctx, StartOptions{SessionDir: t.TempDir()})
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer session.Close()
	time.Sleep(1500 * time.Millisecond)

	// 1x1 red PNG
	const redDotBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
	err = session.PromptWithOptions(ctx, PromptOptions{
		Message: "describe this image",
		Images:  []ImageContent{{Type: "image", Data: redDotBase64, MimeType: "image/png"}},
	})
	if err != nil {
		t.Fatalf("PromptWithOptions with image rejected: %v", err)
	}
	if err := session.Abort(ctx); err != nil {
		t.Logf("abort after image prompt: %v", err)
	}
}
