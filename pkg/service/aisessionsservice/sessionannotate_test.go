// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentdata"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// setupAnnotateSession builds a throwaway pi session so the service annotate
// path runs against the real local manager + sqlite index. Pi messages carry
// stable ItemKeys ("<entryId>:mN"), which is what node annotations anchor to.
func setupAnnotateSession(t *testing.T) (string, *aisessions.Manager) {
	t.Helper()
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	piDir := filepath.Join(dir, "pi-sessions")
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", piDir)
	wavebase.DataHome_VarCache = filepath.Join(dir, "data")
	wavebase.ConfigHome_VarCache = filepath.Join(dir, "config")
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	if err := os.MkdirAll(piDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionID := "pi-service-annotate"
	sessionPath := filepath.Join(piDir, "pi-service-annotate.jsonl")
	content := `{"type":"session","version":3,"id":"` + sessionID + `","timestamp":1700000000,"cwd":"/tmp/project"}` + "\n" +
		`{"type":"message","id":"msg-1","parentId":"","role":"user","content":"Initial request"}` + "\n" +
		`{"type":"message","id":"msg-2","parentId":"msg-1","role":"assistant","content":[{"type":"text","text":"All done"}]}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := newLocalManager()
	if _, errs := manager.Index(context.Background()); len(errs) > 0 {
		t.Fatalf("index session: %v", errs[0])
	}
	return sessionID, manager
}

// annotateRows lists the stored annotations so the test can prove "nothing was
// written" on the refusal paths (AC1/AC2/AC4).
func annotateRows(t *testing.T, manager *aisessions.Manager, sessionID string) []aisessions.AnnotationRow {
	t.Helper()
	summary, err := manager.Summary(context.Background(), sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := manager.ListAnnotations(context.Background(), summary.Key)
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestSessionAnnotateDryRunAndWrite(t *testing.T) {
	sessionID, manager := setupAnnotateSession(t)
	svc := &AISessionsService{}
	ctx := context.Background()
	summary, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	hash := agentdata.HashSession(summary)

	// AC2: default is draft/ai, and the dry-run writes nothing.
	preview, err := svc.SessionAnnotate(ctx, &AISessionsSessionAnnotateRequest{
		ID: sessionID, Anchor: "tail", Kind: "milestone", Title: "阶段推进", Body: "Phase 2 done", DryRun: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !preview.DryRun || preview.Written {
		t.Fatalf("expected a pure dry-run, got %+v", preview)
	}
	if len(annotateRows(t, manager, sessionID)) != 0 {
		t.Fatal("dry-run must not write")
	}

	// AC4: a real write requires the hash; a stale one is refused.
	if _, err := svc.SessionAnnotate(ctx, &AISessionsSessionAnnotateRequest{
		ID: sessionID, Anchor: "tail", Kind: "milestone", Title: "t", Body: "b", DryRun: false,
	}); !errors.Is(err, aisessions.ErrAnnotationHashRequired) {
		t.Fatalf("expected ErrAnnotationHashRequired, got %v", err)
	}
	if _, err := svc.SessionAnnotate(ctx, &AISessionsSessionAnnotateRequest{
		ID: sessionID, Anchor: "tail", Kind: "milestone", Title: "t", Body: "b", DryRun: false, ExpectedHash: "stale",
	}); !errors.Is(err, aisessions.ErrAnnotationHashMismatch) {
		t.Fatalf("expected ErrAnnotationHashMismatch, got %v", err)
	}
	if len(annotateRows(t, manager, sessionID)) != 0 {
		t.Fatal("refused writes must leave nothing behind")
	}

	// AC2/AC3: the real write lands as draft/ai.
	written, err := svc.SessionAnnotate(ctx, &AISessionsSessionAnnotateRequest{
		ID: sessionID, Anchor: "tail", Kind: "milestone", Title: "阶段推进", Body: "Phase 2 done",
		DryRun: false, ExpectedHash: hash, AIModel: "test-model",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !written.Written || !written.Created {
		t.Fatalf("expected written/created, got %+v", written)
	}
	if written.Row == nil || written.Row.Status != "draft" || written.Row.Source != "ai" || written.Row.AIModel != "test-model" {
		t.Fatalf("row must be draft/ai with the model, got %+v", written.Row)
	}
	if !strings.Contains(written.Row.Body, "Phase 2 done") {
		t.Fatalf("unexpected row: %+v", written.Row)
	}

	// AC3: same (session, kind, anchor) replaces, count does not grow.
	again, err := svc.SessionAnnotate(ctx, &AISessionsSessionAnnotateRequest{
		ID: sessionID, Anchor: "tail", Kind: "milestone", Title: "阶段推进 v2", Body: "Phase 3 done",
		DryRun: false, ExpectedHash: hash,
	})
	if err != nil {
		t.Fatal(err)
	}
	if again.Created || again.Preview.ReplacedID != written.Row.ID {
		t.Fatalf("expected a replace of id=%d, got %+v", written.Row.ID, again)
	}
	rows := annotateRows(t, manager, sessionID)
	if len(rows) != 1 {
		t.Fatalf("repeat write must not grow the count, got %d rows", len(rows))
	}
	if rows[0].Title != "阶段推进 v2" || rows[0].UpdatedAt < written.Row.UpdatedAt {
		t.Fatalf("expected the replaced row with a fresh updated_at, got %+v", rows[0])
	}
}

// AC1: a hallucinated anchor fails and nothing is stored.
func TestSessionAnnotateHallucinatedAnchor(t *testing.T) {
	sessionID, manager := setupAnnotateSession(t)
	svc := &AISessionsService{}
	_, err := svc.SessionAnnotate(context.Background(), &AISessionsSessionAnnotateRequest{
		ID: sessionID, Anchor: "totally-made-up:1", Kind: "note", Title: "x", Body: "y", DryRun: true,
	})
	if !errors.Is(err, aisessions.ErrAnnotationAnchorNotFound) {
		t.Fatalf("expected ErrAnnotationAnchorNotFound, got %v", err)
	}
	if len(annotateRows(t, manager, sessionID)) != 0 {
		t.Fatal("a hallucinated anchor must not leave anything behind")
	}
}

// AC2: status=accepted without force is refused before any write.
func TestSessionAnnotateAcceptedNeedsForce(t *testing.T) {
	sessionID, manager := setupAnnotateSession(t)
	svc := &AISessionsService{}
	_, err := svc.SessionAnnotate(context.Background(), &AISessionsSessionAnnotateRequest{
		ID: sessionID, Anchor: "tail", Kind: "note", Title: "x", Body: "y", Status: "accepted", DryRun: true,
	})
	if !errors.Is(err, aisessions.ErrAnnotationStatusNeedsForce) {
		t.Fatalf("expected ErrAnnotationStatusNeedsForce, got %v", err)
	}
	accepted, err := svc.SessionAnnotate(context.Background(), &AISessionsSessionAnnotateRequest{
		ID: sessionID, Anchor: "tail", Kind: "note", Title: "x", Body: "y", Status: "accepted", Force: true, DryRun: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Row == nil || accepted.Row.Status != "accepted" {
		t.Fatalf("accepted+force must preview as accepted, got %+v", accepted.Row)
	}
	if len(annotateRows(t, manager, sessionID)) != 0 {
		t.Fatal("the preview path must not write")
	}
}

// A human-owned row at the same anchor is never replaced by a machine write.
func TestSessionAnnotateRefusesProtectedRow(t *testing.T) {
	sessionID, manager := setupAnnotateSession(t)
	svc := &AISessionsService{}
	ctx := context.Background()
	summary, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	anchors := aisessions.BuildAnnotationAnchors(nil, nil)
	detail, err := aisessions.LoadAnnotationDetail(ctx, manager, summary.Key)
	if err != nil {
		t.Fatal(err)
	}
	anchors = aisessions.BuildAnnotationAnchors(detail.Messages, detail.ToolCalls)
	if len(anchors) == 0 {
		t.Fatal("fixture session must expose anchors")
	}
	if _, err := manager.SaveAnnotation(ctx, aisessions.AnnotationRow{
		SessionKey: summary.Key, AnchorKey: anchors[len(anchors)-1].AnchorKey, Seq: anchors[len(anchors)-1].Seq,
		Kind: "milestone", Title: "human", Status: "accepted", Source: "user",
	}); err != nil {
		t.Fatal(err)
	}
	_, err = svc.SessionAnnotate(ctx, &AISessionsSessionAnnotateRequest{
		ID: sessionID, Anchor: "tail", Kind: "milestone", Title: "machine", Body: "b", DryRun: false,
		ExpectedHash: agentdata.HashSession(summary),
	})
	if !errors.Is(err, aisessions.ErrAnnotationProtected) {
		t.Fatalf("expected ErrAnnotationProtected, got %v", err)
	}
	rows := annotateRows(t, manager, sessionID)
	if len(rows) != 1 || rows[0].Title != "human" {
		t.Fatalf("protected row must survive untouched, got %#v", rows)
	}
}
