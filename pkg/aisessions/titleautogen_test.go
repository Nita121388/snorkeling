// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"path/filepath"
	"testing"
)

func TestAutoTitleEligible(t *testing.T) {
	cases := []struct {
		name string
		in   SessionSummary
		want bool
	}{
		{"first user message qualifies", SessionSummary{Key: "k", TitleSource: "first_user_message"}, true},
		{"project fallback qualifies", SessionSummary{Key: "k", TitleSource: "project"}, true},
		{"id fallback qualifies", SessionSummary{Key: "k", TitleSource: "id"}, true},
		{"empty source qualifies", SessionSummary{Key: "k"}, true},
		{"user title never", SessionSummary{Key: "k", TitleSource: "user"}, false},
		{"existing ai title never", SessionSummary{Key: "k", TitleSource: "ai"}, false},
		{"provider source_title never", SessionSummary{Key: "k", TitleSource: "source_title"}, false},
		{"already attempted never", SessionSummary{Key: "k", TitleSource: "first_user_message", AITitleAttemptedAt: 123}, false},
		{"missing session never", SessionSummary{Key: "k", TitleSource: "project", Missing: true}, false},
		{"blank key never", SessionSummary{Key: "  ", TitleSource: "project"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := autoTitleEligible(tc.in); got != tc.want {
				t.Fatalf("autoTitleEligible(%#v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// TestSetMetaTxPreservesUnrelatedFields guards the merge refactor in setMetaTx:
// writing one meta field must never clear another (the pre-refactor switch was a
// fragile "put back the fields this source does not own" shape that the new AI
// title columns would have silently broken).
func TestSetMetaTxPreservesUnrelatedFields(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index-v2.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()
	key := "codex:merge:/tmp/merge.jsonl"

	// Seed a note, then an AI title, then an attempt marker, in that order.
	if err := idx.setMeta(ctx, key, sessionMeta{Note: "important note", UpdatedAt: 1}, "sqlite-note"); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetAutoTitle(ctx, key, "AI Title"); err != nil {
		t.Fatal(err)
	}
	if err := idx.MarkAITitleAttempt(ctx, key, 42); err != nil {
		t.Fatal(err)
	}

	// Writing a mark must not clobber note, title, or the attempt marker.
	if err := idx.SetMarked(ctx, key, true); err != nil {
		t.Fatal(err)
	}
	summary := SessionSummary{Key: key}
	if err := idx.ApplyMeta(ctx, &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Note != "important note" {
		t.Fatalf("note clobbered: %#v", summary)
	}
	if summary.Title != "AI Title" || summary.TitleSource != "ai" {
		t.Fatalf("ai title clobbered: %#v", summary)
	}
	if summary.AITitleAttemptedAt == 0 || summary.AITitleAttemptMessageCount != 42 {
		t.Fatalf("attempt marker clobbered: %#v", summary)
	}
	if !summary.Marked {
		t.Fatalf("mark not applied: %#v", summary)
	}

	// Writing a note after an attempt marker must keep the marker + ai title.
	if err := idx.SetNote(ctx, key, "second note"); err != nil {
		t.Fatal(err)
	}
	afterNote := SessionSummary{Key: key}
	if err := idx.ApplyMeta(ctx, &afterNote); err != nil {
		t.Fatal(err)
	}
	if afterNote.Title != "AI Title" || afterNote.TitleSource != "ai" {
		t.Fatalf("note write clobbered ai title: %#v", afterNote)
	}
	if afterNote.AITitleAttemptedAt == 0 {
		t.Fatalf("note write clobbered attempt marker: %#v", afterNote)
	}

	// A user title overrides the AI title and is marked "user".
	if err := idx.SetTitle(ctx, key, "User Title"); err != nil {
		t.Fatal(err)
	}
	afterUser := SessionSummary{Key: key}
	if err := idx.ApplyMeta(ctx, &afterUser); err != nil {
		t.Fatal(err)
	}
	if afterUser.Title != "User Title" || afterUser.TitleSource != "user" {
		t.Fatalf("user title did not override ai title: %#v", afterUser)
	}
}

// TestManagerSetAutoTitleAndAttempt verifies the manager-level dual-write path
// and that the attempt marker is idempotent (a second attempt does not materially
// change eligibility beyond keeping the first timestamp).
func TestManagerSetAutoTitleAndAttempt(t *testing.T) {
	dir := t.TempDir()
	sessionKey := "codex:autotitle:/tmp/autotitle.jsonl"
	provider := &cacheProvider{
		source: SourceCodex,
		summaries: []SessionSummary{
			{Key: sessionKey, ID: "autotitle", Source: SourceCodex, FilePath: "/tmp/autotitle.jsonl", MTime: 1, Size: 10, TitleSource: "first_user_message"},
		},
		messages: []Message{{Seq: 1, Role: RoleUser, Text: "hello"}},
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
	ctx := context.Background()

	if _, err := manager.setAutoTitle(ctx, sessionKey, "Generated Title"); err != nil {
		t.Fatal(err)
	}
	if err := manager.markAITitleAttempt(ctx, sessionKey, 5); err != nil {
		t.Fatal(err)
	}
	reloaded, err := manager.Summary(ctx, "autotitle", false)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Title != "Generated Title" || reloaded.TitleSource != "ai" {
		t.Fatalf("expected ai title to persist, got %#v", reloaded)
	}
	if reloaded.AITitleAttemptedAt == 0 || reloaded.AITitleAttemptMessageCount != 5 {
		t.Fatalf("expected attempt marker, got %#v", reloaded)
	}
	if autoTitleEligible(reloaded) {
		t.Fatalf("a generated/attempted session must not be eligible again: %#v", reloaded)
	}
}
