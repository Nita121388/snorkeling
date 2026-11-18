// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentdata"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// setupAnnotateManager builds a throwaway pi session with stable ItemKeys,
// which is what node annotations anchor to.
func setupAnnotateManager(t *testing.T) (*aisessions.Manager, string) {
	t.Helper()
	dir := t.TempDir()
	piDir := filepath.Join(dir, "pi-sessions")
	if err := os.MkdirAll(piDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionID := "pi-annotate-acs"
	content := `{"type":"session","version":3,"id":"` + sessionID + `","timestamp":1700000000,"cwd":"/tmp/project"}` + "\n" +
		`{"type":"message","id":"msg-1","parentId":"","role":"user","content":"Initial request"}` + "\n" +
		`{"type":"message","id":"msg-2","parentId":"msg-1","role":"assistant","content":[{"type":"text","text":"All done"}]}` + "\n"
	if err := os.WriteFile(filepath.Join(piDir, "pi-annotate-acs.jsonl"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := aisessions.NewManagerWithOptions(aisessions.ManagerOptions{
		Providers:  []aisessions.Provider{aisessions.NewPiProvider(piDir)},
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
	if _, errs := manager.Index(context.Background()); len(errs) > 0 {
		t.Fatalf("index session: %v", errs[0])
	}
	return manager, sessionID
}

func annotateRowCount(t *testing.T, manager *aisessions.Manager, sessionID string) int {
	t.Helper()
	summary, err := manager.Summary(context.Background(), sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := manager.ListAnnotations(context.Background(), summary.Key)
	if err != nil {
		t.Fatal(err)
	}
	return len(rows)
}

// AC5 / error mapping: every refusal gets a stable code agents branch on.
func TestAnnotateErrorCodes(t *testing.T) {
	cases := []struct {
		err  error
		code string
	}{
		{aisessions.ErrAnnotationHashMismatch, CodeConflict},
		{aisessions.ErrAnnotationHashRequired, CodeUsage},
		{aisessions.ErrAnnotationProtected, CodeConflict},
		{aisessions.ErrAnnotationStatusNeedsForce, CodeUsage},
		{aisessions.ErrAnnotationStatusInvalid, CodeUsage},
		{aisessions.ErrAnnotationAnchorNotFound, CodeNotFound},
		{os.ErrNotExist, CodeInternal},
	}
	for _, tc := range cases {
		if got := codeOf(t, annotateError(tc.err)); got != tc.code {
			t.Fatalf("annotateError(%v) = %q, want %q", tc.err, got, tc.code)
		}
	}
	if annotateError(nil) != nil {
		t.Fatal("nil error must stay nil")
	}
}

// The ACS assembly: dry-run writes nothing, a real write needs the hash, the
// same anchor replaces instead of stacking, and a bad anchor leaves nothing.
func TestAnnotateSessionWithManager(t *testing.T) {
	manager, sessionID := setupAnnotateManager(t)
	ctx := context.Background()
	summary, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	hash := agentdata.HashSession(summary)

	preview, err := AnnotateSessionWithManager(ctx, manager, sessionID, wshrpc.SessionAnnotateRequest{
		Anchor: "tail", Kind: "milestone", Title: "阶段推进", Body: "Phase 2 done", DryRun: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !preview.DryRun || preview.Written {
		t.Fatalf("expected a dry-run, got %+v", preview)
	}
	if preview.Preview.AnchorKey == "" || preview.Preview.Seq == 0 {
		t.Fatalf("preview must resolve the anchor: %+v", preview.Preview)
	}
	if annotateRowCount(t, manager, sessionID) != 0 {
		t.Fatal("dry-run must not write")
	}

	// AC4: missing and stale hashes are refused with E_USAGE / E_CONFLICT.
	if _, err := AnnotateSessionWithManager(ctx, manager, sessionID, wshrpc.SessionAnnotateRequest{
		Anchor: "tail", Kind: "milestone", Title: "t", Body: "b", Yes: true,
	}); codeOf(t, err) != CodeUsage {
		t.Fatalf("missing hash must be E_USAGE, got %v", err)
	}
	if _, err := AnnotateSessionWithManager(ctx, manager, sessionID, wshrpc.SessionAnnotateRequest{
		Anchor: "tail", Kind: "milestone", Title: "t", Body: "b", Yes: true, ExpectedHash: "stale",
	}); codeOf(t, err) != CodeConflict {
		t.Fatalf("stale hash must be E_CONFLICT, got %v", err)
	}

	// AC2: default status is draft and source is ai even when the caller omits them.
	written, err := AnnotateSessionWithManager(ctx, manager, sessionID, wshrpc.SessionAnnotateRequest{
		Anchor: "tail", Kind: "milestone", Title: "阶段推进", Body: "Phase 2 done",
		Yes: true, ExpectedHash: hash, AIModel: "test-model",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !written.Written || !written.Created {
		t.Fatalf("expected written/created, got %+v", written)
	}
	if written.Row.Status != "draft" || written.Row.Source != "ai" || written.Row.AIModel != "test-model" {
		t.Fatalf("row must be draft/ai with model, got %+v", written.Row)
	}

	// Dry-run mirrors the real write's replace decision without writing.
	dryAgain, err := AnnotateSessionWithManager(ctx, manager, sessionID, wshrpc.SessionAnnotateRequest{
		Anchor: "tail", Kind: "milestone", Title: "阶段推进", Body: "Phase 2 done", DryRun: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if dryAgain.Created || dryAgain.Preview.ReplacedID != written.Row.ID {
		t.Fatalf("dry-run must preview the replacement of id=%d, got %+v", written.Row.ID, dryAgain)
	}

	// AC3: a repeat write replaces, the count stays 1.
	again, err := AnnotateSessionWithManager(ctx, manager, sessionID, wshrpc.SessionAnnotateRequest{
		Anchor: "tail", Kind: "milestone", Title: "阶段推进 v2", Body: "Phase 3 done",
		Yes: true, ExpectedHash: hash,
	})
	if err != nil {
		t.Fatal(err)
	}
	if again.Created || again.Preview.ReplacedID != written.Row.ID {
		t.Fatalf("expected a replace of id=%d, got %+v", written.Row.ID, again)
	}
	if got := annotateRowCount(t, manager, sessionID); got != 1 {
		t.Fatalf("repeat write must not grow the count, got %d", got)
	}
	t.Logf("ACS repeat write: first_id=%d replaced_id=%d created=%v rows=%d title=%q",
		written.Row.ID, again.Preview.ReplacedID, again.Created, annotateRowCount(t, manager, sessionID), again.Row.Title)

	// AC1: a hallucinated anchor is E_NOT_FOUND and leaves nothing behind.
	if _, err := AnnotateSessionWithManager(ctx, manager, sessionID, wshrpc.SessionAnnotateRequest{
		Anchor: "made-up-anchor", Kind: "note", Title: "x", Body: "y", DryRun: true,
	}); codeOf(t, err) != CodeNotFound {
		t.Fatalf("hallucinated anchor must be E_NOT_FOUND, got %v", err)
	}
	if got := annotateRowCount(t, manager, sessionID); got != 1 {
		t.Fatalf("refused write must not change the count, got %d", got)
	}

	// AC2: accepted without force is refused.
	if _, err := AnnotateSessionWithManager(ctx, manager, sessionID, wshrpc.SessionAnnotateRequest{
		Anchor: "tail", Kind: "note", Title: "x", Body: "y", Status: "accepted", DryRun: true,
	}); codeOf(t, err) != CodeUsage {
		t.Fatalf("accepted without force must be E_USAGE, got %v", err)
	}

	// A human row at the same anchor+kind is protected (even with force).
	detail, err := aisessions.LoadAnnotationDetail(ctx, manager, summary.Key)
	if err != nil {
		t.Fatal(err)
	}
	anchors := aisessions.BuildAnnotationAnchors(detail.Messages, detail.ToolCalls)
	if len(anchors) == 0 {
		t.Fatal("fixture must expose anchors")
	}
	tail := anchors[len(anchors)-1]
	if _, err := manager.SaveAnnotation(ctx, aisessions.AnnotationRow{
		SessionKey: summary.Key, AnchorKey: tail.AnchorKey, Seq: tail.Seq,
		Kind: "note", Title: "human", Status: "accepted", Source: "user",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := AnnotateSessionWithManager(ctx, manager, sessionID, wshrpc.SessionAnnotateRequest{
		Anchor: "tail", Kind: "note", Title: "machine", Body: "b", Force: true,
		Yes: true, ExpectedHash: hash,
	}); codeOf(t, err) != CodeConflict {
		t.Fatalf("protected row must be E_CONFLICT even with force, got %v", err)
	}
	_, protectedErr := AnnotateSessionWithManager(ctx, manager, sessionID, wshrpc.SessionAnnotateRequest{
		Anchor: "tail", Kind: "note", Title: "machine", Body: "b", DryRun: true,
	})
	if codeOf(t, protectedErr) != CodeConflict {
		t.Fatalf("dry-run must surface a protected target as E_CONFLICT, got %v", protectedErr)
	}
	t.Logf("ACS protected write refused: code=%s rows=%d title=%q", codeOf(t, protectedErr), annotateRowCount(t, manager, sessionID), "human")
}
