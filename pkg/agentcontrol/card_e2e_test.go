// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// setupCardSession builds a throwaway codex session so the card read/write path
// runs against the real manager + sqlite index instead of a fake.
func setupCardSession(t *testing.T) (string, *aisessions.Manager) {
	t.Helper()
	dir := t.TempDir()
	wavebase.DataHome_VarCache = filepath.Join(dir, "data")
	wavebase.ConfigHome_VarCache = filepath.Join(dir, "config")
	codexHome := filepath.Join(dir, "codex")
	t.Setenv("CODEX_HOME", codexHome)
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	sessionDir := filepath.Join(codexHome, "sessions")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionID := "agentcontrol-card-session"
	sessionPath := filepath.Join(sessionDir, "rollout-2026-06-16T00-00-00-agentcontrol-card.jsonl")
	content := `{"timestamp":"2026-06-16T00:00:00Z","type":"session_meta","payload":{"id":"` + sessionID + `","cwd":"/tmp/project"}}` + "\n" +
		`{"timestamp":"2026-06-16T00:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":"Initial request"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := aisessions.NewManagerWithOptions(aisessions.ManagerOptions{
		Providers: []aisessions.Provider{aisessions.NewCodexProvider(sessionDir)},
	})
	if _, errs := manager.Index(context.Background()); len(errs) > 0 {
		t.Fatalf("index session: %v", errs[0])
	}
	if _, err := manager.NoteAndTags(context.Background(), sessionID, "old note", []string{"old"}); err != nil {
		t.Fatal(err)
	}
	return sessionID, manager
}

// TestAgentCardEndToEnd exercises the exact path the CLI uses: card get ->
// expected hash -> dry-run -> --yes, including the atomic multi-field write.
func TestAgentCardEndToEnd(t *testing.T) {
	sessionID, _ := setupCardSession(t)
	ctx := context.Background()

	card, err := GetAgentCard(ctx, wshrpc.AgentCardGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if card.Hash == "" {
		t.Fatal("card get must return a hash usable as a precondition")
	}
	if card.Summary == nil || card.Summary.Note != "old note" {
		t.Fatalf("card get did not read the existing note: %#v", card.Summary)
	}

	note := "端到端写入"
	title := "E2E 标题"
	req := wshrpc.AgentCardSetRequest{
		Identifier:   sessionID,
		Note:         &note,
		Title:        &title,
		Tags:         &wshrpc.AgentCardTagPatch{Add: []string{"e2e"}},
		Props:        map[string]wshrpc.AgentCardPropPatch{"priority": {Type: "select", Value: "P0"}},
		ExpectedHash: card.Hash,
		DryRun:       true,
	}
	preview, err := SetAgentCard(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.DryRun || !preview.Changed {
		t.Fatalf("dry-run should report pending changes: %#v", preview)
	}
	unchanged, err := GetAgentCard(ctx, wshrpc.AgentCardGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Hash != card.Hash {
		t.Fatal("dry-run must not change the session card hash")
	}

	req.DryRun = false
	req.Yes = true
	applied, err := SetAgentCard(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if applied.DryRun || !applied.Changed {
		t.Fatalf("apply should report changes: %#v", applied)
	}
	if len(applied.BackupIds) == 0 {
		t.Fatal("a real apply must create a backup")
	}

	final, err := GetAgentCard(ctx, wshrpc.AgentCardGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if final.Title != title || final.TitleSource != "ai" {
		t.Fatalf("title not written as ai: %#v", final)
	}
	if final.Summary.Note != note {
		t.Fatalf("note not written: %#v", final.Summary)
	}
	if !containsString(final.Summary.Tags, "e2e") {
		t.Fatalf("tag not written: %#v", final.Summary.Tags)
	}
	if final.Summary.Props["priority"].Value != "P0" {
		t.Fatalf("prop not written: %#v", final.Summary.Props)
	}
}

// TestAgentCardEndToEndRejectsStaleHash proves a concurrent edit is caught.
func TestAgentCardEndToEndRejectsStaleHash(t *testing.T) {
	sessionID, _ := setupCardSession(t)
	ctx := context.Background()
	card, err := GetAgentCard(ctx, wshrpc.AgentCardGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	userNote := "user changed this"
	if _, err := SetAgentCard(ctx, wshrpc.AgentCardSetRequest{
		Identifier: sessionID, Note: &userNote, ExpectedHash: card.Hash, Yes: true,
	}); err != nil {
		t.Fatal(err)
	}

	staleNote := "agent writes with a stale hash"
	_, err = SetAgentCard(ctx, wshrpc.AgentCardSetRequest{
		Identifier: sessionID, Note: &staleNote, ExpectedHash: card.Hash, Yes: true,
	})
	if err == nil {
		t.Fatal("a stale expectedHash must be refused")
	}
	ctrl, ok := err.(*Error)
	if !ok || ctrl.Code != CodeConflict {
		t.Fatalf("expected E_CONFLICT, got %#v", err)
	}

	final, err := GetAgentCard(ctx, wshrpc.AgentCardGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if final.Summary.Note != userNote {
		t.Fatalf("the refused write must not land: %#v", final.Summary)
	}
}

// TestAgentCardEndToEndProtectsUserTitle covers the title contract through the
// real entry point.
func TestAgentCardEndToEndProtectsUserTitle(t *testing.T) {
	sessionID, manager := setupCardSession(t)
	ctx := context.Background()
	if _, err := manager.SetTitle(ctx, sessionID, "用户标题"); err != nil {
		t.Fatal(err)
	}
	card, err := GetAgentCard(ctx, wshrpc.AgentCardGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	title := "AI 标题"
	_, err = SetAgentCard(ctx, wshrpc.AgentCardSetRequest{
		Identifier: sessionID, Title: &title, ExpectedHash: card.Hash, Yes: true,
	})
	if err == nil {
		t.Fatal("a user-authored title must be protected")
	}
	ctrl, ok := err.(*Error)
	if !ok || ctrl.Code != CodeConflict {
		t.Fatalf("expected E_CONFLICT, got %#v", err)
	}

	if _, err := SetAgentCard(ctx, wshrpc.AgentCardSetRequest{
		Identifier: sessionID, Title: &title, Force: true, ExpectedHash: card.Hash, Yes: true,
	}); err != nil {
		t.Fatal(err)
	}
	final, err := GetAgentCard(ctx, wshrpc.AgentCardGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if final.Title != title || final.TitleSource != "ai" {
		t.Fatalf("forced overwrite must land as ai: %#v", final)
	}
}

// TestAgentCardSetRequiresConfirmation keeps the "no accidental write" rule.
func TestAgentCardSetRequiresConfirmation(t *testing.T) {
	sessionID, _ := setupCardSession(t)
	ctx := context.Background()
	card, err := GetAgentCard(ctx, wshrpc.AgentCardGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	note := "should not land"
	res, err := SetAgentCard(ctx, wshrpc.AgentCardSetRequest{
		Identifier: sessionID, Note: &note, ExpectedHash: card.Hash,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !res.DryRun {
		t.Fatalf("omitting --yes must stay dry-run: %#v", res)
	}
	final, err := GetAgentCard(ctx, wshrpc.AgentCardGetRequest{Identifier: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	if final.Summary.Note == note {
		t.Fatal("a non-confirmed set wrote data")
	}
}

// TestAgentCardSetRequiresPreconditionForRealApply keeps agents from writing
// blind: --yes without a hash must be refused before any write happens.
func TestAgentCardSetRequiresPreconditionForRealApply(t *testing.T) {
	sessionID, _ := setupCardSession(t)
	ctx := context.Background()
	note := "blind write"
	_, err := SetAgentCard(ctx, wshrpc.AgentCardSetRequest{
		Identifier: sessionID, Note: &note, Yes: true,
	})
	if err == nil {
		t.Fatal("a real apply without a precondition must be refused")
	}
	ctrl, ok := err.(*Error)
	if !ok || ctrl.Code != CodeUsage {
		t.Fatalf("expected E_USAGE, got %#v", err)
	}
}

func containsString(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}
