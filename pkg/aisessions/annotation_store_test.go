// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func openAnnotationTestIndex(t *testing.T) *SQLiteIndex {
	t.Helper()
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index-v2.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = idx.Close() })
	return idx
}

func TestAnnotationCreateListDelete(t *testing.T) {
	idx := openAnnotationTestIndex(t)
	ctx := context.Background()
	key := "codex:ann:/tmp/ann.jsonl"

	created, err := idx.UpsertAnnotation(ctx, AnnotationRow{
		SessionKey: key,
		AnchorKey:  "e1:m0",
		Seq:        1,
		Kind:       "milestone",
		Title:      "First decision",
		Body:       "We picked SQLite.",
		Tags:       []string{"#Arch", "design", "design"},
		Status:     "accepted",
		Source:     "user",
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 {
		t.Fatalf("expected an id, got %#v", created)
	}
	if len(decodeAnnotationTags(created.TagsJSON)) != 2 {
		t.Fatalf("tags must be normalized/deduped: %#v", created.TagsJSON)
	}

	rows, err := idx.ListAnnotations(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Title != "First decision" {
		t.Fatalf("unexpected list: %#v", rows)
	}

	if err := idx.DeleteAnnotation(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	rows, _ = idx.ListAnnotations(ctx, key)
	if len(rows) != 0 {
		t.Fatalf("delete failed: %#v", rows)
	}
	if err := idx.DeleteAnnotation(ctx, created.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("second delete should report ErrNoRows, got %v", err)
	}
}

func TestAnnotationUpdateAIMarksUserEdited(t *testing.T) {
	idx := openAnnotationTestIndex(t)
	ctx := context.Background()
	key := "codex:ann-ai:/tmp/ann-ai.jsonl"

	ai, err := idx.UpsertAnnotation(ctx, AnnotationRow{
		SessionKey: key,
		AnchorKey:  "e1:m0",
		Seq:        1,
		Title:      "AI title",
		Status:     "draft",
		Source:     "ai",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ai.UserEdited {
		t.Fatalf("new AI row must start unedited")
	}

	ai.Title = "Human fixed title"
	updated, err := idx.UpsertAnnotation(ctx, ai)
	if err != nil {
		t.Fatal(err)
	}
	if !updated.UserEdited {
		t.Fatalf("saving an AI row must set user_edited=1")
	}
	if CanReplace(updated) {
		t.Fatalf("edited AI row must be protected")
	}
}

func TestReplaceReplaceableAnnotationsProtectsUserData(t *testing.T) {
	idx := openAnnotationTestIndex(t)
	ctx := context.Background()
	key := "codex:ann-replace:/tmp/ann-replace.jsonl"

	manual, err := idx.UpsertAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e1:m0", Seq: 1, Title: "manual", Source: "user", Status: "accepted"})
	if err != nil {
		t.Fatal(err)
	}
	aiDraft, err := idx.UpsertAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e2:m0", Seq: 2, Title: "ai draft", Source: "ai", Status: "draft"})
	if err != nil {
		t.Fatal(err)
	}
	aiEdited, err := idx.UpsertAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e3:m0", Seq: 3, Title: "ai edited", Source: "ai", Status: "accepted"})
	if err != nil {
		t.Fatal(err)
	}
	aiEdited.Body = "human edit"
	aiEdited, err = idx.UpsertAnnotation(ctx, aiEdited)
	if err != nil {
		t.Fatal(err)
	}

	inserted, err := idx.ReplaceReplaceableAnnotations(ctx, key, []AnnotationRow{
		{AnchorKey: "e9:m0", Seq: 9, Title: "new draft", Body: "regenerated"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(inserted) != 1 || inserted[0].Status != AnnotationStatusDraft {
		t.Fatalf("new rows must be drafts: %#v", inserted)
	}

	rows, err := idx.ListAnnotations(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	titles := map[string]bool{}
	for _, row := range rows {
		titles[row.Title] = true
	}
	if !titles["manual"] {
		t.Fatalf("manual annotation was deleted")
	}
	if !titles["ai edited"] {
		t.Fatalf("user-edited AI annotation was deleted")
	}
	if titles["ai draft"] {
		t.Fatalf("replaceable draft should be deleted")
	}
	if !titles["new draft"] {
		t.Fatalf("replacement was not inserted")
	}
	_ = aiDraft
	_ = manual
	_ = aiEdited
}

func TestListAnnotatedSessionsAggregatesAcceptedOnly(t *testing.T) {
	idx := openAnnotationTestIndex(t)
	ctx := context.Background()
	withAnnotations := SessionSummary{Key: "codex:s1:/tmp/s1.jsonl", ID: "s1", Source: "codex", Title: "Session One", ProjectPath: "/repo/one", FilePath: "/tmp/s1.jsonl", UpdatedAt: 100}
	draftOnly := SessionSummary{Key: "codex:s2:/tmp/s2.jsonl", ID: "s2", Source: "codex", Title: "Session Two", ProjectPath: "/repo/two", FilePath: "/tmp/s2.jsonl", UpdatedAt: 200}
	for _, summary := range []SessionSummary{withAnnotations, draftOnly} {
		if err := idx.SaveSummary(ctx, summary); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := idx.UpsertAnnotation(ctx, AnnotationRow{SessionKey: withAnnotations.Key, AnchorKey: "e1:m0", Seq: 1, Title: "kept", Tags: []string{"k8s"}, Status: "accepted", Source: "user"}); err != nil {
		t.Fatal(err)
	}
	if _, err := idx.UpsertAnnotation(ctx, AnnotationRow{SessionKey: draftOnly.Key, AnchorKey: "e1:m0", Seq: 1, Title: "draft", Status: "draft", Source: "ai"}); err != nil {
		t.Fatal(err)
	}

	sessions, total, err := idx.ListAnnotatedSessions(ctx, AnnotatedSessionFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(sessions) != 1 || sessions[0].Key != withAnnotations.Key {
		t.Fatalf("draft-only session must not appear: total=%d %#v", total, sessions)
	}
	if sessions[0].AnnotationCount != 1 {
		t.Fatalf("expected 1 annotation, got %#v", sessions[0])
	}

	tagged, total, err := idx.ListAnnotatedSessions(ctx, AnnotatedSessionFilter{TagFilters: []string{"k8s"}})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(tagged) != 1 {
		t.Fatalf("tag filter failed: total=%d %#v", total, tagged)
	}
	none, total, err := idx.ListAnnotatedSessions(ctx, AnnotatedSessionFilter{TagFilters: []string{"missing-tag"}})
	if err != nil {
		t.Fatal(err)
	}
	if total != 0 || len(none) != 0 {
		t.Fatalf("unexpected tag matches: total=%d %#v", total, none)
	}
}

func TestResolveAnnotationAnchorsFixesStaleSeqForSameKey(t *testing.T) {
	// 回归：AI 生成的批注只带 anchorKey 落库，seq 恒为 0。活锚点里同一个 key
	// 存在但位置不同时，必须把 seq/hash 补写回去，否则时间线圆点永远不跳转。
	dir := t.TempDir()
	manager := NewManagerWithOptions(ManagerOptions{
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
	ctx := context.Background()
	key := "codex:ann-stale:/tmp/ann-stale.jsonl"

	if _, err := manager.SaveAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e1:t0", Seq: 0, Title: "ai draft", AnchorPreview: "bash ls", Source: "ai",
	}); err != nil {
		t.Fatal(err)
	}

	views, err := manager.ResolveAnnotationAnchors(ctx, key, []AnnotationAnchor{
		{AnchorKey: "e1:t0", Seq: 7, Role: "tool", Hash: AnchorHash("bash\nls")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 {
		t.Fatalf("expected 1 view, got %#v", views)
	}
	if views[0].Seq != 7 {
		t.Fatalf("stale seq must be rewritten to the live anchor seq, got %#v", views[0])
	}
	if views[0].Orphaned {
		t.Fatalf("same-key anchor must not be orphaned: %#v", views[0])
	}

	stored, err := manager.ListAnnotations(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored) != 1 || stored[0].Seq != 7 {
		t.Fatalf("seq must be persisted, got %#v", stored)
	}
}

func TestResolveAnnotationAnchorsReanchorsAndOrphans(t *testing.T) {
	dir := t.TempDir()
	manager := NewManagerWithOptions(ManagerOptions{
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
	ctx := context.Background()
	key := "codex:ann-anchor:/tmp/ann-anchor.jsonl"

	if _, err := manager.SaveAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e1:m0", Seq: 1, Title: "drifted", AnchorHash: AnchorHash("node one"), Source: "user"}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SaveAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e9:m0", Seq: 9, Title: "orphan", AnchorHash: AnchorHash("unknown"), Source: "user"}); err != nil {
		t.Fatal(err)
	}

	views, err := manager.ResolveAnnotationAnchors(ctx, key, []AnnotationAnchor{
		{AnchorKey: "e2:m0", Seq: 2, Role: "user", Hash: AnchorHash("node one")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 2 {
		t.Fatalf("expected 2 views, got %#v", views)
	}
	byTitle := map[string]AnnotationView{}
	for _, view := range views {
		byTitle[view.Title] = view
	}
	if byTitle["drifted"].AnchorKey != "e2:m0" || byTitle["drifted"].Orphaned {
		t.Fatalf("drifted annotation should re-anchor: %#v", byTitle["drifted"])
	}
	if !byTitle["orphan"].Orphaned {
		t.Fatalf("unresolvable annotation should be orphaned: %#v", byTitle["orphan"])
	}

	// No anchors supplied = do not flag anything as orphaned.
	plain, err := manager.ResolveAnnotationAnchors(ctx, key, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, view := range plain {
		if view.Orphaned {
			t.Fatalf("empty anchor list must not orphan: %#v", view)
		}
	}
}
