// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
)

// piModelFixtureFresh is the real session shape that makes the card stale:
// the operator switched model AFTER the last assistant reply, so the CURRENT
// model is the model_change target (kimi-k3) while the last assistant message
// still carries the old model (mydeepseek/deepseek-v4.1-flash). The disk
// fallback in LiveSessionState currently reads the last message and therefore
// reports the old model (and writes summary.Source "pi" as the provider).
const piModelFixtureFresh = `{"type":"session","version":3,"id":"pi-live-model-fresh","timestamp":1760640000,"cwd":"/home/user/project"}` + "\n" +
	`{"type":"model_change","id":"mc0","parentId":null,"timestamp":"2026-10-16T06:22:49.555Z","provider":"opencode-go","modelId":"deepseek-v4.1-flash"}` + "\n" +
	`{"type":"message","id":"u1","parentId":"mc0","timestamp":"2026-10-16T06:23:00.000Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}` + "\n" +
	`{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-10-16T06:23:10.000Z","message":{"role":"assistant","model":"deepseek-v4.1-flash","provider":"opencode-go","content":[{"type":"text","text":"hi"}]}}` + "\n" +
	`{"type":"model_change","id":"mcB","parentId":"a1","timestamp":"2026-10-17T09:30:00.000Z","provider":"magpie","modelId":"mydeepseek/deepseek-v4.1-flash"}` + "\n" +
	`{"type":"message","id":"u2","parentId":"mcB","timestamp":"2026-10-17T09:30:10.000Z","message":{"role":"user","content":[{"type":"text","text":"second question"}]}}` + "\n" +
	`{"type":"message","id":"a2","parentId":"u2","timestamp":"2026-10-17T09:31:00.000Z","message":{"role":"assistant","model":"mydeepseek/deepseek-v4.1-flash","provider":"magpie","content":[{"type":"text","text":"second answer"}]}}` + "\n" +
	`{"type":"model_change","id":"mcC","parentId":"a2","timestamp":"2026-10-17T09:35:46.393Z","provider":"httpsllmgoaichattopv1","modelId":"kimi-k3"}` + "\n" +
	`{"type":"message","id":"u3","parentId":"mcC","timestamp":"2026-10-17T09:35:50.000Z","message":{"role":"user","content":[{"type":"text","text":"switched model, no reply yet"}]}}` + "\n"

// setupPiModelFixture isolates the local manager's pi scan root and every index
// file it could read, then writes the fixture session below that root.
func setupPiModelFixture(t *testing.T, sessionID string, content string) string {
	t.Helper()
	base := t.TempDir()
	piDir := filepath.Join(base, "pi-sessions")
	sessionDir := filepath.Join(piDir, "--home-user-project--")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", sessionDir, err)
	}
	path := filepath.Join(sessionDir, sessionID+".jsonl")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", piDir)
	t.Setenv("WAVETERM_AI_SESSIONS_INDEX", filepath.Join(base, "index.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(base, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(base, "index.sqlite"))
	return path
}

// TestLiveSessionStateCurrentModel (G2 red):
//   - the current model must come from the latest model_change on the active
//     branch (kimi-k3), not from the last assistant message;
//   - the provider must be the session-level supplier (httpsllmgoaichattopv1),
//     not the session source "pi".
//
// Today the disk fallback reads the last assistant message (mydeepseek/
// deepseek-v4.1-flash) and writes summary.Source ("pi") into ModelProvider,
// so both assertions fail.
func TestLiveSessionStateCurrentModel(t *testing.T) {
	setupPiModelFixture(t, "pi-live-model-fresh", piModelFixtureFresh)

	resp, err := (&AISessionsService{}).LiveSessionState(context.Background(), &AISessionsLiveSessionStateRequest{
		Source:    "pi",
		SessionID: "pi-live-model-fresh",
	})
	if err != nil {
		t.Fatalf("LiveSessionState: %v", err)
	}
	if resp.ModelProvider == "pi" {
		t.Fatalf("ModelProvider must not be the session source %q (design.md §3.4)", resp.ModelProvider)
	}
	if resp.ModelID != "kimi-k3" {
		t.Fatalf("expected current model kimi-k3 from the latest model_change, got %q", resp.ModelID)
	}
	if resp.ModelProvider != "httpsllmgoaichattopv1" {
		t.Fatalf("expected session-level provider httpsllmgoaichattopv1, got %q", resp.ModelProvider)
	}
}

// countingPiProvider counts LoadMessages calls so the hit path of
// Manager.CurrentModelState can be proven not to fall back to a full load.
type countingPiProvider struct {
	*aisessions.PiProvider
	loadCalls  int32
	stateCalls int32
}

func (c *countingPiProvider) LoadMessages(ctx context.Context, filePath string) ([]aisessions.Message, error) {
	atomic.AddInt32(&c.loadCalls, 1)
	return c.PiProvider.LoadMessages(ctx, filePath)
}

func (c *countingPiProvider) CurrentModelState(ctx context.Context, filePath string) (aisessions.ModelState, bool) {
	atomic.AddInt32(&c.stateCalls, 1)
	return c.PiProvider.CurrentModelState(ctx, filePath)
}

// TestCurrentModelStateDoesNotLoadMessages (G2 red): the current-model hit path
// must answer from the bounded tail read and never call LoadMessages. The
// summary scan warms the index first (its message-count pass may load once),
// then the counter is reset so only the CurrentModelState call is measured.
func TestCurrentModelStateDoesNotLoadMessages(t *testing.T) {
	base := t.TempDir()
	piDir := filepath.Join(base, "pi-sessions")
	sessionDir := filepath.Join(piDir, "--home-user-project--")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	path := filepath.Join(sessionDir, "pi-live-model-fresh.jsonl")
	if err := os.WriteFile(path, []byte(piModelFixtureFresh), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	provider := &countingPiProvider{PiProvider: aisessions.NewPiProvider(piDir)}
	manager := aisessions.NewManagerWithOptions(aisessions.ManagerOptions{
		Providers:  []aisessions.Provider{provider},
		IndexPath:  filepath.Join(base, "index.json"),
		MetaPath:   filepath.Join(base, "meta.json"),
		SQLitePath: filepath.Join(base, "index.sqlite"),
	})

	// Warm-up: resolve the summary once so the scan/index is populated.
	if _, err := manager.Summary(context.Background(), "pi-live-model-fresh", false); err != nil {
		t.Fatalf("warm-up Summary: %v", err)
	}
	atomic.StoreInt32(&provider.loadCalls, 0)

	state, ok := manager.CurrentModelState(context.Background(), "pi-live-model-fresh")
	if !ok {
		t.Fatalf("expected Manager.CurrentModelState ok=true for a pi session")
	}
	if state.Model != "kimi-k3" {
		t.Fatalf("expected current model kimi-k3, got %q", state.Model)
	}
	loads := atomic.LoadInt32(&provider.loadCalls)
	if loads != 0 {
		t.Fatalf("expected 0 LoadMessages calls on the CurrentModelState hit path, got %d", loads)
	}
	fmt.Printf("load_calls=%d/0 PASS\n", loads)
	if atomic.LoadInt32(&provider.stateCalls) == 0 {
		t.Fatalf("expected provider.CurrentModelState to be called")
	}
}
