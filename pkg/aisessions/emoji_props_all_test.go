// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"path/filepath"
	"testing"
)

// TestSQLiteIndexEmojiPropsAll verifies the startup-bootstrap read (design D1):
// every emoji prop is returned with its session id, rows without a live
// ai_sessions row still surface by session key, and non-string/empty/other-prop
// cells are skipped.
func TestSQLiteIndexEmojiPropsAll(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index-v2.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()

	summaries := []SessionSummary{
		{Key: "s1", ID: "id-1", Source: "pi", Title: "with emoji", ProjectPath: "/work/x", CreatedAt: 100, UpdatedAt: 100, FilePath: filepath.Join(dir, "s1.jsonl")},
		{Key: "s2", ID: "id-2", Source: "pi", Title: "plain", ProjectPath: "/work/x", CreatedAt: 200, UpdatedAt: 200, FilePath: filepath.Join(dir, "s2.jsonl")},
	}
	if _, errs := idx.SaveScannedSummaries(ctx, summaries, true); len(errs) != 0 {
		t.Fatalf("save errors: %v", errs)
	}
	if err := idx.SetProps(ctx, "s1", map[string]PropertyCell{
		"emoji": {Value: "🦊", Type: "text", Source: PropertySourceUser},
		"phase": {Value: "doing", Type: "text", Source: PropertySourceUser},
	}); err != nil {
		t.Fatal(err)
	}

	rows, err := idx.EmojiPropsAll(ctx)
	if err != nil {
		t.Fatalf("EmojiPropsAll: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected exactly 1 emoji row (other props excluded), got %d: %#v", len(rows), rows)
	}
	got := rows[0]
	if got.SessionKey != "s1" || got.ID != "id-1" || got.Emoji != "🦊" || got.Source != PropertySourceUser {
		t.Fatalf("unexpected row: %#v", got)
	}
	if got.UpdatedAt <= 0 {
		t.Fatalf("expected a positive updatedAt, got %d", got.UpdatedAt)
	}

	// An orphan prop (ai_sessions row gone) must still be listed by session key.
	if _, err := idx.db.ExecContext(ctx, `DELETE FROM ai_sessions WHERE key = 's1'`); err != nil {
		t.Fatal(err)
	}
	rows, err = idx.EmojiPropsAll(ctx)
	if err != nil {
		t.Fatalf("EmojiPropsAll after delete: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected the orphan emoji row to survive, got %#v", rows)
	}
	if rows[0].SessionKey != "s1" || rows[0].ID != "" || rows[0].Emoji != "🦊" {
		t.Fatalf("orphan row = %#v, want empty ID with session key and emoji", rows[0])
	}
}
