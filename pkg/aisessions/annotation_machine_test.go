// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func machineTestManager(t *testing.T) *Manager {
	t.Helper()
	dir := t.TempDir()
	return NewManagerWithOptions(ManagerOptions{
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
}

func countAnnotations(t *testing.T, manager *Manager, ctx context.Context, key string) int {
	t.Helper()
	rows, err := manager.ListAnnotations(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	return len(rows)
}

// AC2/AC3 core: a machine write lands as status=draft, source=ai; rewriting
// the same (session, kind, anchor) replaces the row instead of stacking.
func TestMachineAnnotationReplaceKeepsCount(t *testing.T) {
	manager := machineTestManager(t)
	ctx := context.Background()
	key := "codex:machine:/tmp/machine.jsonl"

	first, err := manager.UpsertMachineAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e1:m0", Kind: "milestone", Title: "v1", Body: "first", Status: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !first.Created || first.Written {
		t.Fatalf("unexpected first outcome: %+v", first)
	}
	if first.Row.Status != AnnotationStatusDraft || first.Row.Source != AnnotationSourceAI {
		t.Fatalf("machine rows must land as draft/ai, got %q/%q", first.Row.Status, first.Row.Source)
	}
	if first.ReplacedID != 0 {
		t.Fatalf("first write must not replace anything, got %d", first.ReplacedID)
	}

	second, err := manager.UpsertMachineAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e1:m0", Kind: "milestone", Title: "v2", Body: "second", Status: AnnotationStatusDraft,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.Created {
		t.Fatalf("second write must report created=false, got %+v", second)
	}
	if second.ReplacedID != first.Row.ID {
		t.Fatalf("second write must report the replaced id %d, got %d", first.Row.ID, second.ReplacedID)
	}
	if second.Row.UpdatedAt < first.Row.UpdatedAt {
		t.Fatalf("updated_at must advance: first=%d second=%d", first.Row.UpdatedAt, second.Row.UpdatedAt)
	}
	if got := countAnnotations(t, manager, ctx, key); got != 1 {
		t.Fatalf("same (session, kind, anchor) machine write must not grow the count, got %d", got)
	}
	rows, _ := manager.ListAnnotations(ctx, key)
	if len(rows) != 1 || rows[0].Title != "v2" {
		t.Fatalf("expected the replaced row, got %#v", rows)
	}
	t.Logf("repeat write: first_id=%d first_updated=%d -> second_id=%d replaced_id=%d second_updated=%d rows=%d title=%q",
		first.Row.ID, first.Row.UpdatedAt, second.Row.ID, second.ReplacedID, second.Row.UpdatedAt, len(rows), rows[0].Title)
}

// A human-edited AI row is protected; the machine write is refused and the row
// is untouched.
func TestMachineAnnotationRejectsHumanEdited(t *testing.T) {
	manager := machineTestManager(t)
	ctx := context.Background()
	key := "codex:machine-edited:/tmp/machine-edited.jsonl"

	draft, err := manager.SaveAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e1:m0", Kind: "note", Title: "ai draft", Status: AnnotationStatusDraft, Source: AnnotationSourceAI,
	})
	if err != nil {
		t.Fatal(err)
	}
	// A human save of an AI row flips user_edited (UpsertAnnotation contract).
	draft.Title = "human fixed"
	if _, err := manager.SaveAnnotation(ctx, draft); err != nil {
		t.Fatal(err)
	}

	_, err = manager.UpsertMachineAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e1:m0", Kind: "note", Title: "machine again", Status: AnnotationStatusDraft,
	})
	if !errors.Is(err, ErrAnnotationProtected) {
		t.Fatalf("expected ErrAnnotationProtected, got %v", err)
	}
	rows, _ := manager.ListAnnotations(ctx, key)
	if len(rows) != 1 || rows[0].Title != "human fixed" {
		t.Fatalf("protected row must be untouched, got %#v", rows)
	}
	t.Logf("human-edited write rejected: err=%v rows=%d title=%q", err, len(rows), rows[0].Title)
}

// A user-authored row at the same anchor is refused too.
func TestMachineAnnotationRejectsUserRow(t *testing.T) {
	manager := machineTestManager(t)
	ctx := context.Background()
	key := "codex:machine-user:/tmp/machine-user.jsonl"

	if _, err := manager.SaveAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e1:m0", Kind: "note", Title: "human note", Status: AnnotationStatusAccepted, Source: AnnotationSourceUser,
	}); err != nil {
		t.Fatal(err)
	}
	_, err := manager.UpsertMachineAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e1:m0", Kind: "note", Title: "machine note", Status: AnnotationStatusDraft,
	})
	if !errors.Is(err, ErrAnnotationProtected) {
		t.Fatalf("expected ErrAnnotationProtected, got %v", err)
	}
	if got := countAnnotations(t, manager, ctx, key); got != 1 {
		t.Fatalf("refused write must not change the count, got %d", got)
	}
}

// Different kinds are different identities: they must not overwrite each other.
func TestMachineAnnotationDifferentKindDoesNotReplace(t *testing.T) {
	manager := machineTestManager(t)
	ctx := context.Background()
	key := "codex:machine-kind:/tmp/machine-kind.jsonl"

	if _, err := manager.UpsertMachineAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e1:m0", Kind: "note", Title: "n"}); err != nil {
		t.Fatal(err)
	}
	outcome, err := manager.UpsertMachineAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e1:m0", Kind: "milestone", Title: "m"})
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Created {
		t.Fatalf("a different kind is a new row, got %+v", outcome)
	}
	if got := countAnnotations(t, manager, ctx, key); got != 2 {
		t.Fatalf("expected 2 rows, got %d", got)
	}
}

// Other AI drafts in the same session must survive a single machine write
// (unlike ReplaceReplaceableAnnotations, which deletes every replaceable row).
func TestMachineAnnotationLeavesOtherDraftsAlone(t *testing.T) {
	manager := machineTestManager(t)
	ctx := context.Background()
	key := "codex:machine-others:/tmp/machine-others.jsonl"

	other, err := manager.SaveAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e2:m0", Title: "other ai draft", Status: AnnotationStatusDraft, Source: AnnotationSourceAI,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.UpsertMachineAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e1:m0", Kind: "milestone", Title: "target",
	}); err != nil {
		t.Fatal(err)
	}
	rows, _ := manager.ListAnnotations(ctx, key)
	found := false
	for _, row := range rows {
		if row.ID == other.ID {
			found = true
		}
	}
	if !found || len(rows) != 2 {
		t.Fatalf("other drafts must survive a single machine write, got %#v", rows)
	}
}

// The store layer must not silently normalize junk statuses: a typo upstream
// must never land as "accepted" (normalizeAnnotationStatus maps junk to
// accepted, which would let a machine write impersonate a human acceptance).
func TestMachineAnnotationRejectsInvalidStatusAtStore(t *testing.T) {
	manager := machineTestManager(t)
	ctx := context.Background()
	_, err := manager.UpsertMachineAnnotation(ctx, AnnotationRow{
		SessionKey: "codex:machine-status:/tmp/status.jsonl", AnchorKey: "e1:m0", Kind: "note", Title: "x", Status: "bogus",
	})
	if !errors.Is(err, ErrAnnotationStatusInvalid) {
		t.Fatalf("bogus status must be refused at the store, got %v", err)
	}
	if got := countAnnotations(t, manager, ctx, "codex:machine-status:/tmp/status.jsonl"); got != 0 {
		t.Fatalf("refused status must write nothing, got %d rows", got)
	}
	// Explicit draft/accepted stay valid at the store layer; the accepted-gate
	// (force) lives in PrepareMachineAnnotation.
	for _, status := range []string{"", "draft", "accepted"} {
		if _, err := manager.UpsertMachineAnnotation(ctx, AnnotationRow{
			SessionKey: "codex:machine-status:/tmp/status.jsonl", AnchorKey: "e1:m0", Kind: "note", Title: "x", Status: status,
		}); err != nil {
			t.Fatalf("status %q must be accepted at the store, got %v", status, err)
		}
	}
}

// AnnotationSave can stack duplicate rows at the same identity; a machine
// write must converge them (delete every CanReplace row, keep protected ones)
// instead of leaving the stale duplicates behind.
func TestMachineAnnotationConvergesDuplicateDrafts(t *testing.T) {
	manager := machineTestManager(t)
	ctx := context.Background()
	key := "codex:machine-dup:/tmp/machine-dup.jsonl"
	for i := 0; i < 2; i++ {
		if _, err := manager.SaveAnnotation(ctx, AnnotationRow{
			SessionKey: key, AnchorKey: "e1:m0", Kind: "note", Title: "ai", Status: AnnotationStatusDraft, Source: AnnotationSourceAI,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if got := countAnnotations(t, manager, ctx, key); got != 2 {
		t.Fatalf("fixture must stack 2 rows, got %d", got)
	}
	outcome, err := manager.UpsertMachineAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e1:m0", Kind: "note", Title: "machine",
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Created {
		t.Fatalf("expected a replace, got %+v", outcome)
	}
	if got := countAnnotations(t, manager, ctx, key); got != 1 {
		t.Fatalf("a machine write must converge duplicates to one row, got %d", got)
	}
	rows, _ := manager.ListAnnotations(ctx, key)
	if rows[0].Title != "machine" || rows[0].Source != AnnotationSourceAI {
		t.Fatalf("expected the machine row, got %#v", rows[0])
	}

	// A protected row at the same identity survives the convergence while the
	// replaceable one is replaced.
	key2 := "codex:machine-dup2:/tmp/machine-dup2.jsonl"
	if _, err := manager.SaveAnnotation(ctx, AnnotationRow{
		SessionKey: key2, AnchorKey: "e1:m0", Kind: "note", Title: "human", Status: AnnotationStatusAccepted, Source: AnnotationSourceUser,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SaveAnnotation(ctx, AnnotationRow{
		SessionKey: key2, AnchorKey: "e1:m0", Kind: "note", Title: "ai", Status: AnnotationStatusDraft, Source: AnnotationSourceAI,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.UpsertMachineAnnotation(ctx, AnnotationRow{
		SessionKey: key2, AnchorKey: "e1:m0", Kind: "note", Title: "machine",
	}); err != nil {
		t.Fatal(err)
	}
	rows2, _ := manager.ListAnnotations(ctx, key2)
	if len(rows2) != 2 {
		t.Fatalf("expected the human row + the new machine row, got %#v", rows2)
	}
	keptHuman := false
	for _, r := range rows2 {
		if r.Source == AnnotationSourceUser && r.Title == "human" {
			keptHuman = true
		}
	}
	if !keptHuman {
		t.Fatalf("the user row must survive the convergence, got %#v", rows2)
	}
}

// ResolveAnnotationAnchorTarget: tail resolves the last anchor, an unknown key
// is refused with the sentinel (hallucinated keys never reach storage).
func TestResolveAnnotationAnchorTarget(t *testing.T) {
	messages := []Message{
		{ItemKey: "e1:m0", Seq: 1, Role: "user", Text: "first"},
		{ItemKey: "e2:m0", Seq: 2, Role: "assistant", Text: "second"},
	}
	anchor, preview, err := ResolveAnnotationAnchorTarget(messages, nil, "tail")
	if err != nil {
		t.Fatal(err)
	}
	if anchor.AnchorKey != "e2:m0" || anchor.Seq != 2 || preview != "second" {
		t.Fatalf("tail must resolve the last anchorable message: %+v %q", anchor, preview)
	}
	anchor, _, err = ResolveAnnotationAnchorTarget(messages, nil, "e1:m0")
	if err != nil || anchor.Seq != 1 || anchor.Role != "user" {
		t.Fatalf("exact itemKey must resolve: %+v %v", anchor, err)
	}
	_, _, err = ResolveAnnotationAnchorTarget(messages, nil, "hallucinated")
	if !errors.Is(err, ErrAnnotationAnchorNotFound) {
		t.Fatalf("unknown anchor must fail with the sentinel, got %v", err)
	}
	_, _, err = ResolveAnnotationAnchorTarget(nil, nil, "tail")
	if !errors.Is(err, ErrAnnotationAnchorNotFound) {
		t.Fatalf("empty session tail must fail with the sentinel, got %v", err)
	}
}

// ApplyMachineAnnotation: dry-run writes nothing, a real write needs the hash,
// a stale hash is refused (same optimistic-lock shape as agent card set).
func TestApplyMachineAnnotationGates(t *testing.T) {
	manager := machineTestManager(t)
	ctx := context.Background()
	key := "codex:machine-gate:/tmp/machine-gate.jsonl"
	plan := MachineAnnotationPlan{
		Summary: SessionSummary{Key: key},
		Anchor:  AnnotationAnchor{AnchorKey: "e1:m0", Seq: 1, Role: "user"},
		Row:     AnnotationRow{SessionKey: key, AnchorKey: "e1:m0", Kind: "note", Title: "draft", Status: AnnotationStatusDraft},
	}

	outcome, err := manager.ApplyMachineAnnotation(ctx, plan, "currenthash", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.DryRun || outcome.Written {
		t.Fatalf("dry-run outcome mismatch: %+v", outcome)
	}
	if got := countAnnotations(t, manager, ctx, key); got != 0 {
		t.Fatalf("dry-run must not write, got %d rows", got)
	}

	_, err = manager.ApplyMachineAnnotation(ctx, plan, "currenthash", "", false)
	if !errors.Is(err, ErrAnnotationHashRequired) {
		t.Fatalf("real write without a hash must be refused, got %v", err)
	}
	_, err = manager.ApplyMachineAnnotation(ctx, plan, "currenthash", "stalehash", false)
	if !errors.Is(err, ErrAnnotationHashMismatch) {
		t.Fatalf("stale hash must be refused, got %v", err)
	}
	if got := countAnnotations(t, manager, ctx, key); got != 0 {
		t.Fatalf("refused writes must leave nothing behind, got %d rows", got)
	}

	outcome, err = manager.ApplyMachineAnnotation(ctx, plan, "currenthash", "currenthash", false)
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Written || !outcome.Created {
		t.Fatalf("expected a written/created outcome, got %+v", outcome)
	}
	if got := countAnnotations(t, manager, ctx, key); got != 1 {
		t.Fatalf("expected 1 row after the real write, got %d", got)
	}
	// A dry-run with a stale hash must also refuse (dry-run and real write run
	// the same precondition check).
	_, err = manager.ApplyMachineAnnotation(ctx, plan, "currenthash", "stalehash", true)
	if !errors.Is(err, ErrAnnotationHashMismatch) {
		t.Fatalf("dry-run with a stale hash must be refused, got %v", err)
	}
}

// PrepareMachineAnnotation gates: status=accepted needs force; an unknown
// status is refused.
func TestPrepareMachineAnnotationStatusGates(t *testing.T) {
	manager := machineTestManager(t)
	ctx := context.Background()
	req := MachineAnnotationRequest{Identifier: "codex:x:/tmp/x.jsonl", Anchor: "e1:m0"}
	_, err := PrepareMachineAnnotation(ctx, manager, req)
	if err == nil {
		t.Fatal("missing identifier/anchor must fail")
	}
	// A status gate fires before any session lookup, so an unknown session id
	// still reports the usage error.
	_, err = PrepareMachineAnnotation(ctx, manager, MachineAnnotationRequest{Identifier: "nope", Anchor: "e1:m0", Status: "accepted"})
	if !errors.Is(err, ErrAnnotationStatusNeedsForce) {
		t.Fatalf("accepted without force must be refused, got %v", err)
	}
	_, err = PrepareMachineAnnotation(ctx, manager, MachineAnnotationRequest{Identifier: "nope", Anchor: "e1:m0", Status: "weird"})
	if !errors.Is(err, ErrAnnotationStatusInvalid) {
		t.Fatalf("unknown status must be refused, got %v", err)
	}
}
